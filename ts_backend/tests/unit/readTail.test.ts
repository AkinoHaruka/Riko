/**
 * ReadTail 工具单元测试
 * 测试文件尾部读取：后 N 行读取、行号格式化及错误处理
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  executeTail,
  readFileTailFast,
} from '../../src/tools/readTail/readTail.js';
import { formatLinesWithNumbers } from '../../src/tools/shared/formatLines.js';
import { FILE_NOT_FOUND } from '../../src/tools/types.js';

const { tmpDir } = vi.hoisted(() => {
  const _path = require('path') as typeof import('path');
  const _os = require('os') as typeof import('os');
  return {
    tmpDir: _path.join(_os.tmpdir(), `tail-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  };
});

import { setupVirtualPathMapping } from '../../src/core/validation/path.js';

describe('ReadTail 工具', () => {
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

  // 测试读取文件后 N 行
  describe('读取后N行', () => {
    it('应读取文件的最后5行并返回正确内容和行号', () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
      const content = lines.join('\n');
      const filePath = 'tailfile.txt';
      fs.writeFileSync(path.join(tmpDir, filePath), content, 'utf-8');

      const result = executeTail({ file_path: filePath, lines: 5 });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.total_lines).toBe(10);
      expect(result.start_line).toBe(6);
      expect(result.end_line).toBe(10);
      expect(result.content).toContain(' 6→line 6');
      expect(result.content).toContain('10→line 10');
      expect(result.content).not.toContain('5→line 5');
    });
  });

  describe('读取全部行', () => {
    it('lines=0 时应返回全部行', () => {
      const lines = Array.from({ length: 5 }, (_, i) => `row ${i + 1}`);
      const content = lines.join('\n');
      const filePath = 'allfile.txt';
      fs.writeFileSync(path.join(tmpDir, filePath), content, 'utf-8');

      const result = executeTail({ file_path: filePath, lines: 0 });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.total_lines).toBe(5);
      expect(result.start_line).toBe(1);
      expect(result.end_line).toBe(5);
      expect(result.content).toContain('1→row 1');
      expect(result.content).toContain('5→row 5');
    });
  });

  // 测试行号格式化，确保从正确的起始行号开始
  describe('行号格式化', () => {
    it('行号应右对齐并用 → 分隔，从正确的起始行号开始', () => {
      const lines = ['x', 'y', 'z'];
      const [formatted, endLine] = formatLinesWithNumbers(lines, 8);

      expect(endLine).toBe(10);
      const expected = ' 8→x\n 9→y\n10→z';
      expect(formatted).toBe(expected);
    });

    it('readFileTailFast 应正确返回尾部内容、总行数和行号', () => {
      const text = 'first\nsecond\nthird\nfourth\nfifth';
      const [content, totalLines, endLine] = readFileTailFast(text, 2);

      expect(totalLines).toBe(5);
      expect(endLine).toBe(5);
      expect(content).toContain('4→fourth');
      expect(content).toContain('5→fifth');
    });

    it('readFileTailFast 起始行号应从正确位置开始', () => {
      const text = 'a\nb\nc\nd\ne';
      const [content, totalLines] = readFileTailFast(text, 3);

      expect(totalLines).toBe(5);
      expect(content).toContain('3→c');
      expect(content).toContain('5→e');
    });
  });

  describe('文件不存在', () => {
    it('应返回 FILE_NOT_FOUND 错误', () => {
      const result = executeTail({ file_path: 'missing.txt' });

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error_code).toBe(FILE_NOT_FOUND);
    });
  });
});
