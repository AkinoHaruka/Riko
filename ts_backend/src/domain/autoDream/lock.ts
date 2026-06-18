/**
 * 梦境任务锁管理。
 * 基于文件锁 + PID 验证实现进程间互斥，防止多个后端实例同时执行梦境整固。
 * 锁文件存储当前持有进程的 PID，通过 mtime 判断锁是否过期（stale）。
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
import { createLogger } from '../../core/logger/index.js';
import { getAutoDreamLockPath, getAutoDreamRoot } from '../../memoryStorage/paths.js';
import { getAutoDreamConfig } from '../../config/index.js';
import { getDb } from '../../core/database/index.js';

const logger = createLogger('DreamLock');

/**
 * 检测指定 PID 对应的进程是否仍在运行。
 * Windows 上使用 tasklist 命令，其他平台使用 process.kill(pid, 0) 探测。
 * @security 使用 execFileSync + 参数数组防止命令注入；
 *           pid 必须为正整数，非整数直接返回 false。
 * @param pid - 待检测的进程 ID
 */
function isProcessRunning(pid: number): boolean {
  // @security pid 校验：必须为正整数，拒绝小数、负数、NaN
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    // Windows 上 process.kill(pid, 0) 行为不可靠，改用 tasklist 命令检测
    // @security 使用 execFileSync + 参数数组，避免命令注入
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
      });
      return output.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取上次整固完成的时间戳（锁文件的 mtime）。
 * @returns 上次整固的毫秒时间戳，锁文件不存在时返回 0
 */
export function readLastConsolidatedAt(): number {
  try {
    const stat = fs.statSync(getAutoDreamLockPath());
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 尝试获取整固锁。若锁被活跃进程持有且未过期则返回 null。
 * @security 锁获取后立即回读验证 PID，防止竞态条件下多个进程同时获取。
 * @returns 上次整固的 mtime（用于后续回滚），获取失败返回 null
 */
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

  // 锁未过期且持有进程仍存活，拒绝获取
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

  // 回读验证：防止写入与读取之间的竞态
  try {
    const verify = fs.readFileSync(lockPath, 'utf8').trim();
    if (parseInt(verify, 10) !== process.pid) {
      logger.info('锁竞态：PID 不匹配，放弃获取');
      return null;
    }
  } catch (e) {
    logger.warn('锁回读验证失败: %s', (e as Error).message);
    return null;
  }

  return mtimeMs ?? 0;
}

/**
 * 回滚整固锁，恢复到获取锁之前的状态。
 * @security 回滚前验证锁仍由当前进程持有，防止误删其他进程的锁。
 * @param priorMtime - 获取锁时记录的原始 mtime，0 表示之前无锁文件
 */
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
      } catch (e) {
        logger.warn('删除锁文件失败: %s', (e as Error).message);
      }
      return;
    }
    // 先写回 PID 内容（保持文件内容有效），再修改 mtime，避免中间空内容状态被其他进程误判
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
    const t = priorMtime / 1000;
    fs.utimesSync(lockPath, t, t);
  } catch (e: unknown) {
    logger.warn('回滚锁文件失败: %s', (e as Error).message);
  }
}

/**
 * 记录整固完成时间。更新锁文件的 mtime 作为下次触发的时间基准。
 */
export function recordConsolidation(): void {
  const lockPath = getAutoDreamLockPath();
  try {
    fs.mkdirSync(getAutoDreamRoot(), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid), 'utf8');
  } catch (e: unknown) {
    logger.warn('记录整固时间失败: %s', (e as Error).message);
  }
}

/**
 * 查询自指定时间以来有新消息的会话 ID 列表。
 * @param sinceMs - 起始毫秒时间戳
 * @returns 去重后的会话 ID 数组
 */
export function listSessionsTouchedSince(sinceMs: number): string[] {
  try {
    const db = getDb();
    const sinceDate = new Date(sinceMs).toISOString();
    const rows = db
      .prepare('SELECT DISTINCT conversation_id FROM messages WHERE created_at > ?')
      .all(sinceDate) as { conversation_id: string }[];

    return rows.map((r) => String(r.conversation_id));
  } catch (e) {
    logger.warn('查询会话时间戳失败: %s', (e as Error).message);
    return [];
  }
}
