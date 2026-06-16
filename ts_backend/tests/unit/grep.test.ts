/**
 * Grep 工具单元测试
 * 测试文件内容搜索：多种输出模式、glob 过滤、大小写不敏感、分页及错误处理
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

// vi.hoisted 的回调在 import 之前执行，因此需要用 require 访问 Node 内置模块
const { tmpDir } = vi.hoisted(() => {
  const _path = require('path') as typeof import('path');
  const _os = require('os') as typeof import('os');
  return {
    tmpDir: _path.join(_os.tmpdir(), `grep-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  };
});

// 配置虚拟路径映射，使 resolveVirtualPath 使用我们的临时目录
import { setupVirtualPathMapping } from '../../src/core/validation/path.js';

import { executeGrep } from '../../src/tools/grep/grep.js';
import { INVALID_PATTERN, PATH_NOT_FOUND } from '../../src/tools/types.js';

describe('Grep 工具', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    setupVirtualPathMapping({
      memoryRootDir: tmpDir,
      systemPromptsDir: tmpDir,
      promptDir: tmpDir,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('files_with_matches 模式 - 仅返回匹配的文件', async () => {
    fs.writeFileSync(path.join(tmpDir, 'match.txt'), 'hello world\nfoo bar');
    fs.writeFileSync(path.join(tmpDir, 'nomatch.txt'), 'no match here');
    fs.writeFileSync(path.join(tmpDir, 'another.txt'), 'hello again');

    const result = await executeGrep({
      pattern: 'hello',
      path: '',
      output_mode: 'files_with_matches',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.mode).toBe('files_with_matches');
    expect(result.num_files).toBe(2);
    expect(result.filenames).toContain('match.txt');
    expect(result.filenames).toContain('another.txt');
    expect(result.filenames).not.toContain('nomatch.txt');
  });

  it('content 模式 - 输出格式为 path:lineNum:content', async () => {
    fs.writeFileSync(path.join(tmpDir, 'sample.txt'), 'first line\nhello world\nthird line');

    const result = await executeGrep({
      pattern: 'hello',
      path: '',
      output_mode: 'content',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.mode).toBe('content');
    expect(result.num_files).toBe(1);
    expect(result.num_lines).toBe(1);
    // 验证输出格式 "path:lineNum:content"
    expect(result.content).toContain('sample.txt:2:hello world');
  });

  it('count 模式 - 输出格式为 path:count', async () => {
    fs.writeFileSync(path.join(tmpDir, 'count.txt'), 'hello\nworld\nhello again');

    const result = await executeGrep({
      pattern: 'hello',
      path: '',
      output_mode: 'count',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.mode).toBe('count');
    expect(result.num_files).toBe(1);
    expect(result.num_matches).toBe(2);
    // 验证输出格式 "path:count"
    expect(result.content).toContain('count.txt:2');
  });

  it('glob 过滤 - 仅搜索匹配 glob 模式的文件', async () => {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), 'hello markdown');
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'hello text');
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), 'hello readme');

    const result = await executeGrep({
      pattern: 'hello',
      path: '',
      output_mode: 'files_with_matches',
      glob: '*.md',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.num_files).toBe(2);
    expect(result.filenames).toContain('doc.md');
    expect(result.filenames).toContain('readme.md');
    expect(result.filenames).not.toContain('notes.txt');
  });

  it('大小写不敏感搜索', async () => {
    fs.writeFileSync(path.join(tmpDir, 'mixed.txt'), 'Hello World\nHELLO\nhello');

    const result = await executeGrep({
      pattern: 'hello',
      path: '',
      output_mode: 'content',
      case_insensitive: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // 三行都应匹配
    expect(result.num_lines).toBe(3);
  });

  it('分页 - head_limit 和 offset 配合使用', async () => {
    // 创建多个匹配文件
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), `pattern match ${i}`);
    }

    const result = await executeGrep({
      pattern: 'pattern',
      path: '',
      output_mode: 'files_with_matches',
      head_limit: 2,
      offset: 1,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.filenames!.length).toBe(2);
    expect(result.applied_offset).toBe(1);
    expect(result.applied_limit).toBe(2);
  });

  it('无效正则表达式 - 返回 INVALID_PATTERN 错误', async () => {
    const result = await executeGrep({
      pattern: '[invalid(',
      path: '',
      output_mode: 'files_with_matches',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error_code).toBe(INVALID_PATTERN);
  });

  it('路径不存在 - 返回 PATH_NOT_FOUND 错误', async () => {
    const result = await executeGrep({
      pattern: 'test',
      path: 'nonexistent_dir',
      output_mode: 'files_with_matches',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error_code).toBe(PATH_NOT_FOUND);
  });
});
