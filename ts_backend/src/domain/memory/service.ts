/**
 * 记忆业务逻辑层。
 * 提供记忆的查询、创建、删除和清空功能。
 * 清空操作同时清理文件系统中的记忆目录和常驻记忆文件。
 */
import * as repo from './repository.js';
import type { Memory, MemoryCreateRequest } from './types.js';
import { HttpError } from '../../core/utils/index.js';
import fs from 'fs';
import path from 'path';
import { env } from '../../config/index.js';

/**
 * 获取用户的所有记忆，支持按类型过滤。
 * @param userId - 用户 ID
 * @param type - 记忆类型（可选）
 * @returns 记忆列表
 */
export function getMemories(userId: string, type?: string): { memories: Memory[] } {
  const memories = repo.findAll(userId, type);
  return { memories };
}

/**
 * 按关键词搜索记忆。
 * @param keyword - 搜索关键词
 * @param userId - 用户 ID
 * @returns 匹配的记忆列表
 */
export function searchMemories(keyword: string, userId: string): { memories: Memory[] } {
  const memories = repo.search(keyword, userId);
  return { memories };
}

/**
 * 创建新记忆，自动注入用户 ID。
 * @param req - 创建请求
 * @param userId - 用户 ID
 * @returns 创建后的记忆对象
 */
export function createMemory(req: MemoryCreateRequest, userId: string): Memory {
  return repo.create({ ...req, user_id: userId });
}

/**
 * 删除指定记忆。
 * @param id - 记忆 ID
 * @param userId - 用户 ID
 * @returns 删除结果
 * @throws {HttpError} 404 记忆不存在
 */
export function deleteMemory(id: string, userId: string): { message: string; id: string } {
  const existing = repo.findById(id, userId);
  if (!existing) {
    throw new HttpError(404, '记忆不存在');
  }

  repo.deleteById(id, userId);
  return { message: '记忆已删除', id };
}

/**
 * 按来源删除用户的所有记忆。
 * @param source - 记忆来源标识
 * @param userId - 用户 ID
 * @returns 删除结果
 */
export function deleteMemoriesBySource(source: string, userId: string): { message: string; deleted_count: number } {
  const deletedCount = repo.deleteBySource(source, userId);
  return { message: `已删除 ${deletedCount} 条记忆`, deleted_count: deletedCount };
}

/**
 * 清空用户的所有记忆，包括数据库记录和文件系统中的记忆文件。
 * 清空后重建必要的目录结构，确保后续功能正常。
 * @param userId - 用户 ID
 * @returns 清空结果，包含删除数量和清理的目录列表
 */
export async function clearMemories(userId: string): Promise<{
  message: string;
  deleted_count: number;
  cleared_dirs: string[];
}> {
  const deletedCount = repo.clearAll(userId);

  const root = path.resolve(env.MEMORY_ROOT_DIR);
  const dirsToClear = ['session_memory', 'auto_dream'];
  const clearedDirs: string[] = [];

  for (const dir of dirsToClear) {
    const target = path.join(root, dir);
    try {
      await fs.promises.access(target);
      await fs.promises.rm(target, { recursive: true, force: true });
      clearedDirs.push(dir);
    } catch {
      // 目录不存在则跳过
    }
  }

  // 清空常驻记忆文件内容
  const persistentPath = path.join(root, 'persistent_memory.md');
  await fs.promises.mkdir(path.dirname(persistentPath), { recursive: true });
  await fs.promises.writeFile(persistentPath, '', 'utf-8');

  // 重建梦境分类子目录
  const autoDreamDir = path.join(root, 'auto_dream');
  await fs.promises.mkdir(autoDreamDir, { recursive: true });
  for (const type of ['traits_roles', 'interaction_rules', 'key_experiences', 'promises_goals', 'emotions']) {
    await fs.promises.mkdir(path.join(autoDreamDir, type), { recursive: true });
  }

  // 重建会话记忆目录
  const sessionMemoryDir = path.join(root, 'session_memory');
  await fs.promises.mkdir(sessionMemoryDir, { recursive: true });

  return {
    message: `已清空 ${deletedCount} 条记忆，清除 ${clearedDirs.length} 个目录 + persistent_memory.md`,
    deleted_count: deletedCount,
    cleared_dirs: clearedDirs,
  };
}
