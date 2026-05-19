/**
 * 梦境任务锁管理。基于文件锁 + PID 验证实现进程间互斥，
 * 防止多个后端实例同时执行梦境整固。
 */
import fs from 'fs';
import { createLogger } from '../../core/logger/index.js';
import { getAutoDreamLockPath, getAutoDreamRoot } from '../../memoryStorage/paths.js';
import { getAutoDreamConfig } from '../../config/index.js';
import { getDb } from '../../core/database/index.js';

const logger = createLogger('DreamLock');

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLastConsolidatedAt(): number {
  try {
    const stat = fs.statSync(getAutoDreamLockPath());
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

export function tryAcquireConsolidationLock(): number | null {
  const lockPath = getAutoDreamLockPath();

  let mtimeMs: number | undefined;
  let holderPid: number | undefined;

  try {
    const stat = fs.statSync(lockPath);
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    const parsed = parseInt(raw, 10);
    mtimeMs = stat.mtimeMs;
    holderPid = Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    // 锁文件不存在或内容解析错误 — 视为无先前的锁
  }

  if (mtimeMs !== undefined && Date.now() - mtimeMs < getAutoDreamConfig().holderStaleMs) {
    if (holderPid !== undefined && isProcessRunning(holderPid)) {
      logger.info(
        '锁被活跃进程 PID %d 持有（mtime %ds 前）',
        holderPid,
        Math.round((Date.now() - mtimeMs) / 1000),
      );
      return null;
    }
  }

  fs.mkdirSync(getAutoDreamRoot(), { recursive: true });
  fs.writeFileSync(lockPath, String(process.pid), 'utf8');

  try {
    const verify = fs.readFileSync(lockPath, 'utf8').trim();
    if (parseInt(verify, 10) !== process.pid) {
      logger.info('锁竞态：PID 不匹配，放弃获取');
      return null;
    }
  } catch {
    return null;
  }

  return mtimeMs ?? 0;
}

export function rollbackConsolidationLock(priorMtime: number): void {
  const lockPath = getAutoDreamLockPath();
  try {
    // 回滚前验证锁仍由当前进程持有，防止误删其他进程的锁
    try {
      const currentContent = fs.readFileSync(lockPath, 'utf8').trim();
      const currentPid = parseInt(currentContent, 10);
      if (Number.isFinite(currentPid) && currentPid !== process.pid) {
        logger.info('锁已被其他进程 PID %d 持有，跳过回滚', currentPid);
        return;
      }
    } catch {
      // 锁文件不存在，无需回滚
      return;
    }

    if (priorMtime === 0) {
      try {
        fs.unlinkSync(lockPath);
      } catch {}
      return;
    }
    fs.writeFileSync(lockPath, '', 'utf8');
    const t = priorMtime / 1000;
    fs.utimesSync(lockPath, t, t);
  } catch (e: unknown) {
    logger.warn('回滚锁文件失败: %s', (e as Error).message);
  }
}

export function recordConsolidation(): void {
  const lockPath = getAutoDreamLockPath();
  try {
    fs.mkdirSync(getAutoDreamRoot(), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
  } catch (e: unknown) {
    logger.warn('记录整固时间失败: %s', (e as Error).message);
  }
}

export function listSessionsTouchedSince(sinceMs: number): string[] {
  try {
    const db = getDb();
    const sinceDate = new Date(sinceMs).toISOString();
    const rows = db
      .prepare('SELECT DISTINCT conversation_id FROM messages WHERE created_at > ?')
      .all(sinceDate) as { conversation_id: string }[];

    return rows.map((r) => String(r.conversation_id));
  } catch {
    return [];
  }
}
