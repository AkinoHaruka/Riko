/**
 * 会话笔记服务：管理每个对话的笔记文件（session_memory/*.md）。
 * 通过 SubAgent 驱动 AI 自动提取对话要点，维护笔记文件的新鲜度。
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
import { autoDreamConfig } from '../../config/index.js';
import { createLogger } from '../../core/logger/index.js';
import { SubAgentExecutor } from '../subAgent/executor.js';
import { buildSubAgentPromptParts } from '../subAgent/promptBuilder.js';
import type { SubAgentConfig, SubAgentPromptParts } from '../subAgent/types.js';
import type { ToolContext } from '../../tools/types.js';
import { eventManager } from '../../core/events/manager.js';
import { recordActivity } from '../../domain/monitor/service.js';
import { loadMainPrompt, loadToolRules, loadPersistentMemory } from '../../prompts/loader.js';
import { getParamValue } from '../../domain/setting/index.js';
import * as messageRepo from '../../domain/message/repository.js';

const logger = createLogger('SessionMemoryService');
const DEFAULT_MODEL = 'deepseek-v4-pro';

export interface SessionNotesResponse {
  conversation_id: string;
  content: string;
  initialized: boolean;
  file_path: string;
}

export interface ExtractResponse {
  success: boolean;
  message: string;
  content: string;
}

export interface DeleteResponse {
  success: boolean;
  message: string;
}

export class SessionMemoryService {
  private manager: SessionMemoryManager;

  constructor() {
    this.manager = new SessionMemoryManager();
  }

  getNotes(conversationId: string): SessionNotesResponse {
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
      throw new Error(`数据库未初始化: ${msg}`);
    }

    let rows: Array<{ role: string; content: string; is_compact_summary: number }>;
    try {
      rows = db
        .prepare(
          'SELECT role, content, is_compact_summary FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 200',
        )
        .all(conversationId) as Array<{
        role: string;
        content: string;
        is_compact_summary: number;
      }>;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[extractNotes] 查询消息失败: %s', msg);
      throw new Error(`查询消息失败: ${msg}`);
    }

    if (!rows || rows.length === 0) {
      throw new Error('该会话没有消息记录');
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

    const selectedModel = getParamValue(userId, 'selected_model', DEFAULT_MODEL);
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

  deleteNotes(conversationId: string): DeleteResponse {
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
