/**
 * ReadFile 工具单元测试
 * 测试文件内容读取：行号格式化、范围读取、frontmatter 解析、新鲜度提醒及错误处理
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
    tmpDir: _path.join(_os.tmpdir(), `readfile-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  };
});

// 配置虚拟路径映射，使 resolveVirtualPath 使用我们的临时目录
import { setupVirtualPathMapping } from '../../src/core/validation/path.js';

import { executeCat, readFileInRange, memoryFreshnessNote } from '../../src/tools/readFile/readFile.js';
import { FILE_NOT_FOUND, IS_DIRECTORY } from '../../src/tools/types.js';

describe('ReadFile 工具', () => {
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

  it('读取全部内容 - offset=1, limit=0 返回带行号的全部内容', () => {
    fs.writeFileSync(path.join(tmpDir, 'full.txt'), 'line one\nline two\nline three');

    const result = executeCat({ file_path: 'full.txt', offset: 1, limit: 0 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.total_lines).toBe(3);
    expect(result.start_line).toBe(1);
    expect(result.end_line).toBe(3);
    // 验证行号格式 "num→content"
    expect(result.content).toContain('1→line one');
    expect(result.content).toContain('2→line two');
    expect(result.content).toContain('3→line three');
  });

  it('读取指定行范围 - offset=2, limit=3 仅返回第 2-4 行', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'range.txt'),
      'line 1\nline 2\nline 3\nline 4\nline 5',
    );

    const result = executeCat({ file_path: 'range.txt', offset: 2, limit: 3 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.start_line).toBe(2);
    expect(result.end_line).toBe(4);
    expect(result.content).toContain('2→line 2');
    expect(result.content).toContain('3→line 3');
    expect(result.content).toContain('4→line 4');
    expect(result.content).not.toContain('1→line 1');
    expect(result.content).not.toContain('5→line 5');
  });

  it('frontmatter 解析 - 读取含 YAML frontmatter 的文件', () => {
    const content = '---\ntitle: Test\ntags: demo\n---\nBody content here';
    fs.writeFileSync(path.join(tmpDir, 'frontmatter.md'), content);

    const result = executeCat({ file_path: 'frontmatter.md', offset: 1, limit: 0 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.frontmatter).toBeDefined();
    expect(result.frontmatter.title).toBe('Test');
    expect(result.frontmatter.tags).toBe('demo');
  });

  // 文件较旧时提示用户数据可能过时
  it('新鲜度提醒 - 文件修改时间较旧时包含提示', () => {
    const filePath = path.join(tmpDir, 'old.txt');
    fs.writeFileSync(filePath, 'old content');

    // 将文件修改时间设为 10 天前
    const oldTime = Date.now() - 10 * 86400000;
    fs.utimesSync(filePath, new Date(oldTime), new Date(oldTime));

    const result = executeCat({ file_path: 'old.txt', offset: 1, limit: 0 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.freshness_note).toContain('天未更新');
  });

  it('文件不存在 - 返回 FILE_NOT_FOUND 错误', () => {
    const result = executeCat({ file_path: 'nonexistent.txt' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error_code).toBe(FILE_NOT_FOUND);
  });

  it('路径是目录 - 返回 IS_DIRECTORY 错误', () => {
    const dirPath = path.join(tmpDir, 'subdir');
    fs.mkdirSync(dirPath, { recursive: true });

    const result = executeCat({ file_path: 'subdir' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error_code).toBe(IS_DIRECTORY);
  });
});

// 测试纯函数：行号格式化与范围截取
describe('readFileInRange 纯函数', () => {
  it('应正确格式化行号并截取指定范围', () => {
    const text = 'aaa\nbbb\nccc\nddd\neee';
    const [content, totalLines, endLine] = readFileInRange(text, 2, 3);

    expect(totalLines).toBe(5);
    expect(endLine).toBe(4);
    expect(content).toContain('2→bbb');
    expect(content).toContain('3→ccc');
    expect(content).toContain('4→ddd');
    expect(content).not.toContain('aaa');
    expect(content).not.toContain('eee');
  });

  it('limit=0 时返回从 offset 开始的所有行', () => {
    const text = 'a\nb\nc';
    const [content, totalLines, endLine] = readFileInRange(text, 1, 0);

    expect(totalLines).toBe(3);
    expect(endLine).toBe(3);
    expect(content).toContain('1→a');
    expect(content).toContain('2→b');
    expect(content).toContain('3→c');
  });
});

// 测试纯函数：新鲜度提醒生成
describe('memoryFreshnessNote 纯函数', () => {
  it('当天修改的文件不返回提醒', () => {
    const note = memoryFreshnessNote(Date.now());
    expect(note).toBe('');
  });

  it('超过 1 天未修改的文件返回提醒', () => {
    const threeDaysAgo = Date.now() - 3 * 86400000;
    const note = memoryFreshnessNote(threeDaysAgo);
    expect(note).toContain('3 天未更新');
  });
});
