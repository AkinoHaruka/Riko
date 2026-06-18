/**
 * 工具调用循环检测模块
 *
 * 检测 AI 在单轮对话中重复调用失败工具或重复获取相同结果的行为，
 * 防止 AI 陷入无限循环浪费 token。
 *
 * 三类检测：
 * 1. 精确重复失败：相同工具 + 相同参数反复失败
 * 2. 同工具失败：同一工具不同参数反复失败
 * 3. 幂等工具无进展：只读工具返回相同结果
 *
 * 分级响应：allow → warn → block → halt
 *
 * 移植自 hermes-agent/agent/tool_guardrails.py，适配 Riko 项目规范。
 */

import { createHash } from 'node:crypto';
import { eventManager } from '../events/index.js';
import { toolRegistry } from '../../tools/registry.js';

// ── 工具分类 ──────────────────────────────────────────────────────
// 工具的只读/变更属性由 ToolMetadata.readOnly 权威定义（见 core/types/tools.ts）。
// 此处不再维护硬编码工具名集合，避免与实际注册的工具名不一致。
// 历史问题：旧版使用 read_tool/edit_tool 等名称，但实际注册的是 Read/Edit/Grep 等，
// 导致幂等性检测完全失效。改为动态查询 ToolMetadata 后自动适配所有工具。

// ── 类型定义 ──────────────────────────────────────────────────────

/** 护栏配置 */
export interface GuardrailConfig {
  /** 是否启用警告（默认 true，警告不阻止执行） */
  warningsEnabled: boolean;
  /** 是否启用硬停止（默认 false，需显式启用） */
  hardStopEnabled: boolean;
  /** 精确重复失败：警告阈值（默认 2） */
  exactFailureWarnAfter: number;
  /** 精确重复失败：阻止阈值（默认 5） */
  exactFailureBlockAfter: number;
  /** 同工具失败：警告阈值（默认 3） */
  sameToolFailureWarnAfter: number;
  /** 同工具失败：终止阈值（默认 8） */
  sameToolFailureHaltAfter: number;
  /** 幂等工具无进展：警告阈值（默认 2） */
  noProgressWarnAfter: number;
  /** 幂等工具无进展：阻止阈值（默认 5） */
  noProgressBlockAfter: number;
}

/** 护栏决策 */
export interface GuardrailDecision {
  /** 动作：allow | warn | block | halt */
  action: 'allow' | 'warn' | 'block' | 'halt';
  /** 决策代码 */
  code: string;
  /** 人类可读消息 */
  message: string;
  /** 工具名称 */
  toolName: string;
  /** 重复次数 */
  count: number;
}

/** 工具调用签名（工具名 + 参数哈希） */
interface ToolCallSignature {
  toolName: string;
  argsHash: string;
}

// ── 默认配置 ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: GuardrailConfig = {
  warningsEnabled: true,
  hardStopEnabled: false,
  exactFailureWarnAfter: 2,
  exactFailureBlockAfter: 5,
  sameToolFailureWarnAfter: 3,
  sameToolFailureHaltAfter: 8,
  noProgressWarnAfter: 2,
  noProgressBlockAfter: 5,
};

// ── 辅助函数 ──────────────────────────────────────────────────────

/** 将工具参数规范化为排序紧凑 JSON */
function canonicalArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort(), 0);
}

/** 计算字符串的 SHA-256 哈希 */
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

/** 从工具名和参数生成调用签名 */
function makeSignature(toolName: string, args: Record<string, unknown> | undefined): ToolCallSignature {
  const canonical = canonicalArgs(args ?? {});
  return { toolName, argsHash: sha256(canonical) };
}

/**
 * 判断工具是否为幂等（只读）。
 * 从 ToolMetadata.readOnly 动态查询，未注册元数据的工具默认视为非幂等（保守策略）。
 */
function isIdempotent(toolName: string): boolean {
  const metadata = toolRegistry.getMetadata(toolName);
  return metadata?.readOnly === true;
}

/** 判断工具调用结果是否表示失败 */
function isFailedResult(result: string | null | undefined): boolean {
  if (!result) return false;
  const lower = result.slice(0, 500).toLowerCase();
  return lower.includes('"error"') || lower.includes('"failed"') || lower.startsWith('error');
}

// ── 护栏控制器 ────────────────────────────────────────────────────

/**
 * 工具调用循环检测控制器。
 *
 * 每轮对话创建一个实例，在工具调用前后分别调用 beforeCall/afterCall。
 * 检测到循环时返回 warn/block/halt 决策。
 */
export class ToolCallGuardrailController {
  private readonly config: GuardrailConfig;

  // 精确重复失败计数：签名 → 次数
  private exactFailureCounts = new Map<string, number>();
  // 同工具失败计数：工具名 → 次数
  private sameToolFailureCounts = new Map<string, number>();
  // 幂等工具无进展：签名 → (结果哈希, 重复次数)
  private noProgress = new Map<string, { resultHash: string; count: number }>();
  // 终止决策（一旦设置，后续调用直接返回）
  private haltDecision: GuardrailDecision | null = null;

  constructor(config?: Partial<GuardrailConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 重置状态（新的一轮对话开始时调用） */
  reset(): void {
    this.exactFailureCounts.clear();
    this.sameToolFailureCounts.clear();
    this.noProgress.clear();
    this.haltDecision = null;
  }

  /** 获取当前的终止决策（如果有） */
  getHaltDecision(): GuardrailDecision | null {
    return this.haltDecision;
  }

  /**
   * 工具调用前检查。
   *
   * 在硬停止启用时，检查是否已达到阻止阈值。
   * 未达到时返回 allow。
   */
  beforeCall(toolName: string, args: Record<string, unknown> | undefined): GuardrailDecision {
    const signature = makeSignature(toolName, args);
    const sigKey = `${signature.toolName}:${signature.argsHash}`;

    // 如果已有终止决策，直接返回
    if (this.haltDecision) return this.haltDecision;

    if (!this.config.hardStopEnabled) {
      return { action: 'allow', code: 'allow', message: '', toolName, count: 0 };
    }

    // 精确重复失败阻止
    const exactCount = this.exactFailureCounts.get(sigKey) ?? 0;
    if (exactCount >= this.config.exactFailureBlockAfter) {
      const decision: GuardrailDecision = {
        action: 'block',
        code: 'repeated_exact_failure_block',
        message: `阻止 ${toolName}：相同工具调用已失败 ${exactCount} 次，参数完全相同。请改变策略或说明阻碍原因。`,
        toolName,
        count: exactCount,
      };
      this.haltDecision = decision;
      emitGuardrailBlocked(decision);
      return decision;
    }

    // 幂等工具无进展阻止
    if (isIdempotent(toolName)) {
      const record = this.noProgress.get(sigKey);
      if (record && record.count >= this.config.noProgressBlockAfter) {
        const decision: GuardrailDecision = {
          action: 'block',
          code: 'idempotent_no_progress_block',
          message: `阻止 ${toolName}：此只读调用已返回相同结果 ${record.count} 次。请使用已有结果或尝试不同查询。`,
          toolName,
          count: record.count,
        };
        this.haltDecision = decision;
        emitGuardrailBlocked(decision);
        return decision;
      }
    }

    return { action: 'allow', code: 'allow', message: '', toolName, count: 0 };
  }

  /**
   * 工具调用后记录结果。
   *
   * 根据结果是否失败更新计数器，返回 warn/block/halt 决策。
   * 成功调用会清除该工具的失败计数。
   */
  afterCall(
    toolName: string,
    args: Record<string, unknown> | undefined,
    result: string | null | undefined,
    failed?: boolean,
  ): GuardrailDecision {
    if (this.haltDecision) return this.haltDecision;

    const signature = makeSignature(toolName, args);
    const sigKey = `${signature.toolName}:${signature.argsHash}`;
    const isFailed = failed ?? isFailedResult(result);

    if (isFailed) {
      // 更新精确失败计数
      const exactCount = (this.exactFailureCounts.get(sigKey) ?? 0) + 1;
      this.exactFailureCounts.set(sigKey, exactCount);
      this.noProgress.delete(sigKey);

      // 更新同工具失败计数
      const sameCount = (this.sameToolFailureCounts.get(toolName) ?? 0) + 1;
      this.sameToolFailureCounts.set(toolName, sameCount);

      // 同工具失败终止
      if (this.config.hardStopEnabled && sameCount >= this.config.sameToolFailureHaltAfter) {
        const decision: GuardrailDecision = {
          action: 'halt',
          code: 'same_tool_failure_halt',
          message: `终止 ${toolName}：本轮已失败 ${sameCount} 次。请停止重试相同失败路径，选择不同方法。`,
          toolName,
          count: sameCount,
        };
        this.haltDecision = decision;
        emitGuardrailBlocked(decision);
        return decision;
      }

      // 精确重复失败警告
      if (this.config.warningsEnabled && exactCount >= this.config.exactFailureWarnAfter) {
        return {
          action: 'warn',
          code: 'repeated_exact_failure_warning',
          message: `${toolName} 已使用相同参数失败 ${exactCount} 次。这看起来像循环，请检查错误并改变策略。`,
          toolName,
          count: exactCount,
        };
      }

      // 同工具失败警告
      if (this.config.warningsEnabled && sameCount >= this.config.sameToolFailureWarnAfter) {
        return {
          action: 'warn',
          code: 'same_tool_failure_warning',
          message: `${toolName} 本轮已失败 ${sameCount} 次。请先诊断错误再重试，或尝试不同工具。`,
          toolName,
          count: sameCount,
        };
      }

      return { action: 'allow', code: 'allow', message: '', toolName, count: exactCount };
    }

    // 成功调用：清除失败计数
    this.exactFailureCounts.delete(sigKey);
    this.sameToolFailureCounts.delete(toolName);

    // 幂等工具无进展检测
    if (isIdempotent(toolName)) {
      const resultHash = sha256(result ?? '');
      const previous = this.noProgress.get(sigKey);
      let repeatCount = 1;
      if (previous && previous.resultHash === resultHash) {
        repeatCount = previous.count + 1;
      }
      this.noProgress.set(sigKey, { resultHash, count: repeatCount });

      if (this.config.warningsEnabled && repeatCount >= this.config.noProgressWarnAfter) {
        return {
          action: 'warn',
          code: 'idempotent_no_progress_warning',
          message: `${toolName} 已返回相同结果 ${repeatCount} 次。请使用已有结果或改变查询方式。`,
          toolName,
          count: repeatCount,
        };
      }
    } else {
      this.noProgress.delete(sigKey);
    }

    return { action: 'allow', code: 'allow', message: '', toolName, count: 0 };
  }
}

/**
 * 为被阻止的工具调用生成合成结果（注入到对话中引导 AI 改变策略）。
 */
export function buildGuardrailSyntheticResult(decision: GuardrailDecision): string {
  return JSON.stringify({
    error: decision.message,
    guardrail: { action: decision.action, code: decision.code, toolName: decision.toolName, count: decision.count },
  });
}

/** 护栏阻止/终止时发射事件 */
function emitGuardrailBlocked(decision: GuardrailDecision): void {
  eventManager.emit('security:guardrail:blocked', {
    action: decision.action,
    code: decision.code,
    toolName: decision.toolName,
    count: decision.count,
    message: decision.message,
  });
}
