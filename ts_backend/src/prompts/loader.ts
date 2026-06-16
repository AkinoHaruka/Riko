/**
 * 提示词文件加载器
 *
 * 从文件系统加载各类型提示词模板，文件不存在或为空时返回默认值。
 * loadMainPrompt 优先从数据库读取用户编辑过的 System Prompt，
 * 数据库为空时回退到文件。
 *
 * 首次启动迁移由 migrateMainPromptToDb() 显式执行，
 * 不隐藏在 load 函数中。
 */
import fs from 'fs';
import path from 'path';
import { PROMPT_DIR, PROMPT_PATHS } from './paths.js';
import { getMemoryRoot, getPersistentMemoryPath } from '../memoryStorage/paths.js';
import { getDb } from '../core/database/index.js';

/** 加载提示词文件，文件不存在或为空时返回默认内容 */
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

/**
 * 加载主聊天 System Prompt。
 *
 * 读取优先级：
 * 1. 数据库 settings 表中用户编辑过的 system_prompt
 * 2. 文件系统中的 main_prompt.md
 *
 * 此函数是纯读取操作，不执行任何数据库写入。
 * 首次迁移请在启动时调用 migrateMainPromptToDb()。
 */
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

    // DB 为空，回退到文件（不再自动写入数据库）
    return loadFile(PROMPT_PATHS.mainPrompt, '');
  } catch {
    return loadFile(PROMPT_PATHS.mainPrompt, '');
  }
}

/**
 * 将 main_prompt.md 文件内容迁移到数据库。
 *
 * 在应用启动时显式调用一次。
 * 当数据库中无 system_prompt 但文件有内容时，
 * 将文件内容写入 settings 表，确保后续可通过前端编辑。
 * 使用事务包裹 SELECT + INSERT/UPDATE 防止并发竞态。
 *
 * @param userId - 可选的用户 ID，为空时自动查询第一个用户
 */
export function migrateMainPromptToDb(userId?: string): void {
  try {
    const db = getDb();

    // 检查数据库是否已有 system_prompt
    let existing: { value: string } | undefined;
    if (userId) {
      existing = db
        .prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'system_prompt'")
        .get(userId) as { value: string } | undefined;
    }
    if (!existing) {
      existing = db
        .prepare("SELECT value FROM settings WHERE key = 'system_prompt' ORDER BY user_id LIMIT 1")
        .get() as { value: string } | undefined;
    }
    if (existing && existing.value?.trim()) {
      return; // 已有数据，无需迁移
    }

    // 从文件加载
    const fileContent = loadFile(PROMPT_PATHS.mainPrompt, '');
    if (!fileContent.trim()) {
      return; // 文件也为空，跳过
    }

    // 确定目标用户
    const targetUserId = userId || (() => {
      const userRow = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as { id: string } | undefined;
      return userRow?.id ?? '1';
    })();
    const settingId = `setting_system_prompt_${targetUserId}`;

    // 用事务包裹防止并发竞态
    const migrateTxn = db.transaction(() => {
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
    });
    migrateTxn();
  } catch {
    // 迁移失败不影响启动
  }
}

/** 加载工具使用规则提示词 */
export function loadToolRules(): string {
  return loadFile(PROMPT_PATHS.toolRules, '');
}

/**
 * 加载常驻记忆内容。
 *
 * 优先读取 persistent_memory.md，若不存在则回退到旧版 MEMORY.md，
 * 兼容从旧版本升级的场景。
 */
export function loadPersistentMemory(): string {
  const persistentMemoryPath = getPersistentMemoryPath();
  const content = loadFile(persistentMemoryPath, '');
  if (content) {
    return content;
  }
  // 兼容旧版 MEMORY.md
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

/** 加载会话记忆提取提示词 */
export function loadSessionMemoryPrompt(): string {
  return loadFile(PROMPT_PATHS.sessionMemoryPrompt, '');
}

/** 加载上下文压缩提示词 */
export function loadCompactPrompt(): string {
  return loadFile(PROMPT_PATHS.compactPrompt, '');
}
