// 提示词文件加载器：从文件系统加载各类型提示词，文件不存在时返回默认空值
import fs from 'fs';
import path from 'path';
import { PROMPT_DIR, PROMPT_PATHS } from './paths.js';
import { getMemoryRoot, getPersistentMemoryPath } from '../memoryStorage/paths.js';
import { getDb } from '../core/database/index.js';

/** 加载提示词文件，文件不存在或为空时返回空字符串 */
export function loadFile(fullPath: string, defaultContent: string): string {
  try {
    if (!fs.existsSync(fullPath)) {
      return defaultContent;
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (!content.trim()) {
      return defaultContent;
    }
    return content;
  } catch {
    return defaultContent;
  }
}

/** @deprecated 使用各具名 loader 函数代替 */
export function loadPromptFile(relPath: string, defaultContent: string): string {
  const filePath = path.join(PROMPT_DIR, relPath);
  return loadFile(filePath, defaultContent);
}

/** 从数据库 settings 表读取 system_prompt（用户可编辑），文件兜底并自动迁移 */
export function loadMainPrompt(userId?: string): string {
  try {
    const db = getDb();
    // 优先按指定用户查询，否则取第一个用户
    let row: { value: string } | undefined;
    if (userId) {
      row = db
        .prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'system_prompt'")
        .get(userId) as { value: string } | undefined;
    }
    if (!row || !row.value?.trim()) {
      row = db
        .prepare("SELECT value FROM settings WHERE key = 'system_prompt' ORDER BY user_id LIMIT 1")
        .get() as { value: string } | undefined;
    }
    if (row && row.value && row.value.trim()) {
      return row.value;
    }

    // DB 为空，尝试从文件加载并自动迁移到数据库
    const fileContent = loadFile(PROMPT_PATHS.mainPrompt, '');
    if (fileContent.trim()) {
      const targetUserId = userId || '1';
      const settingId = `setting_system_prompt_${targetUserId}`;
      try {
        db.prepare(
          "INSERT INTO settings (id, user_id, key, value, is_encrypted) VALUES (?, ?, 'system_prompt', ?, 0)",
        ).run(settingId, targetUserId, fileContent);
      } catch {
        try {
          db.prepare(
            "UPDATE settings SET value = ? WHERE user_id = ? AND key = 'system_prompt'",
          ).run(fileContent, targetUserId);
        } catch {
          /* ignore */
        }
      }
      return fileContent;
    }
    return '';
  } catch {
    return loadFile(PROMPT_PATHS.mainPrompt, '');
  }
}

export function loadToolRules(): string {
  return loadFile(PROMPT_PATHS.toolRules, '');
}

export function loadPersistentMemory(): string {
  const persistentMemoryPath = getPersistentMemoryPath();
  const content = loadFile(persistentMemoryPath, '');
  if (content) {
    return content;
  }
  const memoryMdPath = path.join(getMemoryRoot(), 'MEMORY.md');
  try {
    if (fs.existsSync(memoryMdPath)) {
      const mdContent = fs.readFileSync(memoryMdPath, 'utf-8');
      if (mdContent.trim()) {
        return mdContent;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

export function loadSessionMemoryPrompt(): string {
  return loadFile(PROMPT_PATHS.sessionMemoryPrompt, '');
}

export function loadCompactPrompt(): string {
  return loadFile(PROMPT_PATHS.compactPrompt, '');
}
