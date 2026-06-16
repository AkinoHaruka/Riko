/**
 * WriteFile 工具单元测试
 * 测试文件写入操作：新建文件、更新文件、内容大小校验、路径安全校验及行数计算
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// 在模块导入前设置环境变量，使 autoDreamConfig.memoryRootDir 指向临时目录
const MEMORY_ROOT = vi.hoisted(() => {
  const { join } = require('path') as typeof import('path');
  const { tmpdir } = require('os') as typeof import('os');
  const root = join(tmpdir(), 'test-write-file-tools');
  process.env.MEMORY_ROOT_DIR = root;
  return root;
});

import { executeWrite } from '../../src/tools/writeFile/writeFile.js';
import {
  CONTENT_TOO_LARGE,
  IS_DIRECTORY,
  FILE_TOO_LARGE,
  PATH_UNSAFE,
  MAX_CONTENT_SIZE,
  MAX_FILE_SIZE,
} from '../../src/tools/types.js';

describe('WriteFile 工具', () => {
  // 规范化路径，确保与工具内部 path.resolve() 处理一致
  const root = path.resolve(MEMORY_ROOT);

  beforeEach(() => {
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 在临时目录中创建文件 */
  function createFile(relativePath: string, content: string): void {
    const fullPath = path.join(root, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  /** 读取临时目录中的文件内容 */
  function readFile(relativePath: string): string {
    return fs.readFileSync(path.join(root, relativePath), 'utf-8');
  }

  it('创建新文件', () => {
    const result = executeWrite({
      file_path: 'new-file.txt',
      content: 'hello world',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.type).toBe('create');
      expect(result.file_path).toBe('new-file.txt');
    }
    expect(readFile('new-file.txt')).toBe('hello world');
  });

  // 更新已有文件时返回 diff 信息
  it('更新已有文件', () => {
    createFile('existing.txt', 'old content');

    const result = executeWrite({
      file_path: 'existing.txt',
      content: 'new content',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.type).toBe('update');
      expect(result.diff).toBeTruthy();
      // old_content 已从返回值中移除，不再暴露文件被覆盖前的完整内容
    }
    expect(readFile('existing.txt')).toBe('new content');
  });

  it('内容大小校验', () => {
    // 写入内容超过 MAX_CONTENT_SIZE 限制
    const largeContent = 'x'.repeat(MAX_CONTENT_SIZE + 1);

    const result = executeWrite({
      file_path: 'large-content.txt',
      content: largeContent,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(CONTENT_TOO_LARGE);
    }
  });

  it('目录路径校验', () => {
    // 创建一个目录，尝试向目录路径写入
    fs.mkdirSync(path.join(root, 'a-directory'), { recursive: true });

    const result = executeWrite({
      file_path: 'a-directory',
      content: 'content',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(IS_DIRECTORY);
    }
  });

  // 已有文件超过大小限制时拒绝写入
  it('文件大小校验', () => {
    // 创建一个超过 MAX_FILE_SIZE 的已有文件
    const largeFilePath = path.join(root, 'large-existing.txt');
    const buf = Buffer.alloc(MAX_FILE_SIZE + 1, 'x');
    fs.writeFileSync(largeFilePath, buf);

    const result = executeWrite({
      file_path: 'large-existing.txt',
      content: 'small content',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(FILE_TOO_LARGE);
    }
  });

  it('路径安全校验 - 拒绝路径遍历', () => {
    const result = executeWrite({
      file_path: '../etc/passwd',
      content: 'content',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(PATH_UNSAFE);
    }
  });

  it('路径安全校验 - 拒绝空字节注入', () => {
    const result = executeWrite({
      file_path: 'test\x00.txt',
      content: 'content',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(PATH_UNSAFE);
    }
  });

  it('路径安全校验 - 拒绝绝对路径', () => {
    const result = executeWrite({
      file_path: '/etc/passwd',
      content: 'content',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(PATH_UNSAFE);
    }
  });

  it('lines_written计算 - 普通多行内容', () => {
    const result = executeWrite({
      file_path: 'lines.txt',
      content: 'line1\nline2\nline3',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.lines_written).toBe(3);
    }
  });

  // 末尾换行不计入额外行数
  it('lines_written计算 - 末尾换行不计入额外行', () => {
    const result = executeWrite({
      file_path: 'lines-trailing.txt',
      content: 'line1\nline2\nline3\n',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.lines_written).toBe(3);
    }
  });

  it('lines_written计算 - 空内容', () => {
    const result = executeWrite({
      file_path: 'empty.txt',
      content: '',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.lines_written).toBe(0);
    }
  });
});
