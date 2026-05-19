/**
 * 子代理提示组装器。将主提示、工具规则、持久记忆、压缩上下文和原始对话拼接为 system + user 消息。
 */
import type { SubAgentPromptParts } from './types.js';

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
