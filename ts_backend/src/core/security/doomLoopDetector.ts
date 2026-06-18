/**
 * Doom Loop 检测器。
 *
 * 检测子代理执行中的模式级循环（如"读 A → 写 B → 读 A → 写 B"），
 * 与现有 toolGuardrails 互补：toolGuardrails 检测单轮内的参数级重复，
 * DoomLoopDetector 检测跨轮的签名级重复。
 *
 * 核心算法：
 * 1. `stableStringify(obj)`：键序无关序列化，确保 `{a:1,b:2}` 与 `{b:2,a:1}` 生成相同字符串
 * 2. `stepSignature(turn)`：对每轮的工具调用序列计算签名（工具名 + 参数哈希）
 * 3. 连续 N 次相同签名 → 触发 Doom Loop，注入 DOOM_LOOP_BREAKER 提示
 *
 * @module core/security/doomLoopDetector
 */
import crypto from 'crypto';

/** 触发 Doom Loop 的连续相同签名次数阈值 */
const DOOM_LOOP_THRESHOLD = 3;

/**
 * 键序无关的对象序列化。
 *
 * 对象的键按字典序排序后序列化，确保 `{a:1,b:2}` 与 `{b:2,a:1}` 生成相同字符串。
 * 用于计算工具参数的稳定哈希，避免参数键序差异导致签名变化。
 *
 * @param obj - 任意值
 * @returns 键序无关的 JSON 字符串
 */
export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

/** 单轮工具调用序列的最小结构 */
export interface TurnToolCalls {
  /** 工具调用列表 */
  toolCalls: Array<{
    /** 工具名称 */
    name: string;
    /** 工具参数（对象或 JSON 字符串） */
    arguments: Record<string, unknown> | string;
  }>;
}

/**
 * 计算单轮工具调用序列的签名。
 *
 * 签名规则：
 * 1. 对每个工具调用，提取 name + arguments 的稳定序列化
 * 2. 按工具名排序（确保工具调用顺序无关）
 * 3. 拼接后计算 SHA-256 哈希
 *
 * 这样，两轮中"读 A → 写 B"和"写 B → 读 A"会生成相同签名（如果参数相同）。
 *
 * @param turn - 单轮工具调用数据
 * @returns 64 字符十六进制 SHA-256 签名
 */
export function stepSignature(turn: TurnToolCalls): string {
  // 对每个工具调用提取 name + arguments 的稳定序列化
  const normalized = turn.toolCalls.map((tc) => {
    const args =
      typeof tc.arguments === 'string'
        ? safeParseJson(tc.arguments)
        : tc.arguments;
    return {
      name: tc.name,
      args: stableStringify(args),
    };
  });

  // 按工具名排序（工具调用顺序无关）
  normalized.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // 拼接后计算 SHA-256
  const payload = normalized.map((n) => `${n.name}:${n.args}`).join('|');
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * 安全解析 JSON 字符串，解析失败返回原始字符串。
 *
 * @param str - JSON 字符串
 * @returns 解析后的对象或原始字符串
 */
function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

/**
 * Doom Loop 检测器。
 *
 * 维护最近 N 轮的签名队列，检测连续相同的签名。
 * 连续 3 次相同签名 → 触发 Doom Loop。
 */
export class DoomLoopDetector {
  /** 签名队列（最近 N 轮） */
  private readonly signatures: string[] = [];
  /** 触发阈值，默认 3 */
  private readonly threshold: number;
  /** 是否已触发 Doom Loop */
  private triggered = false;

  constructor(threshold: number = DOOM_LOOP_THRESHOLD) {
    this.threshold = threshold;
  }

  /**
   * 观察一轮工具调用，返回是否触发 Doom Loop。
   *
   * @param turn - 单轮工具调用数据
   * @returns true 表示触发 Doom Loop（连续 N 次相同签名）
   */
  observe(turn: TurnToolCalls): boolean {
    // 已触发后不再重复触发，需调用 reset() 重置
    if (this.triggered) return true;

    const sig = stepSignature(turn);
    this.signatures.push(sig);

    // 仅保留最近 threshold 轮的签名
    if (this.signatures.length > this.threshold) {
      this.signatures.shift();
    }

    // 检查是否连续 threshold 次相同签名
    if (this.signatures.length >= this.threshold) {
      const lastSig = this.signatures[this.signatures.length - 1];
      const allSame = this.signatures.every((s) => s === lastSig);
      if (allSame) {
        this.triggered = true;
        return true;
      }
    }

    return false;
  }

  /** 是否已触发 Doom Loop */
  isTriggered(): boolean {
    return this.triggered;
  }

  /** 重置检测器状态（新一轮对话或手动恢复时调用） */
  reset(): void {
    this.signatures.length = 0;
    this.triggered = false;
  }

  /** 获取当前签名队列（用于调试） */
  getSignatures(): string[] {
    return [...this.signatures];
  }
}

/**
 * 停滞检测器。
 *
 * 检测长时间无进展的情况（如连续 N 轮工具调用结果相同但未完成任务）。
 * 与 DoomLoopDetector 互补：前者检测完全相同的循环，后者检测结果停滞。
 */
export class StagnationDetector {
  /** 结果哈希队列 */
  private readonly resultHashes: string[] = [];
  /** 触发阈值 */
  private readonly threshold: number;
  private triggered = false;

  constructor(threshold: number = 5) {
    this.threshold = threshold;
  }

  /**
   * 观察一轮工具调用结果，返回是否触发停滞。
   *
   * @param results - 单轮所有工具调用的结果数组
   * @returns true 表示触发停滞（连续 N 轮结果相同）
   */
  observe(results: unknown[]): boolean {
    if (this.triggered) return true;

    const hash = crypto
      .createHash('sha256')
      .update(stableStringify(results), 'utf8')
      .digest('hex');
    this.resultHashes.push(hash);

    if (this.resultHashes.length > this.threshold) {
      this.resultHashes.shift();
    }

    if (this.resultHashes.length >= this.threshold) {
      const lastHash = this.resultHashes[this.resultHashes.length - 1];
      const allSame = this.resultHashes.every((h) => h === lastHash);
      if (allSame) {
        this.triggered = true;
        return true;
      }
    }

    return false;
  }

  isTriggered(): boolean {
    return this.triggered;
  }

  reset(): void {
    this.resultHashes.length = 0;
    this.triggered = false;
  }
}

/**
 * Doom Loop Breaker 提示文本。
 *
 * 触发 Doom Loop 时注入到子代理的 system prompt，
 * 强制 AI 改变策略或终止任务。
 */
export const DOOM_LOOP_BREAKER = `[系统警告] 检测到工具调用模式循环（Doom Loop）。
你正在重复执行相同的工具调用序列，但没有取得进展。
请立即：
1. 停止当前的工具调用模式
2. 重新评估任务状态，思考是否有其他解决路径
3. 如果当前方法确实无法取得进展，请总结已完成的工作和遇到的阻碍，返回结果
4. 不要再重复相同的工具调用序列`;

/**
 * 停滞警告提示文本。
 *
 * 触发停滞检测时注入到子代理的 system prompt。
 */
export const STAGNATION_WARNING = `[系统提示] 检测到工具调用结果停滞。
你连续多轮获得了相同的结果，可能陷入了无效循环。
请考虑：
1. 改变工具调用参数或调用不同的工具
2. 重新审视任务目标，确认当前方法是否正确
3. 如果任务已完成，请返回最终结果`;
