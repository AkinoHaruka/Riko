import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { executeWc, countFileStats } from '../../src/tools/wordCount/wordCount.js';
import { NO_PATH_SPECIFIED, FILE_TOO_LARGE } from '../../src/tools/types.js';

const TEST_ROOT = path.join(os.tmpdir(), 'ts-backend-wc-test');

describe('WordCount 工具', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  describe('单文件统计', () => {
    it('应统计单个文件的行数、词数和字节数', () => {
      const content = 'hello world\nfoo bar baz\nthird line';
      const filePath = 'sample.txt';
      fs.writeFileSync(path.join(TEST_ROOT, filePath), content, 'utf-8');

      const result = executeWc({ file_path: filePath }, TEST_ROOT);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.mode).toBe('single');
      expect(result.num_files).toBe(1);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].file_path).toBe(filePath);
      // 内容有 3 行（split(/\r?\n/) 产生 3 个元素）
      expect(result.files[0].lines).toBe(3);
      // 词数：hello, world, foo, bar, baz, third, line = 7
      expect(result.files[0].words).toBe(7);
      expect(result.files[0].bytes_count).toBe(Buffer.byteLength(content, 'utf-8'));
      expect(result.files[0].within_size_limit).toBe(true);
    });
  });

  describe('目录批量统计', () => {
    it('应按 glob 模式统计目录下匹配的文件', () => {
      // 创建目录结构
      fs.mkdirSync(path.join(TEST_ROOT, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(TEST_ROOT, 'docs', 'a.md'), 'line one\nline two', 'utf-8');
      fs.writeFileSync(path.join(TEST_ROOT, 'docs', 'b.md'), 'single line', 'utf-8');
      fs.writeFileSync(path.join(TEST_ROOT, 'docs', 'c.txt'), 'should be excluded', 'utf-8');

      const result = executeWc({ path: 'docs', glob: '*.md' }, TEST_ROOT);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.mode).toBe('batch');
      expect(result.num_files).toBe(2);
      // a.md: 2 行, 4 词; b.md: 1 行, 2 词
      expect(result.total_lines).toBe(3);
      expect(result.total_words).toBe(6);
    });
  });

  describe('超大文件跳过', () => {
    it('超出大小限制的文件应返回 FILE_TOO_LARGE 错误', () => {
      const filePath = 'bigfile.txt';
      const absPath = path.join(TEST_ROOT, filePath);
      // 写入一个小文件作为占位
      fs.writeFileSync(absPath, 'small content', 'utf-8');

      // 保存原始 statSync，避免 mock 内部递归调用
      const originalStatSync = fs.statSync.bind(fs);
      const statSpy = vi.spyOn(fs, 'statSync').mockImplementation((p: fs.PathLike) => {
        const pStr = typeof p === 'string' ? p : String(p);
        if (pStr === absPath) {
          const realStat = originalStatSync(absPath);
          // 模拟文件大小超过 10MB
          return Object.create(realStat, {
            size: { value: 11 * 1024 * 1024 },
          }) as fs.Stats;
        }
        return originalStatSync(p);
      });

      const stats = countFileStats(absPath);
      // 超大文件 lines 和 words 应为 0，但 bytes_count > 0
      expect(stats.lines).toBe(0);
      expect(stats.words).toBe(0);
      expect(stats.bytes_count).toBe(11 * 1024 * 1024);
      expect(stats.within_size_limit).toBe(false);

      // executeWc 对单文件超大应返回 FILE_TOO_LARGE
      const result = executeWc({ file_path: filePath }, TEST_ROOT);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error_code).toBe(FILE_TOO_LARGE);

      statSpy.mockRestore();
    });
  });

  describe('未指定路径', () => {
    it('应返回 NO_PATH_SPECIFIED 错误', () => {
      const result = executeWc({}, TEST_ROOT);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error_code).toBe(NO_PATH_SPECIFIED);
    });
  });
});
