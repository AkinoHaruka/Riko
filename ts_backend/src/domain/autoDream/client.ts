/**
 * 梦境子代理客户端封装。创建 SubAgentExecutor 实例并注入权限受限的自定义工具执行器。
 */
import { getAutoDreamConfig } from '../../config/index.js';
import { SubAgentExecutor } from '../subAgent/executor.js';
import type { SubAgentPromptParts, SubAgentConfig, SubAgentResult } from '../subAgent/types.js';
import type { ToolContext } from '../../tools/types.js';
import { createDreamToolExecutor } from './permissionChecker.js';
import { getParamValue } from '../setting/index.js';

const MAX_DREAM_TURNS = 30;

export async function executeDreamSubAgent(
  promptParts: SubAgentPromptParts,
  tools: Record<string, unknown>[],
  userId: string,
  toolContext: ToolContext,
): Promise<SubAgentResult> {
  const cfg = getAutoDreamConfig();
  // 和主代理、session memory、compact 一样使用用户设置的模型
  const selectedModel = getParamValue(userId, 'selected_model', 'deepseek-v4-flash');

  const config: SubAgentConfig = {
    type: 'dream',
    model: selectedModel,
    temperature: cfg.temperature,
    maxTurns: MAX_DREAM_TURNS,
    tools,
    customToolExecutor: createDreamToolExecutor(toolContext),
  };

  const executor = new SubAgentExecutor();
  return executor.execute(config, promptParts, userId, {
    conversationId: toolContext.conversationId,
    memoryRoot: toolContext.memoryRoot,
  });
}
