/**
 * 会话笔记服务：管理每个对话的笔记文件（session_memory/*.md）。
 * 通过 SubAgent 驱动 AI 自动提取对话要点，维护笔记文件的新鲜度。
 *
 * 核心流程（extractNotes）：
 * 1. 查询会话消息历史（倒序取 500 条再翻转）
 * 2. 构建子代理提示词（含压缩上下文、原始对话、当前笔记）
 * 3. 执行 SubAgent 多轮对话，AI 使用文件工具更新笔记
 * 4. 验证笔记文件是否实际变化，更新数据库状态
 * 5. 广播事件和记录活动日志
 */
import path from 'path';
import fs from 'fs';
import { SessionMemoryManager } from './manager.js';
import {
  buildSessionMemorySubAgentPrompt,
  estimateTokenCount,
  injectSessionMemoryUpdate,
} from './promptBuilder.js';
import { buildAllToolDefinitions } from './toolDefinitions.js';
import { getDb } from '../../core/database/index.js';
import { HttpError } from '../../core/utils/index.js';
import { autoDreamConfig } from '../../config/index.js';
import { createLogger } from '../../core/logger/index.js';
import { SubAgentExecutor } from '../subAgent/executor.js';
import { buildSubAgentPromptParts } from '../subAgent/promptBuilder.js';
import type { SubAgentConfig, SubAgentPromptParts } from '../subAgent/types.js';
import type { ToolContext } from '../../core/types/tools.js';
import { eventManager } from '../../core/events/manager.js';
import { recordActivity } from '../../domain/monitor/service.js';
import { loadMainPrompt, loadToolRules, loadPersistentMemory } from '../../prompts/loader.js';
import { getParamValue } from '../../domain/setting/index.js';
import * as messageRepo from '../../domain/message/repository.js';
import { findById as findConversationById } from '../../domain/conversation/repository.js';

const logger = createLogger('SessionMemoryService');
/** 默认模型标识，getParamValue 未找到用户设置时使用 */
const FALLBACK_MODEL = 'deepseek-v4-pro';

/** 笔记查询响应 */
export interface SessionNotesResponse {
  conversation_id: string;
  content: string;
  initialized: boolean;
  file_path: string;
}

/** 笔记提取响应 */
export interface ExtractResponse {
  success: boolean;
  message: string;
  content: string;
}

/** 笔记删除响应 */
export interface DeleteResponse {
  success: boolean;
  message: string;
}

export class SessionMemoryService {
  private manager: SessionMemoryManager;

  constructor() {
    this.manager = new SessionMemoryManager();
  }

  /** 获取指定会话的笔记内容和文件路径 */
  getNotes(conversationId: string, _userId?: string): SessionNotesResponse {
    const filePath = this.manager.getSessionMemoryPath(conversationId);

    if (!fs.existsSync(filePath)) {
      return {
        conversation_id: conversationId,
        content: '',
        initialized: false,
        file_path: '',
      };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path
      .relative(autoDreamConfig.memoryRootDir, filePath)
      .replaceAll(path.sep, '/');

    return {
      conversation_id: conversationId,
      content,
      initialized: true,
      file_path: relativePath,
    };
  }

  /**
   * 提取会话笔记。通过 SubAgent 驱动 AI 分析对话历史并更新笔记文件。
   * 执行完成后：更新数据库状态、注入 system 消息到对话、广播事件、记录活动日志。
   * @security 插入 system 消息前验证会话所有权，防止越权写入。
   */
  async extractNotes(conversationId: string, userId: string): Promise<ExtractResponse> {
    logger.info(
      '[extractNotes] 开始提取会话记忆, conversationId=%s, userId=%s',
      conversationId,
      userId,
    );

    let db;
    try {
      db = getDb();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[extractNotes] 数据库未初始化: %s', msg);
      throw new HttpError(500, `数据库未初始化: ${msg}`);
    }

    // @security 验证会话所有权，防止越权提取笔记
    const conversation = findConversationById(conversationId, userId);
    if (!conversation) {
      throw new HttpError(404, '会话不存在或无权访问');
    }

    let rows: Array<{ role: string; content: string; is_compact_summary: number }>;
    try {
      rows = db
        .prepare(
          // 限制 500 条以覆盖更多早期上下文，同时避免单次查询返回过多数据
          'SELECT role, content, is_compact_summary FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 500',
        )
        .all(conversationId) as Array<{
        role: string;
        content: string;
        is_compact_summary: number;
      }>;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[extractNotes] 查询消息失败: %s', msg);
      throw new HttpError(500, `查询消息失败: ${msg}`);
    }

    if (!rows || rows.length === 0) {
      throw new HttpError(404, '该会话没有消息记录');
    }

    logger.info('[extractNotes] 查询到 %d 条消息', rows.length);

    const reversedRows = rows.reverse();
    const historyMessages = reversedRows.map((row) => ({
      role: row.role,
      content: row.content,
    }));

    const compactMessages = reversedRows
      .filter((row) => row.is_compact_summary === 1)
      .map((row) => row.content);
    const compactContext =
      compactMessages.length > 0
        ? `<compact-context>\n${compactMessages.join('\n')}\n</compact-context>`
        : '';

    const currentNotes = this.manager.readSessionMemory(conversationId);
    const notesFilePath = this.manager.getSessionMemoryPath(conversationId);
    const notesPath = path
      .relative(autoDreamConfig.memoryRootDir, notesFilePath)
      .replaceAll(path.sep, '/');

    const triggerState = this.manager.getTriggerState(conversationId);
    const isInit = triggerState.lastUpdateTokenCount === 0;
    const tokensBefore = triggerState.lastUpdateTokenCount;

    const mainPrompt = loadMainPrompt();
    logger.info('[extractNotes] 主提示词长度: %d', mainPrompt.length);
    const toolRules = loadToolRules();
    logger.info('[extractNotes] 工具规则长度: %d', toolRules.length);
    const persistentMemory = loadPersistentMemory();
    logger.info('[extractNotes] 常驻记忆长度: %d', persistentMemory.length);
    logger.info('[extractNotes] compact上下文长度: %d', compactContext.length);

    const rawConversation = historyMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    logger.info('[extractNotes] 原始对话长度: %d', rawConversation.length);

    const memoryRoot = autoDreamConfig.memoryRootDir;
    const subAgentPrompt = buildSessionMemorySubAgentPrompt(notesPath, currentNotes, memoryRoot);
    logger.info('[extractNotes] 子代理提示词长度: %d', subAgentPrompt.length);

    const promptParts: SubAgentPromptParts = buildSubAgentPromptParts(
      mainPrompt,
      toolRules,
      persistentMemory,
      compactContext,
      rawConversation,
      subAgentPrompt,
    );

    const toolDefinitions = buildAllToolDefinitions();
    logger.info('[extractNotes] 工具定义数量: %d', toolDefinitions.length);

    const selectedModel = getParamValue(userId, 'selected_model', FALLBACK_MODEL);
    logger.info('[extractNotes] 使用模型: %s (用户选择: %s)', selectedModel, selectedModel);

    const config: SubAgentConfig = {
      type: 'session_memory',
      model: selectedModel,
      temperature: 0.3,
      tools: toolDefinitions as unknown as Record<string, unknown>[],
      maxTurns: 10,
    };

    const toolContext: ToolContext = {
      conversationId,
      memoryRoot,
    };

    logger.info(
      '[extractNotes] 开始执行 SubAgent, model=%s, maxTurns=%d ...',
      config.model,
      config.maxTurns ?? 10,
    );
    const executor = new SubAgentExecutor();
    const result = await executor.execute(config, promptParts, userId, toolContext);
    logger.info(
      '[extractNotes] SubAgent 执行完成, success=%s, error=%s, output长度=%d',
      result.success,
      result.error ?? '无',
      result.output.length,
    );

    const notesAfterExecution = this.manager.readSessionMemory(conversationId);
    const notesActuallyChanged = currentNotes !== notesAfterExecution;
    logger.info('[extractNotes] 笔记文件是否变化: %s', notesActuallyChanged);

    if (result.success && !notesActuallyChanged) {
      logger.warn('[extractNotes] SubAgent返回成功但笔记文件未变化，标记为失败');
    }

    // SubAgent 返回成功但笔记文件未变化时，标记为失败（AI 可能仅输出文字而未调用文件工具）
    const effectiveSuccess = result.success && notesActuallyChanged;

    let tokensAfter = tokensBefore;
    try {
      const updatedNotes = this.manager.readSessionMemory(conversationId);
      tokensAfter = estimateTokenCount(updatedNotes);
      this.manager.updateState(conversationId, tokensAfter);
    } catch (e) {
      logger.warn('[extractNotes] 更新会话笔记状态失败: %s', e);
    }

    const fullPrompt = `[System]\n${promptParts.mainPrompt}\n\n${promptParts.toolRules}${promptParts.persistentMemory ? '\n\n' + promptParts.persistentMemory : ''}\n\n[User]\n${promptParts.compactContext ? promptParts.compactContext + '\n\n' : ''}${promptParts.rawConversation}\n\n${promptParts.subAgentPrompt}`;

    if (effectiveSuccess) {
      // 插入 system 消息前验证会话所有权，防止越权写入
      const conversation = findConversationById(conversationId, userId);
      if (conversation) {
        try {
          const outputContent = result.output.trim() || '会话记忆已更新';
          const wrappedContent = `<session-memory-update>\n${outputContent}\n</session-memory-update>`;
          messageRepo.create({
            conversation_id: conversationId,
            role: 'system',
            content: wrappedContent,
            is_compact_summary: false,
            compact_metadata: JSON.stringify({
              source: 'session_memory',
              trigger_type: isInit ? 'init' : 'update',
            }),
          });
          messageRepo.updateConversationTimestamp(conversationId);
          logger.info('[extractNotes] session memory输出已注入到对话消息中');
        } catch (e) {
          logger.warn('[extractNotes] 注入session memory输出到对话失败: %s', e);
        }
      } else {
        logger.warn('[extractNotes] 会话所有权验证失败，跳过注入: conversationId=%s, userId=%s', conversationId, userId);
      }
    }

    if (effectiveSuccess) {
      const updatedSessionNotes = this.manager.readSessionMemory(conversationId);

      try {
        eventManager.broadcast('session_memory_activity', {
          conversation_id: conversationId,
          timestamp: new Date().toISOString(),
          trigger_type: isInit ? 'init' : 'update',
          tokens_before: tokensBefore,
          tokens_after: tokensAfter,
          summary: result.output.slice(0, 200),
          full_prompt: fullPrompt,
          session_memory_content: updatedSessionNotes,
          success: true,
          trace: result.trace ?? null,
        });
      } catch (e) {
        logger.warn('[extractNotes] 广播 session_memory_activity 事件失败: %s', e);
      }

      try {
        recordActivity(userId, {
          type: 'session_memory',
          timestamp: new Date().toISOString(),
          success: true,
          metadata: {
            conversation_id: conversationId,
            trigger_type: isInit ? 'init' : 'update',
            tokens_before: tokensBefore,
            tokens_after: tokensAfter,
            full_prompt: fullPrompt,
            session_memory_content: updatedSessionNotes,
          },
          summary: result.output.slice(0, 200),
        });
      } catch (e) {
        logger.warn('[extractNotes] 记录活动失败: %s', e);
      }
    } else {
      const failureReason = !result.success ? result.error : '模型未调用工具，笔记文件未被更新';

      try {
        eventManager.broadcast('session_memory_activity', {
          conversation_id: conversationId,
          timestamp: new Date().toISOString(),
          trigger_type: isInit ? 'init' : 'update',
          tokens_before: tokensBefore,
          tokens_after: tokensAfter,
          summary: result.output.slice(0, 200),
          full_prompt: fullPrompt,
          session_memory_content: '',
          success: false,
          error: failureReason ?? '未知错误',
          trace: result.trace ?? null,
        });
      } catch (e) {
        logger.warn('[extractNotes] 广播失败事件出错: %s', e);
      }

      try {
        recordActivity(userId, {
          type: 'session_memory',
          timestamp: new Date().toISOString(),
          success: false,
          metadata: {
            conversation_id: conversationId,
            trigger_type: isInit ? 'init' : 'update',
            tokens_before: tokensBefore,
            tokens_after: tokensAfter,
            full_prompt: fullPrompt,
          },
          summary: failureReason ?? '提取失败',
        });
      } catch (e) {
        logger.warn('[extractNotes] 记录失败活动出错: %s', e);
      }
    }

    const updatedNotes = this.manager.readSessionMemory(conversationId);

    return {
      success: effectiveSuccess,
      message: effectiveSuccess
        ? '笔记提取完成'
        : `笔记提取失败: ${!result.success ? (result.error ?? '未知错误') : '模型未调用工具，笔记文件未被更新'}`,
      content: updatedNotes,
    };
  }

  /** 删除指定会话的笔记文件，并将数据库状态重置为未初始化 */
  deleteNotes(conversationId: string, _userId?: string): DeleteResponse {
    const filePath = this.manager.findExistingFile(conversationId);

    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const db = getDb();
    db.prepare('UPDATE session_notes_state SET is_initialized = 0 WHERE conversation_id = ?').run(
      conversationId,
    );

    return {
      success: true,
      message: '笔记已删除',
    };
  }
}

export { injectSessionMemoryUpdate };
