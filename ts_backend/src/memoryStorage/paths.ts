// 记忆存储路径管理：获取/创建记忆根目录、自动梦境目录、常驻记忆文件路径
import fs from 'fs';
import path from 'path';
import { autoDreamConfig } from '../config/index.js';
import { logger } from '../core/logger/index.js';
import { MEMORY_TYPES, MEMORY_TYPES_INFO } from './types.js';

export function getMemoryRoot(): string {
  return process.env.MEMORY_ROOT_DIR || autoDreamConfig.memoryRootDir;
}

export function getSystemPromptsDir(): string {
  return process.env.SYSTEM_PROMPTS_DIR || autoDreamConfig.systemPromptsDir;
}

export function isAutoMemoryEnabled(): boolean {
  const disable = (process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY || '').trim().toLowerCase();
  if (disable === '1' || disable === 'true' || disable === 'yes') {
    return false;
  }
  return true;
}

export function getAutoDreamRoot(): string {
  return path.join(getMemoryRoot(), 'auto_dream');
}

export function getAutoDreamIndexPath(): string {
  return path.join(getAutoDreamRoot(), 'INDEX.md');
}

export function getAutoDreamLockPath(): string {
  return path.join(getAutoDreamRoot(), '.consolidate-lock');
}

export function ensureAutoDreamDirExists(): void {
  const dreamRoot = getAutoDreamRoot();
  fs.mkdirSync(dreamRoot, { recursive: true });

  // 创建四个分类子目录
  for (const type of MEMORY_TYPES) {
    fs.mkdirSync(path.join(dreamRoot, type), { recursive: true });
  }

  const indexPath = path.join(dreamRoot, 'INDEX.md');
  if (!fs.existsSync(indexPath)) {
    const typeDescriptions = MEMORY_TYPES.map((t) => {
      const info = MEMORY_TYPES_INFO[t];
      return `| \`${t}/\` | ${t} | ${info} |`;
    }).join('\n');
    fs.writeFileSync(
      indexPath,
      `# 梦境记忆索引

这是自动梦境系统的记忆索引文件。它本身不是记忆——而是指向所有记忆文件的导航地图。

## 目录结构

记忆文件按类型分放在以下子目录中：

| 目录 | 类型 | 含义 |
|------|------|------|
${typeDescriptions}

## 索引条目格式

每个条目为一行，不超过约 150 字符：
\`- [标题](子目录/文件名.md) — 一句话简介\`

## 记忆文件格式

每个记忆文件必须包含 YAML frontmatter：

\`\`\`
---
name: 记忆名称
description: 一句话简介
type: traits_roles|interaction_rules|key_experiences|promises_goals
---
\`\`\`

## 维护规则

- 索引只做导航，不存内容——不要将记忆正文写入此文件
- 合并相似内容到已有文件，避免创建近乎重复的条目
- 将相对日期转换为绝对日期
- 移除过时或被推翻的记忆指针
- 两个文件存在矛盾时修正错误的那个
`,
      'utf-8',
    );
    logger.info('已创建 auto_dream/INDEX.md 索引文件及分类子目录: %s', indexPath);
  }
}

export function getPersistentMemoryPath(): string {
  return path.join(getMemoryRoot(), 'persistent_memory.md');
}

export function ensureMemoryDirExists(): void {
  const memoryRoot = getMemoryRoot();
  fs.mkdirSync(memoryRoot, { recursive: true });

  const sessionMemoryDir = path.join(memoryRoot, 'session_memory');
  fs.mkdirSync(sessionMemoryDir, { recursive: true });

  // 初始化常驻记忆文件（如不存在）
  const persistentMemoryPath = getPersistentMemoryPath();
  if (!fs.existsSync(persistentMemoryPath)) {
    fs.writeFileSync(persistentMemoryPath, '', 'utf-8');
  }
}
