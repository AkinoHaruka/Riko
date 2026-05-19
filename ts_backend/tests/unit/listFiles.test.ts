import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { executeLs, scanMemoryFiles, formatMemoryManifest } from '../../src/tools/listFiles/listFiles.js';
import type { MemoryHeader } from '../../src/tools/types.js';

const tempDir = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/';
  const base = process.env.TEMP || process.env.TMP || '/tmp';
  return base + sep + 'listfiles-test-' + process.pid;
});

vi.mock('../../src/config/auto_dream.js', () => {
  const sep = process.platform === 'win32' ? '\\' : '/';
  return {
    autoDreamConfig: {
      memoryRootDir: tempDir,
      systemPromptsDir: tempDir + sep + 'system_prompts',
    },
  };
});

function writeMd(filePath: string, content: string, mtimeMs?: number): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  if (mtimeMs != null) {
    fs.utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
  }
}

describe('listFiles', () => {
  beforeEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('scanMemoryFiles', () => {
    it('scans root directory and returns .md files', () => {
      const now = Date.now();
      writeMd(path.join(tempDir, 'alpha.md'), 'hello', now);
      writeMd(path.join(tempDir, 'beta.md'), 'world', now + 1000);

      const headers = scanMemoryFiles(tempDir);

      expect(headers).toHaveLength(2);
      expect(headers.map((h) => h.filename).sort()).toEqual(['alpha.md', 'beta.md']);
    });

    it('scans subdirectory recursively', () => {
      const now = Date.now();
      writeMd(path.join(tempDir, 'sub', 'deep.md'), 'deep content', now);

      const headers = scanMemoryFiles(tempDir, 'sub');

      expect(headers).toHaveLength(1);
      expect(headers[0].filename).toBe('sub/deep.md');
    });

    it('parses frontmatter with type and description', () => {
      const content = '---\ntype: traits_roles\ndescription: test role\n---\ncontent here';
      writeMd(path.join(tempDir, 'role.md'), content);

      const headers = scanMemoryFiles(tempDir);

      expect(headers).toHaveLength(1);
      expect(headers[0].memory_type).toBe('traits_roles');
      expect(headers[0].description).toBe('test role');
    });

    it('parses frontmatter with only description', () => {
      const content = '---\ndescription: only desc\n---\nbody';
      writeMd(path.join(tempDir, 'desc.md'), content);

      const headers = scanMemoryFiles(tempDir);

      expect(headers).toHaveLength(1);
      expect(headers[0].memory_type).toBeNull();
      expect(headers[0].description).toBe('only desc');
    });

    it('returns null for unknown memory_type values', () => {
      const content = '---\ntype: unknown_type\ndescription: x\n---\nbody';
      writeMd(path.join(tempDir, 'unknown.md'), content);

      const headers = scanMemoryFiles(tempDir);

      expect(headers).toHaveLength(1);
      expect(headers[0].memory_type).toBeNull();
    });

    it('excludes non-.md files', () => {
      const now = Date.now();
      writeMd(path.join(tempDir, 'doc.md'), 'md content', now);
      const txtPath = path.join(tempDir, 'notes.txt');
      fs.mkdirSync(path.dirname(txtPath), { recursive: true });
      fs.writeFileSync(txtPath, 'text content', 'utf-8');

      const headers = scanMemoryFiles(tempDir);

      expect(headers).toHaveLength(1);
      expect(headers[0].filename).toBe('doc.md');
    });

    it('returns empty array for empty directory', () => {
      const headers = scanMemoryFiles(tempDir);

      expect(headers).toEqual([]);
    });

    it('returns empty array for non-existent subPath', () => {
      const headers = scanMemoryFiles(tempDir, 'nonexistent');

      expect(headers).toEqual([]);
    });

    it('respects maxFiles limit', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        writeMd(path.join(tempDir, `file${i}.md`), `content ${i}`, now + i);
      }

      const headers = scanMemoryFiles(tempDir, '', 3);

      expect(headers).toHaveLength(3);
    });

    it('sorts files by mtime descending', () => {
      const base = Date.now();
      writeMd(path.join(tempDir, 'old.md'), 'old', base);
      writeMd(path.join(tempDir, 'new.md'), 'new', base + 10000);
      writeMd(path.join(tempDir, 'mid.md'), 'mid', base + 5000);

      const headers = scanMemoryFiles(tempDir);

      expect(headers.map((h) => h.filename)).toEqual(['new.md', 'mid.md', 'old.md']);
    });

    it('uses relative path from root as filename', () => {
      writeMd(path.join(tempDir, 'sub', 'nested.md'), 'nested');

      const headers = scanMemoryFiles(tempDir);

      expect(headers[0].filename).toBe('sub/nested.md');
    });

    it('handles file with no frontmatter', () => {
      writeMd(path.join(tempDir, 'plain.md'), 'just plain text');

      const headers = scanMemoryFiles(tempDir);

      expect(headers).toHaveLength(1);
      expect(headers[0].description).toBeNull();
      expect(headers[0].memory_type).toBeNull();
    });
  });

  describe('formatMemoryManifest', () => {
    it('formats entry with memory_type', () => {
      const headers: MemoryHeader[] = [
        {
          filename: 'role.md',
          mtime_ms: 1700000000000,
          description: 'a role',
          memory_type: 'traits_roles',
        },
      ];

      const manifest = formatMemoryManifest(headers);

      expect(manifest).toBe('- [traits_roles] role.md (2023-11-14T22:13:20.000Z): a role');
    });

    it('formats entry without memory_type', () => {
      const headers: MemoryHeader[] = [
        {
          filename: 'note.md',
          mtime_ms: 1700000000000,
          description: 'a note',
          memory_type: null,
        },
      ];

      const manifest = formatMemoryManifest(headers);

      expect(manifest).toBe('- note.md (2023-11-14T22:13:20.000Z): a note');
    });

    it('formats entry without description', () => {
      const headers: MemoryHeader[] = [
        {
          filename: 'bare.md',
          mtime_ms: 1700000000000,
          description: null,
          memory_type: null,
        },
      ];

      const manifest = formatMemoryManifest(headers);

      expect(manifest).toBe('- bare.md (2023-11-14T22:13:20.000Z)');
    });

    it('formats multiple entries separated by newlines', () => {
      const headers: MemoryHeader[] = [
        { filename: 'a.md', mtime_ms: 1700000000000, description: 'first', memory_type: 'interaction_rules' },
        { filename: 'b.md', mtime_ms: 1700001000000, description: null, memory_type: null },
      ];

      const manifest = formatMemoryManifest(headers);
      const lines = manifest.split('\n');

      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('- [interaction_rules] a.md (2023-11-14T22:13:20.000Z): first');
      expect(lines[1]).toBe('- b.md (2023-11-14T22:30:00.000Z)');
    });

    it('returns empty string for empty headers', () => {
      const manifest = formatMemoryManifest([]);

      expect(manifest).toBe('');
    });
  });

  describe('executeLs', () => {
    it('returns LsResult for root path', () => {
      writeMd(path.join(tempDir, 'root.md'), '---\ndescription: root file\n---\ncontent');

      const result = executeLs({ path: '' });

      if (!result.success) {
        throw new Error('Expected success');
      }
      expect(result.files).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.manifest).toContain('root.md');
    });

    it('returns LsResult for undefined path', () => {
      writeMd(path.join(tempDir, 'default.md'), 'default');

      const result = executeLs({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.files).toHaveLength(1);
      }
    });

    it('returns LsResult for dot path', () => {
      writeMd(path.join(tempDir, 'dot.md'), 'dot');

      const result = executeLs({ path: '.' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.files).toHaveLength(1);
      }
    });

    it('returns LsResult for valid subPath', () => {
      writeMd(path.join(tempDir, 'sub', 'item.md'), 'sub item');

      const result = executeLs({ path: 'sub' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.files).toHaveLength(1);
        expect(result.files[0].filename).toBe('sub/item.md');
      }
    });

    it('returns LsError for path traversal', () => {
      const result = executeLs({ path: '..' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error_code).toBe('PATH_UNSAFE');
        expect(result.message).toContain('..');
      }
    });

    it('returns LsError for non-existent path', () => {
      const result = executeLs({ path: 'no_such_dir' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error_code).toBe('PATH_NOT_FOUND');
        expect(result.message).toContain('no_such_dir');
      }
    });

    it('returns LsError for absolute path', () => {
      const result = executeLs({ path: '/etc/passwd' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error_code).toBe('PATH_UNSAFE');
      }
    });

    it('returns LsError for path with null byte', () => {
      const result = executeLs({ path: 'dir\x00file' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error_code).toBe('PATH_UNSAFE');
      }
    });

    it('handles system_prompts/ prefix', () => {
      const spDir = path.join(tempDir, 'system_prompts');
      writeMd(path.join(spDir, 'prompt.md'), '---\ndescription: system prompt\n---\ncontent');

      const result = executeLs({ path: 'system_prompts/' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.files).toHaveLength(1);
        expect(result.files[0].filename).toBe('prompt.md');
      }
    });

    it('manifest format matches expected pattern with type', () => {
      const now = 1700000000000;
      writeMd(
        path.join(tempDir, 'typed.md'),
        '---\ntype: key_experiences\ndescription: important\n---\nbody',
        now,
      );

      const result = executeLs({ path: '' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.manifest).toMatch(/^- \[key_experiences\] typed\.md \(.*\): important$/);
      }
    });

    it('manifest format matches expected pattern without type', () => {
      const now = 1700000000000;
      writeMd(path.join(tempDir, 'untyped.md'), '---\ndescription: simple\n---\nbody', now);

      const result = executeLs({ path: '' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.manifest).toMatch(/^- untyped\.md \(.*\): simple$/);
      }
    });
  });
});
