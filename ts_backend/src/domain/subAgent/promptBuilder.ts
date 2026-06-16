/**
 * 子代理提示组装器。将主提示、工具规则、持久记忆、压缩上下文和原始对话拼接为 system + user 消息。
 *
 * 消息结构：
 * - system: mainPrompt + toolRules + persistentMemory
 * - user: compactContext + rawConversation + subAgentPrompt
 */
import type { SubAgentPromptParts } from './types.js';

/** 将各部分提示词组装为 SubAgentPromptParts 对象 */
export function buildSubAgentPromptParts(
  mainPrompt: string,
  toolRules: string,
  persistentMemory: string,
  compactContext: string,
  rawConversation: string,
  subAgentPrompt: string,
): SubAgentPromptParts {
  return {
    mainPrompt,
    toolRules,
    persistentMemory,
    compactContext,
    rawConversation,
    subAgentPrompt,
  };
}

/**
 * 将提示词各部分组装为 OpenAI 消息格式（system + user 两条消息）。
 * system 消息包含主提示、工具规则和持久记忆；user 消息包含压缩上下文、原始对话和子代理提示。
 */
export function buildSubAgentMessages(
  parts: SubAgentPromptParts,
): Array<{ role: string; content: string }> {
  const systemContent =
    parts.mainPrompt +
    '\n\n' +
    parts.toolRules +
    (parts.persistentMemory ? '\n\n' + parts.persistentMemory : '');

  const userContent =
    (parts.compactContext ? parts.compactContext + '\n\n' : '') +
    parts.rawConversation +
    '\n\n' +
    parts.subAgentPrompt;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}
