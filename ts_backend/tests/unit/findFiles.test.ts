/**
 * FindFiles 工具单元测试
 * 测试 glob 模式匹配、递归搜索、分页及路径校验等文件查找功能
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

import { executeFind } from '../../src/tools/findFiles/findFiles.js';
import { PATH_NOT_FOUND, NOT_A_DIRECTORY } from '../../src/tools/types.js';

// findFiles 的 executeFind 接受 memoryRoot 参数，无需模拟配置
const tmpDir = path.join(os.tmpdir(), `find-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

describe('FindFiles 工具', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('glob 模式匹配 - 查找匹配模式的文件', () => {
    fs.writeFileSync(path.join(tmpDir, 'report.md'), '# Report');
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'some notes');
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Readme');

    const result = executeFind({ pattern: '*.md', path: '' }, tmpDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.num_files).toBe(2);
    // 结果是相对于 memoryRoot 的路径
    const names = result.filenames.map(f => path.basename(f));
    expect(names).toContain('report.md');
    expect(names).toContain('readme.md');
    expect(names).not.toContain('notes.txt');
  });

  it('通配符 ** - 递归匹配子目录', () => {
    const subDir = path.join(tmpDir, 'docs', 'guides');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'root.md'), 'root');
    fs.writeFileSync(path.join(subDir, 'guide.md'), 'guide');
    fs.writeFileSync(path.join(subDir, 'tutorial.txt'), 'tutorial');

    const result = executeFind({ pattern: '**/*.md', path: '' }, tmpDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.num_files).toBe(2);
    const names = result.filenames.map(f => path.basename(f));
    expect(names).toContain('root.md');
    expect(names).toContain('guide.md');
    expect(names).not.toContain('tutorial.txt');
  });

  // 验证分页参数 limit 和 offset 的配合使用
  it('分页 - limit 和 offset 配合使用', () => {
    // 创建 10 个文件
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), `content ${i}`);
    }

    const result = executeFind({ pattern: '*.txt', path: '', limit: 3, offset: 2 }, tmpDir);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.filenames.length).toBe(3);
    expect(result.num_files).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.applied_offset).toBe(2);
    expect(result.applied_limit).toBe(3);
  });

  it('路径不存在 - 返回 PATH_NOT_FOUND', () => {
    const result = executeFind({ pattern: '*.txt', path: 'nonexistent_path' }, tmpDir);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error_code).toBe(PATH_NOT_FOUND);
  });

  it('路径不是目录 - 返回 NOT_A_DIRECTORY', () => {
    const filePath = path.join(tmpDir, 'afile.txt');
    fs.writeFileSync(filePath, 'content');

    // 传入文件路径（非目录路径），应返回 NOT_A_DIRECTORY
    const result = executeFind({ pattern: '*.txt', path: 'afile.txt' }, tmpDir);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error_code).toBe(NOT_A_DIRECTORY);
  });
});
