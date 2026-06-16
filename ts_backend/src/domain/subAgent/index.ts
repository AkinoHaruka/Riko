/**
 * 子代理模块入口。导出子代理类型、执行器和提示构建器。
 * 子代理是独立的多轮 AI 对话循环，用于执行会话记忆提取、上下文压缩和梦境整固。
 */
export type { SubAgentType, SubAgentPromptParts, SubAgentResult, SubAgentConfig } from './types.js';
export { SubAgentExecutor } from './executor.js';
export { buildSubAgentPromptParts, buildSubAgentMessages } from './promptBuilder.js';
