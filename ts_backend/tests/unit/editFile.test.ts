/**
 * EditFile 工具单元测试
 * 测试文件编辑操作：文本替换、新建文件、批量替换、智能换行处理、路径安全校验等
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// 在模块导入前设置环境变量，使 autoDreamConfig.memoryRootDir 指向临时目录
const MEMORY_ROOT = vi.hoisted(() => {
  const { join } = require('path') as typeof import('path');
  const { tmpdir } = require('os') as typeof import('os');
  const root = join(tmpdir(), 'test-edit-file-tools');
  process.env.MEMORY_ROOT_DIR = root;
  return root;
});

import { executeEdit } from '../../src/tools/editFile/editFile.js';
import {
  SAME_STRING,
  MULTIPLE_MATCHES,
  FILE_NOT_FOUND,
  FILE_EXISTS,
  STRING_NOT_FOUND,
  PATH_UNSAFE,
} from '../../src/tools/types.js';

describe('EditFile 工具', () => {
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

  it('替换文本', () => {
    createFile('replace.txt', 'hello world');

    const result = executeEdit({
      file_path: 'replace.txt',
      old_string: 'hello',
      new_string: 'hi',
    });

    expect(result.success).toBe(true);
    expect(readFile('replace.txt')).toBe('hi world');
  });

  // old_string 为空时表示创建新文件
  it('创建新文件', () => {
    const result = executeEdit({
      file_path: 'new-file.txt',
      old_string: '',
      new_string: 'new content',
    });

    expect(result.success).toBe(true);
    expect(readFile('new-file.txt')).toBe('new content');
  });

  it('多处匹配未启用replace_all', () => {
    createFile('multi.txt', 'aaa bbb aaa ccc aaa');

    const result = executeEdit({
      file_path: 'multi.txt',
      old_string: 'aaa',
      new_string: 'xxx',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(MULTIPLE_MATCHES);
    }
  });

  it('多处匹配启用replace_all', () => {
    createFile('replace-all.txt', 'aaa bbb aaa ccc aaa');

    const result = executeEdit({
      file_path: 'replace-all.txt',
      old_string: 'aaa',
      new_string: 'xxx',
      replace_all: true,
    });

    expect(result.success).toBe(true);
    expect(readFile('replace-all.txt')).toBe('xxx bbb xxx ccc xxx');
  });

  // 验证删除内容时智能处理尾部换行，避免留下空行
  it('删除内容智能处理换行', () => {
    // 删除的文本不以 \n 结尾，但文件中该文本后紧跟 \n
    // 应一并删除尾部换行，避免留下空行
    createFile('smart-nl.txt', 'line1\ntarget\nline2\n');

    const result = executeEdit({
      file_path: 'smart-nl.txt',
      old_string: 'target',
      new_string: '',
    });

    expect(result.success).toBe(true);
    expect(readFile('smart-nl.txt')).toBe('line1\nline2\n');
  });

  // Markdown 文件保留行尾空格（用于 Markdown 换行语法）
  it('Markdown文件保留行尾空格', () => {
    createFile('trailing.md', 'line1\nline2\n');

    const result = executeEdit({
      file_path: 'trailing.md',
      old_string: 'line1',
      new_string: 'line1   ',
    });

    expect(result.success).toBe(true);
    // Markdown 文件中行尾空格应被保留（用于换行语法等）
    expect(readFile('trailing.md')).toBe('line1   \nline2\n');
  });

  it('非Markdown文件去除行尾空格', () => {
    createFile('trailing.txt', 'line1\nline2\n');

    const result = executeEdit({
      file_path: 'trailing.txt',
      old_string: 'line1',
      new_string: 'line1   ',
    });

    expect(result.success).toBe(true);
    // 非 Markdown 文件中行尾空格应被去除
    expect(readFile('trailing.txt')).toBe('line1\nline2\n');
  });

  it('路径安全校验 - 拒绝路径遍历', () => {
    const result = executeEdit({
      file_path: '../etc/passwd',
      old_string: 'old',
      new_string: 'new',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(PATH_UNSAFE);
    }
  });

  it('路径安全校验 - 拒绝空字节注入', () => {
    const result = executeEdit({
      file_path: 'test\x00.txt',
      old_string: 'old',
      new_string: 'new',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(PATH_UNSAFE);
    }
  });

  it('路径安全校验 - 拒绝绝对路径', () => {
    const result = executeEdit({
      file_path: '/etc/passwd',
      old_string: 'old',
      new_string: 'new',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(PATH_UNSAFE);
    }
  });

  it('文件不存在且old_string非空', () => {
    const result = executeEdit({
      file_path: 'nonexistent.txt',
      old_string: 'some text',
      new_string: 'new text',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(FILE_NOT_FOUND);
    }
  });

  // 已存在的文件不允许用 old_string='' 的方式覆盖
  it('文件已存在且old_string为空', () => {
    createFile('existing.txt', 'existing content');

    const result = executeEdit({
      file_path: 'existing.txt',
      old_string: '',
      new_string: 'new content',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(FILE_EXISTS);
    }
  });

  it('old_string与new_string相同', () => {
    createFile('same.txt', 'content');

    const result = executeEdit({
      file_path: 'same.txt',
      old_string: 'content',
      new_string: 'content',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(SAME_STRING);
    }
  });

  it('字符串未找到', () => {
    createFile('notfound.txt', 'hello world');

    const result = executeEdit({
      file_path: 'notfound.txt',
      old_string: 'not in file',
      new_string: 'replacement',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe(STRING_NOT_FOUND);
    }
  });

  // 验证原子写入：文件内容正确且无残留临时文件
  it('原子写入 - 文件内容正确且无残留临时文件', () => {
    createFile('atomic.txt', 'original');

    const result = executeEdit({
      file_path: 'atomic.txt',
      old_string: 'original',
      new_string: 'updated',
    });

    expect(result.success).toBe(true);
    expect(readFile('atomic.txt')).toBe('updated');

    // 验证无残留的 .tmp. 临时文件
    const files = fs.readdirSync(root);
    const tmpFiles = files.filter(f => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });
});
