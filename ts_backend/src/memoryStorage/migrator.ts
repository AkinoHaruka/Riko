/**
 * 记忆存储数据迁移工具
 *
 * 处理旧版本目录结构到新版本的自动迁移，包括：
 * - 旧版散落文件迁移到 auto_dream 子目录
 * - session_notes 重命名为 session_memory
 * - 嵌套目录结构扁平化（按记忆类型分子目录）
 * - 数据库中的 System Prompt 迁移到文件系统
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger/index.js';
import { getSystemPromptsDir, getMemoryRoot, getAutoDreamRoot } from './paths.js';
import { MEMORY_TYPES } from './types.js';

/**
 * 跨设备安全移动文件。
 * 当源和目标不在同一文件系统时 renameSync 会抛出 EXDEV 错误，
 * 此时回退为 copy + unlink 方式。
 */
function safeMoveSync(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EXDEV') {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    } else {
      throw e;
    }
  }
}

/**
 * 迁移旧版散落在记忆根目录的文件到 auto_dream 子目录。
 *
 * 旧版结构中梦境合并产生的 .md 文件直接放在 memories/ 下，
 * 新版统一收纳到 memories/auto_dream/ 中。排除 session_notes、
 * session_memory 等非梦境目录和锁文件。
 */
export function migrateAutoDreamFiles(): void {
  const memoryRoot = getMemoryRoot();
  const autoDreamDir = path.join(memoryRoot, 'auto_dream');

  if (fs.existsSync(autoDreamDir)) {
    return;
  }

  const oldIndex = path.join(memoryRoot, 'MEMORY.md');
  if (!fs.existsSync(oldIndex)) {
    return;
  }

  // 这些目录/文件不属于梦境合并产物，迁移时跳过
  const EXCLUDED_DIRS = new Set([
    'session_notes',
    'session_memory',
    'auto_dream',
    'system_prompts',
  ]);
  const EXCLUDED_FILES = new Set(['.consolidate-lock']);

  fs.mkdirSync(autoDreamDir, { recursive: true });

  const items = fs.readdirSync(memoryRoot);
  for (const name of items) {
    const itemPath = path.join(memoryRoot, name);
    const stat = fs.statSync(itemPath);

    if (stat.isDirectory() && EXCLUDED_DIRS.has(name)) {
      continue;
    }

    if (stat.isFile() && EXCLUDED_FILES.has(name)) {
      const dest = path.join(autoDreamDir, name);
      if (!fs.existsSync(dest)) {
        safeMoveSync(itemPath, dest);
        logger.info('迁移 auto_dream 文件: %s -> %s', itemPath, dest);
      }
      continue;
    }

    if (stat.isFile() && path.extname(name) === '.md') {
      const dest = path.join(autoDreamDir, name);
      if (!fs.existsSync(dest)) {
        safeMoveSync(itemPath, dest);
        logger.info('迁移 auto_dream 文件: %s -> %s', itemPath, dest);
      }
    }
  }

  logger.info('auto_dream 旧文件迁移完成');
}

/**
 * 将 session_notes 目录重命名为 session_memory。
 *
 * 旧版使用 session_notes 命名，新版改为 session_memory 以更准确
 * 表达"会话记忆"的语义。仅在旧目录存在且新旧路径不同时执行。
 */
export function migrateSessionNotesToSessionMemory(): void {
  const memoryRoot = getMemoryRoot();
  const oldDir = path.join(memoryRoot, 'session_notes');
  const newDir = path.join(memoryRoot, 'session_memory');

  if (!fs.existsSync(oldDir) || !fs.statSync(oldDir).isDirectory()) {
    return;
  }

  // 防止大小写不敏感的文件系统上 oldDir === newDir 导致死循环
  if (path.resolve(oldDir) === path.resolve(newDir)) {
    return;
  }

  fs.mkdirSync(newDir, { recursive: true });

  const items = fs.readdirSync(oldDir);
  for (const name of items) {
    const src = path.join(oldDir, name);
    const dest = path.join(newDir, name);
    if (fs.existsSync(dest)) {
      continue;
    }
    safeMoveSync(src, dest);
    logger.info('迁移 session_notes -> session_memory: %s -> %s', src, dest);
  }

  logger.info('session_notes -> session_memory 迁移完成');
}

/** 从文件的 YAML frontmatter 中解析 type 字段，返回合法的记忆类型或 null */
function parseFrontmatterType(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;
    const fm = match[1];
    const typeMatch = fm.match(/^type:\s*(.+)$/m);
    if (!typeMatch) return null;
    const type = typeMatch[1].trim().toLowerCase();
    if ((MEMORY_TYPES as readonly string[]).includes(type)) {
      return type;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 迁移 auto_dream 目录中的嵌套和松散文件到按类型分类的子目录。
 *
 * Phase 1: 处理错误嵌套的 data/memories/auto_dream/ 目录（历史 bug 产物），
 *          将其中的 .md 文件按 frontmatter type 移入对应子目录；
 * Phase 2: 处理 auto_dream 根目录下散落的 .md 文件（INDEX.md 除外），
 *          同样按 type 分类归档。
 */
export function migrateAutoDreamNestedStructure(): void {
  const dreamRoot = getAutoDreamRoot();
  if (!fs.existsSync(dreamRoot)) return;

  const nestedDir = path.join(dreamRoot, 'data', 'memories', 'auto_dream');

  // Phase 1: Move files from nested directory to type subdirectories
  if (fs.existsSync(nestedDir)) {
    const items = fs.readdirSync(nestedDir);
    for (const name of items) {
      const srcPath = path.join(nestedDir, name);
      if (!name.endsWith('.md') || !fs.statSync(srcPath).isFile()) continue;

      const targetSubdir = parseFrontmatterType(srcPath);
      if (targetSubdir) {
        const destDir = path.join(dreamRoot, targetSubdir);
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, name);
        if (!fs.existsSync(destPath)) {
          safeMoveSync(srcPath, destPath);
          logger.info('迁移嵌套记忆文件: %s -> %s', srcPath, destPath);
        }
      }
    }

    // 自底向上清理空目录，避免残留空壳
    const pathsToRemove = [
      nestedDir,
      path.join(dreamRoot, 'data', 'memories'),
      path.join(dreamRoot, 'data'),
    ];
    for (const p of pathsToRemove) {
      try {
        if (fs.existsSync(p) && fs.readdirSync(p).length === 0) {
          fs.rmdirSync(p);
        }
      } catch {
        break;
      }
    }
    logger.info('auto_dream 嵌套目录结构清理完成');
  }

  // Phase 2: Move loose .md files in auto_dream root (except INDEX.md)
  const rootItems = fs.readdirSync(dreamRoot);
  for (const name of rootItems) {
    const srcPath = path.join(dreamRoot, name);
    if (!name.endsWith('.md') || name === 'INDEX.md' || !fs.statSync(srcPath).isFile()) continue;

    const targetSubdir = parseFrontmatterType(srcPath);
    if (targetSubdir) {
      const destDir = path.join(dreamRoot, targetSubdir);
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, name);
      if (!fs.existsSync(destPath)) {
        safeMoveSync(srcPath, destPath);
        logger.info('迁移松散记忆文件: %s -> %s', srcPath, destPath);
      }
    }
  }
}

/**
 * 迁移系统提示词到独立目录，并从数据库中提取旧版 System Prompt。
 *
 * 旧版 System Prompt 存在两个来源：
 * 1. memories/system_prompts/ 目录中的文件 → 复制到新目录
 * 2. 数据库 settings 表中的 system_prompt 键 → 写入 main_chat.md
 * 两者均只在目标文件不存在时执行，避免覆盖用户修改。
 */
export function migrateSystemPrompts(db: import('../core/database/connection.js').Database): void {
  const promptsDir = getSystemPromptsDir();
  fs.mkdirSync(promptsDir, { recursive: true });

  const oldPromptsDir = path.join(getMemoryRoot(), 'system_prompts');

  // 从旧目录复制提示词文件
  if (fs.existsSync(oldPromptsDir) && fs.statSync(oldPromptsDir).isDirectory()) {
    const items = fs.readdirSync(oldPromptsDir);
    for (const name of items) {
      const src = path.join(oldPromptsDir, name);
      const stat = fs.statSync(src);
      if (stat.isFile()) {
        const dest = path.join(promptsDir, name);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
          logger.info('迁移 system_prompts 文件: %s -> %s', src, dest);
        }
      }
    }
  }

  // 从数据库提取旧版 System Prompt 写入文件
  const mainChatPath = path.join(promptsDir, 'main_chat.md');
  if (!fs.existsSync(mainChatPath)) {
    try {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = 'system_prompt' ORDER BY user_id LIMIT 1")
        .get() as { value: string } | undefined;
      if (row && row.value && row.value.trim()) {
        fs.writeFileSync(mainChatPath, row.value, 'utf-8');
        logger.info('已从数据库迁移主聊天 System Prompt 到 system_prompts/main_chat.md');
      }
    } catch (e) {
      logger.warn('从数据库迁移 System Prompt 失败: %s', e);
    }
  }
}
