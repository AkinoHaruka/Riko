/**
 * 提示词目录迁移工具
 *
 * 将旧版 system_prompts 目录中的提示词文件迁移到新版 prompts 目录，
 * 同时迁移常驻记忆文件从旧位置到 memories 目录。
 * 迁移采用复制策略（保留旧目录），避免数据丢失。
 */
import fs from 'fs';
import path from 'path';
import { PROMPT_DIR, PROMPT_PATHS } from './paths.js';
import { getSystemPromptsDir, getPersistentMemoryPath } from '../memoryStorage/paths.js';
import { logger } from '../core/logger/index.js';

/** 旧版路径到新版路径的映射表 */
const OLD_TO_NEW_MAPPINGS: Array<{ oldRelPath: string; newPath: string }> = [
  { oldRelPath: 'main_chat.md', newPath: PROMPT_PATHS.mainPrompt },
  {
    oldRelPath: path.join('session-memory', 'prompt.md'),
    newPath: PROMPT_PATHS.sessionMemoryPrompt,
  },
  { oldRelPath: path.join('compact', 'prompt.md'), newPath: PROMPT_PATHS.compactPrompt },
  { oldRelPath: path.join('dream', 'prompt.md'), newPath: PROMPT_PATHS.dreamPrompt },
];

/**
 * 执行提示词目录迁移。
 *
 * 遍历映射表，将旧目录中存在的文件复制到新路径。
 * 目标文件已存在时跳过，避免覆盖用户修改。
 * 迁移完成后旧目录保留，由用户手动清理。
 */
export function migratePromptDir(): void {
  const oldDir = getSystemPromptsDir();

  if (!fs.existsSync(oldDir) || !fs.statSync(oldDir).isDirectory()) {
    return;
  }

  fs.mkdirSync(PROMPT_DIR, { recursive: true });

  let migrated = 0;
  for (const mapping of OLD_TO_NEW_MAPPINGS) {
    const src = path.join(oldDir, mapping.oldRelPath);
    if (!fs.existsSync(src)) {
      continue;
    }
    if (fs.existsSync(mapping.newPath)) {
      continue;
    }
    const destDir = path.dirname(mapping.newPath);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, mapping.newPath);
    logger.info('迁移提示词文件: %s -> %s', src, mapping.newPath);
    migrated++;
  }

  // 迁移 persistent_memory.md：从旧 prompt 目录迁移到 memories 目录
  const oldPersistentMemory = path.join(oldDir, 'persistent_memory.md');
  const newPersistentMemory = getPersistentMemoryPath();
  if (fs.existsSync(oldPersistentMemory) && !fs.existsSync(newPersistentMemory)) {
    const content = fs.readFileSync(oldPersistentMemory, 'utf-8');
    if (content.trim()) {
      fs.mkdirSync(path.dirname(newPersistentMemory), { recursive: true });
      fs.copyFileSync(oldPersistentMemory, newPersistentMemory);
      logger.info('迁移常驻记忆文件: %s -> %s', oldPersistentMemory, newPersistentMemory);
      migrated++;
    }
  }

  if (migrated > 0) {
    logger.info('提示词目录迁移完成，共迁移 %d 个文件（旧目录已保留）', migrated);
  }
}
