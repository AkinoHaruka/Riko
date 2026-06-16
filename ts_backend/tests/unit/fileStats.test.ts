/**
 * FileStats 工具单元测试
 * 测试文件元数据查询、大小格式化及路径不存在等异常场景
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { executeStat } from '../../src/tools/fileStats/fileStats.js';
import { formatFileSize } from '../../src/tools/shared/formatFileSize.js';
import { PATH_NOT_FOUND } from '../../src/tools/types.js';

// Mock resolveVirtualPath，使其返回测试临时目录作为 physicalRoot
const TEST_ROOT = path.join(os.tmpdir(), 'ts-backend-filestats-test');

vi.mock('../../src/core/validation/path.js', async () => {
  const actual = await vi.importActual('../../src/core/validation/path.js');
  return {
    ...actual,
    // 仅替换 resolveVirtualPath，保留真实的 validateCommonPath
    resolveVirtualPath: (_filePath: string) => ({
      physicalRoot: TEST_ROOT,
      relativePath: _filePath,
    }),
  };
});

describe('FileStats 工具', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  // 测试文件元数据查询
  describe('查询文件元数据', () => {
    it('应返回文件的完整元数据信息', () => {
      const content = 'hello world';
      const filePath = 'testfile.txt';
      const absPath = path.join(TEST_ROOT, filePath);
      fs.writeFileSync(absPath, content, 'utf-8');

      const result = executeStat({ file_path: filePath });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.file_path).toBe(filePath);
      expect(result.size_bytes).toBe(Buffer.byteLength(content, 'utf-8'));
      expect(result.size_human).toBe(formatFileSize(result.size_bytes));
      expect(result.mtime).toBeTruthy();
      expect(result.file_type).toBe('file');
      expect(result.within_size_limit).toBe(true);
      expect(result.max_size_bytes).toBe(10 * 1024 * 1024);
    });
  });

  describe('查询目录元数据', () => {
    it('应返回目录类型及 within_size_limit=true', () => {
      const dirPath = 'testdir';
      fs.mkdirSync(path.join(TEST_ROOT, dirPath), { recursive: true });

      const result = executeStat({ file_path: dirPath });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.file_type).toBe('directory');
      expect(result.within_size_limit).toBe(true);
    });
  });

  // 测试文件大小的人类可读格式化
  describe('大小格式化 formatFileSize', () => {
    it('应正确格式化字节', () => {
      expect(formatFileSize(500)).toBe('500B');
    });

    it('应正确格式化千字节', () => {
      expect(formatFileSize(1536)).toBe('1.5KB');
    });

    it('应正确格式化兆字节', () => {
      expect(formatFileSize(1048576)).toBe('1.0MB');
    });

    it('应正确格式化吉字节', () => {
      expect(formatFileSize(1073741824)).toBe('1.0GB');
    });

    it('0 字节应格式化为 0B', () => {
      expect(formatFileSize(0)).toBe('0B');
    });
  });

  describe('路径不存在', () => {
    it('应返回 PATH_NOT_FOUND 错误', () => {
      const result = executeStat({ file_path: 'nonexistent.txt' });

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error_code).toBe(PATH_NOT_FOUND);
    });
  });
});
