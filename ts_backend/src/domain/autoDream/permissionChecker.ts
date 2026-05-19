/**
 * 梦境子代理的路径权限检查器。限制工具调用只允许操作特定目录结构：
 * Read/Grep/Glob 全局可访问，Edit/Write 仅 persistent_memory.md、INDEX.md 和分类子目录（扁平，无嵌套）。
 */
import path from 'path';
import { toolRegistry } from '../../tools/registry.js';
import { getAutoDreamRoot } from '../../memoryStorage/paths.js';
import { MEMORY_TYPES } from '../../memoryStorage/types.js';
import type { ToolContext } from '../../tools/types.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('DreamPerms');

type PathZone = 'resident' | 'index' | 'subdir' | 'nested' | 'outside' | 'invalid';

function checkPathZone(filePath: string, autoDreamRoot: string): PathZone {
  if (!filePath) return 'invalid';

  // persistent_memory.md 位于记忆根目录（auto_dream 的上级），由 resolveVirtualPath 路由
  if (path.basename(filePath) === 'persistent_memory.md') {
    return 'resident';
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

export function createDreamToolExecutor(
  toolContext: ToolContext,
): (name: string, args: Record<string, unknown>) => string {
  const autoDreamRoot = getAutoDreamRoot();

  return (name: string, args: Record<string, unknown>): string => {
    // Read/Grep/Glob: global access for context gathering
    if (name === 'Read' || name === 'Grep' || name === 'Glob') {
      return executeWithRegistry(name, args, toolContext);
    }

    // Edit: resident memory, INDEX.md, or category subdirectories (flat, no nesting)
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
      return executeWithRegistry(name, args, toolContext);
    }

    // Write: resident memory, INDEX.md, or category subdirectories (flat, no nesting)
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
      return executeWithRegistry(name, args, toolContext);
    }

    // All other tools: denied
    logger.warn('Dream 工具被拒绝: %s（不在允许列表中）', name);
    return JSON.stringify({
      success: false,
      error: `工具 "${name}" 在梦境子代理中不可用。允许的工具: Read, Grep, Glob, Edit, Write。`,
    });
  };
}
