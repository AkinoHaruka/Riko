import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  executeHead,
  formatLinesWithNumbers,
  readFileHead,
} from '../../src/tools/readHead/readHead.js';
import { FILE_NOT_FOUND, IS_DIRECTORY } from '../../src/tools/types.js';

const { tmpDir } = vi.hoisted(() => {
  const _path = require('path') as typeof import('path');
  const _os = require('os') as typeof import('os');
  return {
    tmpDir: _path.join(_os.tmpdir(), `head-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  };
});

vi.mock('../../src/config/auto_dream.js', () => ({
  autoDreamConfig: {
    memoryRootDir: tmpDir,
    systemPromptsDir: tmpDir,
  },
}));

describe('ReadHead 工具', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('读取前N行', () => {
    it('应读取文件的前5行并返回正确内容和行号', () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
      const content = lines.join('\n');
      const filePath = 'headfile.txt';
      fs.writeFileSync(path.join(tmpDir, filePath), content, 'utf-8');

      const result = executeHead({ file_path: filePath, lines: 5 });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.total_lines).toBe(10);
      expect(result.start_line).toBe(1);
      expect(result.end_line).toBe(5);
      expect(result.content).toContain('1→line 1');
      expect(result.content).toContain('5→line 5');
      expect(result.content).not.toContain('6→line 6');
    });
  });

  describe('读取全部行', () => {
    it('lines=0 时应返回全部行', () => {
      const lines = Array.from({ length: 5 }, (_, i) => `row ${i + 1}`);
      const content = lines.join('\n');
      const filePath = 'allfile.txt';
      fs.writeFileSync(path.join(tmpDir, filePath), content, 'utf-8');

      const result = executeHead({ file_path: filePath, lines: 0 });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.total_lines).toBe(5);
      expect(result.start_line).toBe(1);
      expect(result.end_line).toBe(5);
      expect(result.content).toContain('5→row 5');
    });
  });

  describe('行号格式化', () => {
    it('行号应右对齐并用 → 分隔', () => {
      const lines = ['alpha', 'beta', 'gamma'];
      const [formatted] = formatLinesWithNumbers(lines, 1);

      expect(formatted).toBe('1→alpha\n2→beta\n3→gamma');
    });

    it('行号超过 9 时应自动加宽右对齐', () => {
      const lines = ['a', 'b', 'c'];
      const [formatted] = formatLinesWithNumbers(lines, 9);

      const expected = ' 9→a\n10→b\n11→c';
      expect(formatted).toBe(expected);
    });

    it('readFileHead 应正确返回内容、总行数和结束行号', () => {
      const text = 'first\nsecond\nthird';
      const [content, totalLines, endLine] = readFileHead(text, 2);

      expect(totalLines).toBe(3);
      expect(endLine).toBe(2);
      expect(content).toContain('1→first');
      expect(content).toContain('2→second');
    });
  });

  describe('文件不存在', () => {
    it('应返回 FILE_NOT_FOUND 错误', () => {
      const result = executeHead({ file_path: 'missing.txt' });

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error_code).toBe(FILE_NOT_FOUND);
    });
  });

  describe('路径是目录', () => {
    it('应返回 IS_DIRECTORY 错误', () => {
      const dirPath = 'somedir';
      fs.mkdirSync(path.join(tmpDir, dirPath), { recursive: true });

      const result = executeHead({ file_path: dirPath });

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error_code).toBe(IS_DIRECTORY);
    });
  });
});
