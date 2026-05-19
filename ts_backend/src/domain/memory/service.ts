/**
 * 记忆业务逻辑。包含数据库记忆的 CRUD，以及同步清理文件系统中的会话笔记和梦境文件。
 */
import * as repo from './repository.js';
import type { Memory, MemoryCreateRequest } from './types.js';
import { HttpError } from '../../core/utils/index.js';
import fs from 'fs';
import path from 'path';
import { env } from '../../config/index.js';

export function getMemories(type?: string): { memories: Memory[] } {
  const memories = repo.findAll(type);
  return { memories };
}

export function searchMemories(keyword: string): { memories: Memory[] } {
  const memories = repo.search(keyword);
  return { memories };
}

export function createMemory(req: MemoryCreateRequest): Memory {
  return repo.create(req);
}

export function deleteMemory(id: string): { message: string; id: string } {
  const existing = repo.findById(id);
  if (!existing) {
    throw new HttpError(404, '记忆不存在');
  }

  repo.deleteById(id);
  return { message: '记忆已删除', id };
}

export function deleteBySource(source: string): { message: string; deleted_count: number } {
  const deletedCount = repo.deleteBySource(source);
  return { message: `已删除 ${deletedCount} 条记忆`, deleted_count: deletedCount };
}

export function clearMemories(): {
  message: string;
  deleted_count: number;
  cleared_dirs: string[];
} {
  const deletedCount = repo.clearAll();

  // 同步清理文件系统中的会话笔记、梦境文件和常驻记忆
  const root = path.resolve(env.MEMORY_ROOT_DIR);
  const dirsToClear = ['session_memory', 'auto_dream'];
  const clearedDirs: string[] = [];

  for (const dir of dirsToClear) {
    const target = path.join(root, dir);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      clearedDirs.push(dir);
    }
  }

  // 清空常驻记忆文件（覆写为空，不删除；其他模块依赖该文件存在）
  const persistentPath = path.join(root, 'persistent_memory.md');
  fs.writeFileSync(persistentPath, '', 'utf-8');

  // 重建 auto_dream 目录结构，确保后续 dream 可正常运行
  const autoDreamDir = path.join(root, 'auto_dream');
  fs.mkdirSync(autoDreamDir, { recursive: true });
  for (const type of ['traits_roles', 'interaction_rules', 'key_experiences', 'promises_goals']) {
    fs.mkdirSync(path.join(autoDreamDir, type), { recursive: true });
  }
  // 不创建 INDEX.md — 让下一次 dream 自行生成，避免空索引误导子代理

  // 重建 session_memory 空目录
  const sessionMemoryDir = path.join(root, 'session_memory');
  fs.mkdirSync(sessionMemoryDir, { recursive: true });

  return {
    message: `已清空 ${deletedCount} 条记忆，清除 ${clearedDirs.length} 个目录 + persistent_memory.md`,
    deleted_count: deletedCount,
    cleared_dirs: clearedDirs,
  };
}
