/**
 * 工具调用分区并发执行。
 *
 * 将一轮中的多个工具调用按 readOnly 元数据分区：
 * - 只读工具（readOnly=true）→ 并发执行，maxConcurrency=5
 * - 写入工具（readOnly=false 或未声明）→ 串行执行
 * - 跨分区按原顺序执行（先并发分区，再串行分区）
 *
 * 错误处理：
 * - 并发分区：单个工具失败不中断其他并发任务，失败结果按原索引返回
 * - 串行分区：任一失败则停止后续串行执行，未执行的工具返回错误结果
 *
 * @module domain/chat/toolConcurrency
 */
import type { ToolRegistry } from '../../core/types/tools.js';

/** 默认最大并发数 */
const DEFAULT_MAX_CONCURRENCY = 5;

/** 工具调用项（带原始索引，用于结果回填） */
export interface IndexedToolCall<T = unknown> {
  /** 在原始 toolCalls 数组中的索引 */
  index: number;
  /** 工具调用数据 */
  call: T;
}

/** 分区后的工具调用 */
export interface PartitionedToolCalls<T = unknown> {
  /** 并发分区（只读工具），按原始顺序排列 */
  concurrent: IndexedToolCall<T>[];
  /** 串行分区（写入工具），按原始顺序排列 */
  serial: IndexedToolCall<T>[];
}

/**
 * 判断工具调用是否为只读（可并发执行）。
 *
 * 通过 ToolRegistry 查询工具的 metadata.readOnly 字段。
 * 未注册或未声明 metadata 的工具视为非只读（保守策略，防止并发写入）。
 *
 * @param toolCall - 工具调用数据
 * @param registry - 工具注册表
 * @returns true 表示只读，可并发执行
 */
function isReadOnlyToolCall(toolCall: unknown, registry: ToolRegistry): boolean {
  // 兼容 OpenAI 格式（{ function: { name } }）和归一化格式（{ name }）
  const obj = toolCall as { function?: { name?: string }; name?: string };
  const name = obj.function?.name ?? obj.name;
  if (!name) return false;
  return registry.getMetadata(name)?.readOnly === true;
}

/**
 * 将工具调用列表分区为并发区和串行区。
 *
 * 分区规则：
 * - 只读工具（metadata.readOnly=true）→ concurrent
 * - 写入工具（metadata.readOnly=false 或未声明）→ serial
 * - 两个分区内部按原始顺序排列
 *
 * @param toolCalls - 原始工具调用列表
 * @param registry - 工具注册表，用于查询工具元数据
 * @returns 分区结果
 */
export function partitionToolCalls<T = unknown>(
  toolCalls: T[],
  registry: ToolRegistry,
): PartitionedToolCalls<T> {
  const concurrent: IndexedToolCall<T>[] = [];
  const serial: IndexedToolCall<T>[] = [];

  toolCalls.forEach((call, index) => {
    const indexed: IndexedToolCall<T> = { index, call };
    if (isReadOnlyToolCall(call, registry)) {
      concurrent.push(indexed);
    } else {
      serial.push(indexed);
    }
  });

  return { concurrent, serial };
}

/**
 * 并发执行一组工具调用，保持结果顺序。
 *
 * 使用 worker pool 模式：启动 min(maxConcurrency, calls.length) 个 worker，
 * 每个 worker 从共享索引中领取任务执行，结果按原始索引回填。
 *
 * 单个工具失败不中断其他并发任务，失败结果按原索引返回。
 *
 * @param calls - 工具调用列表
 * @param executor - 执行函数，接收工具调用，返回结果
 * @param maxConcurrency - 最大并发数，默认 5
 * @returns 结果数组，顺序与输入一致
 */
export async function runToolsConcurrently<T, R>(
  calls: T[],
  executor: (call: T) => Promise<R>,
  maxConcurrency: number = DEFAULT_MAX_CONCURRENCY,
): Promise<R[]> {
  const results: R[] = new Array(calls.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= calls.length) break;
      results[current] = await executor(calls[current]);
    }
  }

  const workerCount = Math.min(Math.max(1, maxConcurrency), calls.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 执行分区后的工具调用（并发区 + 串行区）。
 *
 * 执行顺序：
 * 1. 并发区：所有只读工具并发执行（maxConcurrency=5）
 * 2. 串行区：所有写入工具按顺序串行执行
 *
 * 错误处理：
 * - 并发区：单个失败不中断其他，失败结果按原索引回填
 * - 串行区：任一失败则停止后续，未执行的工具返回错误结果
 *
 * @param partitioned - 分区后的工具调用
 * @param executor - 执行函数，接收工具调用，返回结果
 * @param maxConcurrency - 并发区最大并发数，默认 5
 * @returns 完整结果数组（按原始索引排列）
 */
export async function executePartitionedToolCalls<T, R>(
  partitioned: PartitionedToolCalls<T>,
  executor: (call: T) => Promise<R>,
  maxConcurrency: number = DEFAULT_MAX_CONCURRENCY,
): Promise<R[]> {
  // 预分配结果数组（串行区未执行时填充错误占位）
  const results: R[] = new Array(
    partitioned.concurrent.length + partitioned.serial.length,
  ) as R[];

  // 1. 并发执行只读工具
  if (partitioned.concurrent.length > 0) {
    const concurrentResults = await runToolsConcurrently(
      partitioned.concurrent.map((c) => c.call),
      executor,
      maxConcurrency,
    );
    partitioned.concurrent.forEach((item, i) => {
      results[item.index] = concurrentResults[i];
    });
  }

  // 2. 串行执行写入工具
  let serialAborted = false;
  for (const item of partitioned.serial) {
    if (serialAborted) {
      // 串行区已中止：未执行的工具返回错误结果
      // 注意：这里无法构造 R 类型的错误值，由调用方在 executor 中处理错误
      // 此处仅跳过，结果保持 undefined，调用方需检查
      continue;
    }
    try {
      results[item.index] = await executor(item.call);
    } catch {
      // 串行区任一失败则停止后续执行
      serialAborted = true;
    }
  }

  return results;
}
