/**
 * Skills 安装守卫。
 *
 * 对 Skill 安装实施信任/风险矩阵管控，防止高风险 Skill 被自动安装。
 *
 * 信任等级（4 级）：
 * - trusted：官方内置 Skill
 * - verified：签名验证通过的 Skill
 * - unverified：第三方未签名 Skill
 * - blocked：黑名单 Skill
 *
 * 风险等级（3 级）：
 * - low：仅含只读工具
 * - medium：含写入工具但无执行类工具
 * - high：含执行类工具（exec/eval/spawn）或网络请求类工具
 *
 * INSTALL_POLICY 4×3 矩阵决定安装决策：
 * - auto：自动安装
 * - prompt：需用户确认
 * - deny：拒绝安装
 *
 * @module domain/skill/skillsGuard
 */

/** Skill 信任等级 */
export enum SkillTrustLevel {
  /** 官方内置 */
  Trusted = 'trusted',
  /** 签名验证通过 */
  Verified = 'verified',
  /** 第三方未签名 */
  Unverified = 'unverified',
  /** 黑名单 */
  Blocked = 'blocked',
}

/** Skill 风险等级 */
export enum SkillRiskLevel {
  /** 仅含只读工具 */
  Low = 'low',
  /** 含写入工具但无执行类工具 */
  Medium = 'medium',
  /** 含执行类工具或网络请求类工具 */
  High = 'high',
}

/** 安装决策类型 */
export type InstallDecision = 'auto' | 'prompt' | 'deny';

/**
 * INSTALL_POLICY 4×3 矩阵。
 *
 * 行：信任等级（trusted/verified/unverified/blocked）
 * 列：风险等级（low/medium/high）
 * 值：安装决策（auto/prompt/deny）
 *
 * 策略原则：
 * - trusted + low/medium → auto（官方内置低中风险自动安装）
 * - trusted + high → prompt（官方内置高风险仍需确认）
 * - verified + low → auto（签名验证低风险自动安装）
 * - verified + medium → prompt（签名验证中风险需确认）
 * - verified + high → deny（签名验证高风险拒绝）
 * - unverified + low → prompt（未签名低风险需确认）
 * - unverified + medium/high → deny（未签名中高风险拒绝）
 * - blocked → deny（黑名单一律拒绝）
 */
export const INSTALL_POLICY: Record<SkillTrustLevel, Record<SkillRiskLevel, InstallDecision>> = {
  [SkillTrustLevel.Trusted]: {
    [SkillRiskLevel.Low]: 'auto',
    [SkillRiskLevel.Medium]: 'auto',
    [SkillRiskLevel.High]: 'prompt',
  },
  [SkillTrustLevel.Verified]: {
    [SkillRiskLevel.Low]: 'auto',
    [SkillRiskLevel.Medium]: 'prompt',
    [SkillRiskLevel.High]: 'deny',
  },
  [SkillTrustLevel.Unverified]: {
    [SkillRiskLevel.Low]: 'prompt',
    [SkillRiskLevel.Medium]: 'deny',
    [SkillRiskLevel.High]: 'deny',
  },
  [SkillTrustLevel.Blocked]: {
    [SkillRiskLevel.Low]: 'deny',
    [SkillRiskLevel.Medium]: 'deny',
    [SkillRiskLevel.High]: 'deny',
  },
};

/** Skill 评估输入 */
export interface SkillEvaluationInput {
  /** 信任等级 */
  trustLevel: SkillTrustLevel;
  /** 风险等级 */
  riskLevel: SkillRiskLevel;
  /** Skill 名称（用于错误消息） */
  name?: string;
}

/** Skill 评估结果 */
export interface SkillEvaluationResult {
  /** 安装决策 */
  decision: InstallDecision;
  /** 决策原因（用于日志和用户提示） */
  reason: string;
}

/**
 * 评估 Skill 安装请求。
 *
 * 根据 trustLevel 和 riskLevel 查询 INSTALL_POLICY 矩阵，返回安装决策。
 *
 * @param skill - Skill 评估输入
 * @returns 评估结果，含决策和原因
 */
export function evaluateSkillInstallation(skill: SkillEvaluationInput): SkillEvaluationResult {
  const { trustLevel, riskLevel, name } = skill;
  const skillName = name ?? '<unknown>';

  // 黑名单直接拒绝
  if (trustLevel === SkillTrustLevel.Blocked) {
    return {
      decision: 'deny',
      reason: `Skill "${skillName}" 在黑名单中，拒绝安装`,
    };
  }

  const decision = INSTALL_POLICY[trustLevel][riskLevel];

  // 根据决策生成原因
  const reasons: Record<InstallDecision, string> = {
    auto: `Skill "${skillName}" 信任等级=${trustLevel} 风险等级=${riskLevel}，自动安装`,
    prompt: `Skill "${skillName}" 信任等级=${trustLevel} 风险等级=${riskLevel}，需用户确认`,
    deny: `Skill "${skillName}" 信任等级=${trustLevel} 风险等级=${riskLevel}，拒绝安装`,
  };

  return {
    decision,
    reason: reasons[decision],
  };
}

/**
 * 根据 Skill 的工具元数据推断风险等级。
 *
 * 规则：
 * - 所有工具 readOnly=true → low
 * - 含 mutating=true 工具但无执行类工具 → medium
 * - 含执行类工具（exec/eval/spawn）或网络请求类工具 → high
 *
 * 执行类工具识别：通过工具名匹配（exec/eval/spawn/run/execute/shell）
 * 网络请求类工具识别：通过工具名匹配（fetch/http/request/curl）
 *
 * @param tools - Skill 声明的工具列表
 * @returns 风险等级
 */
export function inferRiskLevel(
  tools: Array<{ name: string; readOnly?: boolean; mutating?: boolean }>,
): SkillRiskLevel {
  if (!tools || tools.length === 0) {
    // 无工具的 Skill 视为低风险（纯 prompt 模板）
    return SkillRiskLevel.Low;
  }

  const EXEC_PATTERNS = /^(exec|eval|spawn|run|execute|shell|bash|cmd)/i;
  const NETWORK_PATTERNS = /^(fetch|http|request|curl|wget|download|upload)/i;

  for (const tool of tools) {
    // 含执行类或网络请求类工具 → high
    if (EXEC_PATTERNS.test(tool.name) || NETWORK_PATTERNS.test(tool.name)) {
      return SkillRiskLevel.High;
    }
  }

  // 含写入工具 → medium
  for (const tool of tools) {
    if (tool.mutating === true || tool.readOnly === false) {
      return SkillRiskLevel.Medium;
    }
  }

  // 全部只读 → low
  return SkillRiskLevel.Low;
}
