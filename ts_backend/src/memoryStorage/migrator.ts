// 记忆存储数据迁移工具：处理旧版本目录结构到新版本的自动迁移
import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger/index.js';
import { getSystemPromptsDir, getMemoryRoot, getAutoDreamRoot } from './paths.js';
import { MEMORY_TYPES } from './types.js';

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

export function migrateSessionNotesToSessionMemory(): void {
  const memoryRoot = getMemoryRoot();
  const oldDir = path.join(memoryRoot, 'session_notes');
  const newDir = path.join(memoryRoot, 'session_memory');

  if (!fs.existsSync(oldDir) || !fs.statSync(oldDir).isDirectory()) {
    return;
  }

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

    // Remove nested directory structure bottom-up
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

export function migrateSystemPrompts(db: import('../core/database/connection.js').Database): void {
  const promptsDir = getSystemPromptsDir();
  fs.mkdirSync(promptsDir, { recursive: true });

  const oldPromptsDir = path.join(getMemoryRoot(), 'system_prompts');

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
