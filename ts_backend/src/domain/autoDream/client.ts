/**
 * 梦境子代理客户端封装。
 * 创建 SubAgentExecutor 实例并注入权限受限的自定义工具执行器，
 * 使梦境代理在沙箱化的工具权限下运行。
 */
import { getAutoDreamConfig } from '../../config/index.js';
import { SubAgentExecutor } from '../subAgent/executor.js';
import type { SubAgentPromptParts, SubAgentConfig, SubAgentResult } from '../subAgent/types.js';
import type { ToolContext } from '../../core/types/tools.js';
import { createDreamToolExecutor } from './permissionChecker.js';
import { getParamValue } from '../setting/index.js';

/** 梦境子代理最大交互轮次，防止无限循环 */
const MAX_DREAM_TURNS = 30;
/** 默认模型标识，getParamValue 未找到用户设置时使用 */
const FALLBACK_MODEL = 'deepseek-v4-flash';

/**
 * 执行梦境子代理。
 * @param promptParts - 子代理提示词各部分
 * @param tools - 可用工具的 OpenAI 函数定义列表
 * @param userId - 当前用户 ID，用于读取用户级模型偏好
 * @param toolContext - 工具执行上下文，包含会话 ID 和记忆根路径
 * @returns 子代理执行结果（成功/失败及输出文本）
 */
export async function executeDreamSubAgent(
  promptParts: SubAgentPromptParts,
  tools: Record<string, unknown>[],
  userId: string,
  toolContext: ToolContext,
): Promise<SubAgentResult> {
  const cfg = getAutoDreamConfig();
  // 和主代理、session memory、compact 一样使用用户设置的模型
  const selectedModel = getParamValue(userId, 'selected_model', FALLBACK_MODEL);

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
