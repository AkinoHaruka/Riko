/**
 * 上下文压缩服务。支持三种压缩策略：legacy、micro_compact、sub_agent。
 * 负责检测分界、生成摘要、清理工具结果、事务性替换消息。
 */
import type {
  CompactMessage,
  CompactionResult,
  AutoCompactResult,
  CompactBoundaryMetadata,
} from './types.js';
import {
  estimateTextTokens,
  estimateMessageTokens,
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
import { getOrCreateClient } from '../../core/ai/client.js';
import { createLogger } from '../../core/logger/index.js';
import { SessionMemoryManager } from '../../domain/sessionMemory/manager.js';
import { listByConversation } from '../../domain/message/repository.js';
import type { Message } from '../../domain/message/types.js';
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
import { getParamNumberWithDefault, PARAM_KEYS } from '../../domain/setting/index.js';
import { loadMainPrompt, loadToolRules, loadPersistentMemory } from '../../prompts/loader.js';

const logger = createLogger('compact:service');

export const MAX_PTL_RETRIES = 3;
export const COMPACT_MAX_OUTPUT_TOKENS = 20000;
export const POST_COMPACT_MAX_FILES = 5;
export const POST_COMPACT_TOKEN_BUDGET = 50000;
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5000;
export const POST_COMPACT_SESSION_NOTES_TOKEN_BUDGET = 12000;

const SYNTHETIC_USER_MARKER: CompactMessage = {
  role: 'user',
  content: '[Previous conversation truncated]',
};

export function messagesToCompactMessages(messages: Message[]): CompactMessage[] {
  return messages.map((m) => {
    const result: CompactMessage = { role: m.role, content: m.content };
    if (m.reasoning_content) {
      result.reasoning_content = m.reasoning_content;
    }
    if (m.is_compact_summary) {
      result.is_compact_summary = Boolean(m.is_compact_summary);
    }
    if (m.compact_metadata) {
      result.compact_metadata = m.compact_metadata;
    }
    if (m.created_at) {
      result.created_at = m.created_at;
    }
    return result;
  });
}

export function stripImagesFromMessages(messages: CompactMessage[]): CompactMessage[] {
  const result: CompactMessage[] = messages.map((m) => ({ ...m }));
  for (const msg of result) {
    if (msg.role !== 'user') {
      continue;
    }
    let content = msg.content;
    if (typeof content !== 'string') {
      continue;
    }
    content = content.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[image]');
    if (content.length > 10000 && /[A-Za-z0-9+/=]{10000,}/.test(content)) {
      content = content.replace(/[A-Za-z0-9+/=]{10000,}/g, '[image]');
    }
    msg.content = content;
  }
  return result;
}

export function groupMessagesByApiRound(messages: CompactMessage[]): CompactMessage[][] {
  if (messages.length === 0) {
    return [];
  }
  const groups: CompactMessage[][] = [];
  let current: CompactMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'user' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

export function truncateHeadForPtlRetry(
  messages: CompactMessage[],
  tokenGap?: number,
): CompactMessage[] | null {
  const groups = groupMessagesByApiRound(messages);
  if (groups.length < 2) {
    return null;
  }
  let remaining: CompactMessage[][];
  if (tokenGap !== undefined) {
    let dropCount = 0;
    let accumulated = 0;
    for (let i = 0; i < groups.length; i++) {
      if (accumulated >= tokenGap) {
        break;
      }
      accumulated += groups[i].reduce((sum, m) => sum + estimateTextTokens(m.content ?? ''), 0);
      dropCount = i + 1;
    }
    remaining = groups.slice(dropCount);
  } else {
    const dropCount = Math.max(1, Math.floor(groups.length / 5));
    remaining = groups.slice(dropCount);
  }
  if (remaining.length === 0) {
    remaining = [groups[groups.length - 1]];
  }
  const flat: CompactMessage[] = remaining.flat();
  if (flat.length > 0 && flat[0].role === 'assistant') {
    return [{ ...SYNTHETIC_USER_MARKER }, ...flat];
  }
  return flat;
}

export function createCompactBoundaryMessage(
  trigger: 'auto' | 'manual',
  preCompactTokens: number,
  preCompactMessageCount: number,
  postCompactRecentTokens?: number,
): CompactMessage {
  const metadata: CompactBoundaryMetadata = {
    type: 'compact_boundary',
    trigger,
    preCompactTokenCount: preCompactTokens,
    preCompactMessageCount,
    timestamp: new Date().toISOString(),
    compactStrategy: 'sub_agent',
    post_compact_recent_tokens: postCompactRecentTokens,
  };
  return {
    role: 'system',
    content: '',
    compact_metadata: JSON.stringify(metadata),
  };
}

export function selectRecentMessages(messages: CompactMessage[], userId: string): CompactMessage[] {
  const recentDialogueTokens = getParamNumberWithDefault(
    userId,
    PARAM_KEYS.COMPACT_RECENT_DIALOGUE_TOKENS,
  );
  if (messages.length === 0) {
    return [];
  }
  let accumulated = 0;
  let cutIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += estimateMessageTokens(messages[i]);
    // 使用与 estimateMessagesTokens 一致的 4/3 开销因子
    if (Math.ceil((accumulated * 4) / 3) >= recentDialogueTokens) {
      cutIndex = i;
      break;
    }
  }
  return messages.slice(cutIndex);
}

export function buildPostCompactResult(
  newCompactSummary: string,
  recentMessages: CompactMessage[],
  preCompactTokenCount: number,
  isAutoCompact: boolean,
  userId: string,
  preCompactMessageCount: number,
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
  const willRetrigger = truePostCompactTokenCount > getAutoCompactThreshold('deepseek-v4-pro');

  result.postCompactTokenCount = truePostCompactTokenCount;
  result.truePostCompactTokenCount = truePostCompactTokenCount;
  result.willRetriggerNextTurn = willRetrigger;

  return result;
}

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

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

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

export function buildPostCompactMessages(result: CompactionResult): CompactMessage[] {
  return [
    result.boundaryMarker,
    ...result.summaryMessages,
    ...result.attachments,
    ...result.recentMessages,
  ];
}

/** 通过 SubAgent 执行上下文压缩。将未压缩的对话内容发送给 AI，由 AI 生成精简摘要。 */
async function executeCompactViaSubAgent(
  messages: CompactMessage[],
  userId: string,
  customInstructions?: string | null,
): Promise<{ summary: string; trace?: SubAgentTrace }> {
  const mainPrompt = loadMainPrompt();
  const toolRules = loadToolRules();
  const persistentMemory = loadPersistentMemory();
  const { compactMessages, uncompactMessages } = splitMessagesByCompactBoundary(messages);

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

export async function compactConversation(
  messages: CompactMessage[],
  conversationId: string,
  userId: string,
  _model: string = 'deepseek-v4-pro',
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

  const result = buildPostCompactResult(
    summaryText,
    recentMessages,
    preCompactTokenCount,
    isAutoCompact,
    userId,
    messages.length,
  );
  // 将子代理执行轨迹附加到结果上
  (result as unknown as Record<string, unknown>).subAgentTrace = compactTrace;

  const attachments = createPostCompactFileAttachments(conversationId);
  result.attachments = attachments;

  const postCompactMessages = buildPostCompactMessages(result);
  const truePostCompactTokenCount = estimateMessagesTokens(postCompactMessages);
  result.truePostCompactTokenCount = truePostCompactTokenCount;

  return result;
}

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueError';
  }
}

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

    const db = getDb();
    const replaceMessages = db.transaction(() => {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
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
