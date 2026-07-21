/**
 * 上下文压缩服务。
 * 支持三种压缩策略：legacy、micro_compact、sub_agent。
 * 负责检测分界、生成摘要、清理工具结果、事务性替换消息。
 * 当前主要使用 sub_agent 策略，由 AI 生成精简摘要。
 */
import type {
  CompactMessage,
  CompactionResult,
  AutoCompactResult,
} from './types.js';
import {
  estimateTextTokens,
  estimateMessagesTokens,
  getAutoCompactThreshold,
  splitMessagesByCompactBoundary,
} from './tokenEstimator.js';
import {
  buildCompactPrompt,
  formatCompactSummary,
  getCompactUserSummaryMessage,
  buildCompactSubAgentPrompt,
} from './prompt.js';
import {
  messagesToCompactMessages,
  stripImagesFromMessages,
  truncateHeadForPtlRetry,
  createCompactBoundaryMessage,
  selectRecentMessages,
} from './helpers.js';
import { getOrCreateClient } from '../../core/ai/client.js';
import { createLogger } from '../../core/logger/index.js';
import { SessionMemoryManager } from '../../domain/sessionMemory/manager.js';
import { listByConversation } from '../../domain/message/repository.js';
import { eventManager } from '../../core/events/manager.js';
import { recordActivity } from '../../domain/monitor/service.js';
import {
  shouldAutoCompact,
  resetCompactFailures,
  incrementCompactFailures,
} from './autoCompact.js';
import { maybeTimeBasedMicroCompact } from './microCompact.js';
import { getDb } from '../../core/database/index.js';
import { SubAgentExecutor } from '../../domain/subAgent/executor.js';
import { buildSubAgentPromptParts } from '../../domain/subAgent/promptBuilder.js';
import type {
  SubAgentConfig,
  SubAgentPromptParts,
  SubAgentTrace,
} from '../../domain/subAgent/types.js';
import { loadMainPrompt, loadToolRules, loadPersistentMemory } from '../../prompts/loader.js';
import { getParamValue } from '../../domain/setting/index.js';

const logger = createLogger('compact:service');

/** 默认模型标识，getParamValue 未找到用户设置时使用 */
const FALLBACK_MODEL = 'deepseek-v4-pro';

/** PromptTooLong 错误时的最大重试次数 */
export const MAX_PTL_RETRIES = 3;
/** 压缩摘要的最大输出 Token 数 */
export const COMPACT_MAX_OUTPUT_TOKENS = 20000;
/** 压缩后保留的最大文件附件数 */
export const POST_COMPACT_MAX_FILES = 5;
/** 压缩后附件的总 Token 预算 */
export const POST_COMPACT_TOKEN_BUDGET = 50000;
/** 单个附件的最大 Token 数 */
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5000;
/** 会话笔记附件的 Token 预算 */
export const POST_COMPACT_SESSION_NOTES_TOKEN_BUDGET = 12000;

// ─── 工具函数已迁移至 ./helpers.ts ───
export {
  messagesToCompactMessages,
  stripImagesFromMessages,
  groupMessagesByApiRound,
  truncateHeadForPtlRetry,
  createCompactBoundaryMessage,
  selectRecentMessages,
  restoreRecentMessages,
} from './helpers.js';

/**
 * 构建压缩后的完整结果对象。
 * @param newCompactSummary - 新的压缩摘要文本
 * @param recentMessages - 保留的最近消息
 * @param preCompactTokenCount - 压缩前 Token 数
 * @param isAutoCompact - 是否为自动压缩
 * @param userId - 用户 ID
 * @param preCompactMessageCount - 压缩前消息数
 * @returns 完整的压缩结果
 */
export function buildPostCompactResult(
  newCompactSummary: string,
  recentMessages: CompactMessage[],
  preCompactTokenCount: number,
  isAutoCompact: boolean,
  userId: string,
  preCompactMessageCount: number,
  model: string,
): CompactionResult {
  const recentTokens = estimateMessagesTokens(recentMessages);
  const boundaryMarker = createCompactBoundaryMessage(
    isAutoCompact ? 'auto' : 'manual',
    preCompactTokenCount,
    preCompactMessageCount,
    recentTokens,
  );

  const wrappedSummary = `<compact-context>\n${newCompactSummary}\n</compact-context>`;
  const summaryMessage: CompactMessage = {
    role: 'user',
    content: getCompactUserSummaryMessage(wrappedSummary, {
      hasRecentMessages: recentMessages.length > 0,
    }),
    is_compact_summary: true,
  };

  const result: CompactionResult = {
    boundaryMarker,
    summaryMessages: [summaryMessage],
    attachments: [],
    recentMessages,
    preCompactTokenCount,
    postCompactTokenCount: 0,
    truePostCompactTokenCount: 0,
    willRetriggerNextTurn: false,
    isAutoCompact,
  };

  const postCompactMessages = buildPostCompactMessages(result);
  const truePostCompactTokenCount = estimateMessagesTokens(postCompactMessages);
  // 压缩后仍超过阈值，下一轮将再次触发压缩
  const willRetrigger = truePostCompactTokenCount > getAutoCompactThreshold(model);

  result.postCompactTokenCount = truePostCompactTokenCount;
  result.truePostCompactTokenCount = truePostCompactTokenCount;
  result.willRetriggerNextTurn = willRetrigger;

  return result;
}

/**
 * 通过流式 API 生成压缩摘要（legacy 策略）。
 * 遇到 PromptTooLong 错误时自动截断头部重试。
 * @param messages - 待压缩的消息列表
 * @param model - 使用的模型
 * @param userId - 用户 ID
 * @param customInstructions - 自定义压缩指令（可选）
 * @returns 格式化后的压缩摘要文本
 */
export async function streamCompactSummary(
  messages: CompactMessage[],
  model: string,
  userId: string,
  customInstructions?: string | null,
): Promise<string> {
  const prompt = buildCompactPrompt(customInstructions);
  const processed = stripImagesFromMessages(messages);
  let apiMessages: CompactMessage[] = [{ role: 'user', content: prompt }, ...processed];

  const client = await getOrCreateClient(userId);

  for (let attempt = 0; attempt < MAX_PTL_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: apiMessages.map((m) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        max_tokens: COMPACT_MAX_OUTPUT_TOKENS,
        temperature: 0,
      });

      const rawSummary = response.choices[0]?.message?.content ?? '';

      // AI 返回 PromptTooLong 前缀时，截断头部重试
      if (rawSummary.startsWith('PromptTooLong')) {
        const truncated = truncateHeadForPtlRetry(apiMessages.slice(1));
        if (truncated === null) {
          throw new RuntimeError('Prompt too long and cannot truncate further');
        }
        apiMessages = [{ role: 'user', content: prompt }, ...truncated];
        continue;
      }

      return formatCompactSummary(rawSummary);
    } catch (e: unknown) {
      const errorStr = e instanceof Error ? e.message : String(e);
      if (errorStr.toLowerCase().includes('context_length')) {
        const truncated = truncateHeadForPtlRetry(apiMessages.slice(1));
        if (truncated === null) {
          throw new RuntimeError('Context length exceeded and cannot truncate further');
        }
        apiMessages = [{ role: 'user', content: prompt }, ...truncated];
        continue;
      }
      throw e;
    }
  }

  throw new RuntimeError(`Compact summary failed after ${MAX_PTL_RETRIES} attempts`);
}

/** 运行时错误，用于压缩过程中的异常 */
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/**
 * 创建压缩后的会话笔记附件。
 * 从会话笔记文件中读取内容，按 Token 预算截断后作为附件消息返回。
 * @param conversationId - 会话 ID
 * @param _maxFiles - 最大文件数（当前未使用）
 * @param _maxTokensPerFile - 单文件最大 Token 数（当前未使用）
 * @param _totalBudget - 总 Token 预算（当前未使用）
 * @returns 附件消息列表
 */
export function createPostCompactFileAttachments(
  conversationId: string,
  _maxFiles: number = POST_COMPACT_MAX_FILES,
  _maxTokensPerFile: number = POST_COMPACT_MAX_TOKENS_PER_FILE,
  _totalBudget: number = POST_COMPACT_TOKEN_BUDGET,
): CompactMessage[] {
  const manager = new SessionMemoryManager();
  let notesContent = manager.readSessionMemory(conversationId);

  if (!notesContent || !notesContent.trim()) {
    return [];
  }

  // 按 Token 预算截断会话笔记内容
  const tokenLimit = POST_COMPACT_SESSION_NOTES_TOKEN_BUDGET;
  const currentTokens = estimateTextTokens(notesContent);
  if (currentTokens > tokenLimit) {
    const ratio = tokenLimit / currentTokens;
    const targetChars = Math.floor(notesContent.length * ratio * 0.95);
    notesContent = notesContent.slice(0, targetChars);
    while (estimateTextTokens(notesContent) > tokenLimit && notesContent.length > 100) {
      notesContent = notesContent.slice(0, Math.floor(notesContent.length * 0.95));
    }
    const actualTokens = estimateTextTokens(notesContent);
    if (actualTokens > tokenLimit) {
      notesContent = notesContent.slice(
        0,
        Math.floor((notesContent.length * tokenLimit) / actualTokens),
      );
    }
  }

  return [
    {
      role: 'user',
      content: `<session_notes_attachment>\n${notesContent}\n</session_notes_attachment>`,
      is_compact_summary: false,
    },
  ];
}

/**
 * 将压缩结果的各部分按顺序组装为最终的消息列表。
 * 顺序：边界标记 → 摘要消息 → 附件 → 最近消息
 * @param result - 压缩结果
 * @returns 组装后的消息列表
 */
export function buildPostCompactMessages(result: CompactionResult): CompactMessage[] {
  return [
    result.boundaryMarker,
    ...result.summaryMessages,
    ...result.attachments,
    ...result.recentMessages,
  ];
}

/**
 * 通过 SubAgent 执行上下文压缩。
 * 将未压缩的对话内容发送给 AI，由 AI 生成精简摘要。
 * @param messages - 完整消息列表
 * @param userId - 用户 ID
 * @param customInstructions - 自定义压缩指令（可选）
 * @returns 压缩摘要文本和子代理执行追踪
 */
async function executeCompactViaSubAgent(
  messages: CompactMessage[],
  userId: string,
  customInstructions?: string | null,
): Promise<{ summary: string; trace?: SubAgentTrace }> {
  const mainPrompt = loadMainPrompt();
  const toolRules = loadToolRules();
  const persistentMemory = loadPersistentMemory();
  const { compactMessages, uncompactMessages } = splitMessagesByCompactBoundary(messages);

  // 提取已有的压缩上下文（如有）
  let compactContext = '';
  if (compactMessages.length > 0) {
    const summaryMsg = compactMessages.find((m) => m.is_compact_summary);
    if (summaryMsg) {
      compactContext = summaryMsg.content;
    }
  }

  const rawConversation = uncompactMessages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');

  const subAgentPrompt = buildCompactSubAgentPrompt(customInstructions);
  logger.info(
    '[compact] mainPrompt=%d chars, toolRules=%d chars, persistentMemory=%d chars, rawConversation=%d chars, compactContext=%d chars, subAgentPrompt(compact_prompt.md)=%d chars',
    mainPrompt.length,
    toolRules.length,
    persistentMemory.length,
    rawConversation.length,
    compactContext.length,
    subAgentPrompt.length,
  );

  const promptParts: SubAgentPromptParts = buildSubAgentPromptParts(
    mainPrompt,
    toolRules,
    persistentMemory,
    compactContext,
    rawConversation,
    subAgentPrompt,
  );

  const config: SubAgentConfig = {
    type: 'compact',
    maxTokens: COMPACT_MAX_OUTPUT_TOKENS,
    temperature: 0,
  };

  const executor = new SubAgentExecutor();
  const result = await executor.execute(config, promptParts, userId);

  if (!result.success && !result.output.trim()) {
    throw new RuntimeError(`Sub-agent compact failed: ${result.error ?? 'unknown error'}`);
  }

  // 有输出内容就使用，不论 success 标记（compact 可能不需要工具调用）
  const summaryText = result.output.trim()
    ? formatCompactSummary(result.output)
    : `[Compact completed without output]`;
  return { summary: summaryText, trace: result.trace };
}

/**
 * 执行完整的上下文压缩流程。
 * @param messages - 完整消息列表
 * @param conversationId - 会话 ID
 * @param userId - 用户 ID
 * @param _model - 模型名称（当前未使用，SubAgent 内部使用用户配置的模型）
 * @param isAutoCompact - 是否为自动压缩
 * @param customInstructions - 自定义压缩指令（可选）
 * @returns 压缩结果
 */
export async function compactConversation(
  messages: CompactMessage[],
  conversationId: string,
  userId: string,
  _model: string = FALLBACK_MODEL,
  isAutoCompact: boolean = false,
  customInstructions?: string | null,
): Promise<CompactionResult> {
  if (messages.length === 0) {
    throw new ValueError('Cannot compact an empty conversation');
  }

  const preCompactTokenCount = estimateMessagesTokens(messages);
  const { uncompactMessages } = splitMessagesByCompactBoundary(messages);
  const recentMessages = selectRecentMessages(uncompactMessages, userId);

  const { summary: summaryText, trace: compactTrace } = await executeCompactViaSubAgent(
    messages,
    userId,
    customInstructions,
  );

  // 使用用户选择的模型，兜底使用传入的 _model
  const model = getParamValue(userId, 'selected_model', _model);

  const result = buildPostCompactResult(
    summaryText,
    recentMessages,
    preCompactTokenCount,
    isAutoCompact,
    userId,
    messages.length,
    model,
  );
  result.subAgentTrace = compactTrace;

  const attachments = createPostCompactFileAttachments(conversationId);
  result.attachments = attachments;

  const postCompactMessages = buildPostCompactMessages(result);
  const truePostCompactTokenCount = estimateMessagesTokens(postCompactMessages);
  result.truePostCompactTokenCount = truePostCompactTokenCount;

  return result;
}

/** 值错误，用于输入参数校验失败 */
export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueError';
  }
}

/**
 * 压缩后的清理工作：重置会话笔记的 Token 计数状态。
 * @param conversationId - 会话 ID
 */
export async function runPostCompactCleanup(conversationId: string): Promise<void> {
  logger.info('Post-compact cleanup started for conversation %s', conversationId);

  try {
    const manager = new SessionMemoryManager();
    manager.updateState(conversationId, 0);
  } catch (e) {
    logger.error(
      'Failed to reset session notes token count for conversation %s: %s',
      conversationId,
      e,
    );
  }

  logger.info('Post-compact cleanup completed for conversation %s', conversationId);
}

/**
 * 自动压缩入口。检查是否需要压缩，若需要则执行并替换数据库中的消息。
 * @security 删除消息时通过 user_id 过滤确保数据隔离。
 * @param conversationId - 会话 ID
 * @param model - 模型名称
 * @param userId - 用户 ID
 * @returns 自动压缩结果，无需压缩时返回 null
 */
export async function autoCompactIfNeeded(
  conversationId: string,
  model: string,
  userId: string,
): Promise<AutoCompactResult | null> {
  const dbMessages = listByConversation(conversationId, userId);
  if (dbMessages.length === 0) {
    return null;
  }

  const messages = messagesToCompactMessages(dbMessages);

  if (!shouldAutoCompact(messages, model, conversationId, userId)) {
    return null;
  }

  // 优先尝试微型压缩
  const microResult = maybeTimeBasedMicroCompact(messages);
  if (microResult !== null) {
    return {
      was_compacted: true,
      strategy: 'micro_compact',
      messages: microResult,
      pre_compact_message_count: messages.length,
    };
  }

  try {
    const result = await compactConversation(
      messages,
      conversationId,
      userId,
      model,
      true,
      undefined,
    );
    resetCompactFailures(conversationId);

    const postCompactMessages = buildPostCompactMessages(result);

    // 事务性替换：删除旧消息 → 插入压缩后的消息
    const db = getDb();
    const replaceMessages = db.transaction(() => {
      // @security 通过 user_id 过滤确保只能删除自己的消息
      db.prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)',
      ).run(conversationId, userId);
      const insertStmt = db.prepare(
        'INSERT INTO messages (conversation_id, role, content, reasoning_content, is_compact_summary, compact_metadata) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const msg of postCompactMessages) {
        insertStmt.run(
          conversationId,
          msg.role,
          msg.content,
          msg.reasoning_content ?? '',
          msg.is_compact_summary ? 1 : 0,
          msg.compact_metadata ?? null,
        );
      }
    });
    replaceMessages();

    await runPostCompactCleanup(conversationId);

    eventManager.broadcast('compact_activity', {
      conversation_id: conversationId,
      timestamp: new Date().toISOString(),
      trigger_type: 'auto',
      pre_compact_tokens: result.preCompactTokenCount,
      post_compact_tokens: result.truePostCompactTokenCount,
      recent_dialogue_tokens: estimateMessagesTokens(result.recentMessages),
      strategy: 'sub_agent',
      summary: `Auto compact: ${result.preCompactTokenCount} → ${result.truePostCompactTokenCount} tokens`,
      success: true,
      trace: (result as unknown as Record<string, unknown>).subAgentTrace ?? null,
    });

    recordActivity(userId, {
      type: 'compact',
      timestamp: new Date().toISOString(),
      success: true,
      metadata: {
        conversation_id: conversationId,
        trigger_type: 'auto',
        pre_compact_tokens: result.preCompactTokenCount,
        post_compact_tokens: result.truePostCompactTokenCount,
        recent_dialogue_tokens: estimateMessagesTokens(result.recentMessages),
        strategy: 'sub_agent',
      },
      summary: `Auto compact: ${result.preCompactTokenCount} -> ${result.truePostCompactTokenCount} tokens`,
    });

    return {
      was_compacted: true,
      strategy: 'sub_agent',
      compaction_result: result,
      messages: postCompactMessages,
      pre_compact_message_count: messages.length,
    };
  } catch (e) {
    incrementCompactFailures(conversationId);
    logger.error('Auto compact failed for conversation %s: %s', conversationId, e);
    return {
      was_compacted: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
