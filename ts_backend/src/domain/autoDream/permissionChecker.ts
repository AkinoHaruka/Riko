/**
 * 梦境子代理的路径权限检查器。
 * @security 限制工具调用只允许操作特定目录结构：
 * - Read/Grep/Glob：全局可访问（只读操作无安全风险）
 * - Edit/Write：仅允许修改 persistent_memory.md、INDEX.md 和分类子目录下的文件（扁平结构，禁止嵌套）
 * - 其他工具：一律拒绝
 *
 * 路径分区（PathZone）定义：
 * - resident: 常驻记忆文件 persistent_memory.md
 * - index: 索引文件 INDEX.md
 * - subdir: 分类子目录下的直接文件（允许）
 * - nested: 分类子目录下的嵌套文件（禁止）
 * - outside: 超出梦境根目录的路径（禁止）
 * - invalid: 无效路径（禁止）
 */
import path from 'path';
import { toolRegistry } from '../../tools/registry.js';
import { getAutoDreamRoot, getMemoryRoot } from '../../memoryStorage/paths.js';
import { MEMORY_TYPES } from '../../memoryStorage/types.js';
import type { ToolContext } from '../../core/types/tools.js';
import { createLogger } from '../../core/logger/index.js';
import { firstThreatMessage } from '../../core/security/index.js';

const logger = createLogger('DreamPerms');

type PathZone = 'resident' | 'index' | 'subdir' | 'nested' | 'outside' | 'invalid';

/**
 * 判断文件路径所属的安全分区。
 * @security 通过 path.resolve 防止路径遍历攻击（如 ../../etc/passwd）。
 * @param filePath - 待检查的文件路径
 * @param autoDreamRoot - 梦境文件根目录的绝对路径
 * @returns 路径所属的安全分区
 */
function checkPathZone(filePath: string, autoDreamRoot: string): PathZone {
  if (!filePath) return 'invalid';

  const memoryRoot = path.resolve(getMemoryRoot());

  // persistent_memory.md 必须位于记忆根目录下，不能仅凭文件名判断
  if (path.basename(filePath) === 'persistent_memory.md') {
    const resolved = path.resolve(memoryRoot, filePath);
    const expectedPath = path.join(memoryRoot, 'persistent_memory.md');
    if (resolved === expectedPath) {
      return 'resident';
    }
    // 文件名匹配但路径不在记忆根目录下，继续后续检查
  }

  const rootResolved = path.resolve(autoDreamRoot);

  // 剥离 AI 误传的 memoryRoot 前缀（与 resolveVirtualPath 保持一致）
  let cleanPath = filePath;
  const rootRelativeToCwd = path.relative(process.cwd(), rootResolved).replace(/\\/g, '/');
  const normalized = filePath.replace(/\\/g, '/');
  if (rootRelativeToCwd && normalized.startsWith(rootRelativeToCwd + '/')) {
    cleanPath = normalized.slice(rootRelativeToCwd.length + 1);
  }

  const resolved = path.resolve(rootResolved, cleanPath);

  // 路径必须在梦境根目录内，防止目录遍历
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    return 'outside';
  }

  if (resolved === path.join(rootResolved, 'INDEX.md')) {
    return 'index';
  }

  for (const type of MEMORY_TYPES) {
    const typeDir = path.join(rootResolved, type);
    if (resolved.startsWith(typeDir + path.sep)) {
      // 只允许直接在分类子目录下的文件，不允许嵌套子目录
      const parentDir = path.dirname(resolved);
      if (parentDir === typeDir) {
        return 'subdir';
      }
      return 'nested';
    }
  }

  return 'invalid';
}

/**
 * 通过工具注册表执行指定工具，包含参数校验和异常捕获。
 * @param name - 工具名称
 * @param args - 工具参数
 * @param context - 工具执行上下文
 * @returns JSON 格式的执行结果
 */
function executeWithRegistry(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): string {
  const handler = toolRegistry.get(name);
  if (!handler) {
    return JSON.stringify({ success: false, error: `未知工具: ${name}` });
  }
  if (handler.validate) {
    const validation = handler.validate(args, context);
    if (!validation.valid) {
      return JSON.stringify({ success: false, error: validation.error });
    }
  }
  try {
    const result = handler.execute(args, context);
    return JSON.stringify(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ success: false, error: `工具执行异常: ${message}` });
  }
}

/**
 * 创建梦境子代理的自定义工具执行器。
 * @security 所有写操作（Edit/Write）都经过路径分区检查，
 *          仅允许修改常驻记忆、索引文件和分类子目录下的扁平文件。
 * @param toolContext - 工具执行上下文
 * @returns 带权限检查的工具执行函数
 */
export function createDreamToolExecutor(
  toolContext: ToolContext,
): (name: string, args: Record<string, unknown>) => string {
  const autoDreamRoot = getAutoDreamRoot();

  return (name: string, args: Record<string, unknown>): string => {
    // Read/Grep/Glob: 只读操作，全局可访问
    if (name === 'Read' || name === 'Grep' || name === 'Glob') {
      return executeWithRegistry(name, args, toolContext);
    }

    // Edit: 仅允许修改常驻记忆、索引文件和分类子目录下的扁平文件
    if (name === 'Edit') {
      const filePath = String(args.file_path ?? '');
      const zone = checkPathZone(filePath, autoDreamRoot);
      if (zone !== 'resident' && zone !== 'index' && zone !== 'subdir') {
        logger.warn('Dream Edit 被拒绝: %s (zone=%s)', filePath, zone);
        return JSON.stringify({
          success: false,
          error: `Edit被拒绝：仅允许修改 persistent_memory.md、INDEX.md 或直接在四个分类子目录下的文件（不允许嵌套子目录）。路径: ${filePath}`,
        });
      }
      // 写入前威胁扫描：防止间接提示注入通过梦境写入攻击系统提示词
      const newContent = String(args.new_string ?? '');
      const threatMsg = firstThreatMessage(newContent, 'strict');
      if (threatMsg) {
        logger.warn('Dream Edit 威胁扫描拦截: %s - %s', filePath, threatMsg);
        return JSON.stringify({ success: false, error: `安全扫描拦截：${threatMsg}` });
      }
      return executeWithRegistry(name, args, toolContext);
    }

    // Write: 与 Edit 权限一致，额外拒绝空内容和 .gitkeep 文件
    if (name === 'Write') {
      const filePath = String(args.file_path ?? '');
      const content = String(args.content ?? '');
      // 拒绝 .gitkeep 和空内容写入（防止产生空占位文件）
      if (path.basename(filePath) === '.gitkeep') {
        return JSON.stringify({
          success: false,
          error: 'Write被拒绝：不允许创建 .gitkeep 占位文件。请在子目录下直接写入有内容的记忆文件。',
        });
      }
      if (content.trim().length === 0) {
        return JSON.stringify({
          success: false,
          error: 'Write被拒绝：不允许写入空内容。请写入有价值的记忆内容。',
        });
      }
      const zone = checkPathZone(filePath, autoDreamRoot);
      if (zone !== 'resident' && zone !== 'subdir' && zone !== 'index') {
        logger.warn('Dream Write 被拒绝: %s (zone=%s)', filePath, zone);
        return JSON.stringify({
          success: false,
          error: `Write被拒绝：仅允许直接在四个分类子目录下创建或覆写文件、persistent_memory.md 或 INDEX.md。不允许嵌套子目录。路径: ${filePath}`,
        });
      }
      // 写入前威胁扫描：防止间接提示注入通过梦境写入攻击系统提示词
      const threatMsg = firstThreatMessage(content, 'strict');
      if (threatMsg) {
        logger.warn('Dream Write 威胁扫描拦截: %s - %s', filePath, threatMsg);
        return JSON.stringify({ success: false, error: `安全扫描拦截：${threatMsg}` });
      }
      return executeWithRegistry(name, args, toolContext);
    }

    // 其他工具一律拒绝
    logger.warn('Dream 工具被拒绝: %s（不在允许列表中）', name);
    return JSON.stringify({
      success: false,
      error: `工具 "${name}" 在梦境子代理中不可用。允许的工具: Read, Grep, Glob, Edit, Write。`,
    });
  };
}
