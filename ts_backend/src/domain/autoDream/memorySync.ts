/**
 * 梦境输出验证：梦境代理在第五阶段直接写入 persistent_memory.md（常驻记忆），
 * 此模块仅验证文件存在并记录状态，不再从 INDEX.md 复制。
 */
import fs from 'fs';
import { getPersistentMemoryPath } from '../../memoryStorage/paths.js';
import { createLogger } from '../../core/logger/index.js';

const logger = createLogger('DreamMemorySync');

export function updatePersistentMemoryFromDream(_memoryRoot: string): void {
  const persistentMemoryPath = getPersistentMemoryPath();

  if (!fs.existsSync(persistentMemoryPath)) {
    logger.warn('常驻记忆文件不存在，梦境代理可能未写入: %s', persistentMemoryPath);
    return;
  }

  const content = fs.readFileSync(persistentMemoryPath, 'utf-8');
  if (!content.trim()) {
    logger.warn('常驻记忆文件为空: %s', persistentMemoryPath);
    return;
  }

  const estimatedTokens = content.length * 0.5;
  logger.info(
    '常驻记忆验证通过 path=%s chars=%d estTokens=%d',
    persistentMemoryPath,
    content.length,
    Math.round(estimatedTokens),
  );
}
