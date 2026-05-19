import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import { validateCommonPath, PATH_UNSAFE, PATH_OUTSIDE_ROOT } from '../../src/core/validation/path.js';

const MEMORY_ROOT = path.join(os.tmpdir(), 'test-memory-root');

describe('路径校验模块', () => {
  it('应接受合法的相对路径', () => {
    const result = validateCommonPath('notes/test.md', MEMORY_ROOT);
    expect(result.error).toBeNull();
    expect(result.resolvedPath).toBe(path.resolve(MEMORY_ROOT, 'notes/test.md'));
  });

  it('应拒绝空字节注入', () => {
    const result = validateCommonPath('test\x00.md', MEMORY_ROOT);
    expect(result.error).toBe(PATH_UNSAFE);
    expect(result.resolvedPath).toBeNull();
  });

  it('应拒绝路径遍历（..）', () => {
    const result = validateCommonPath('../etc/passwd', MEMORY_ROOT);
    expect(result.error).toBe(PATH_UNSAFE);
    expect(result.resolvedPath).toBeNull();
  });

  it('应拒绝绝对路径', () => {
    const result = validateCommonPath('/etc/passwd', MEMORY_ROOT);
    expect(result.error).toBe(PATH_UNSAFE);
    expect(result.resolvedPath).toBeNull();
  });

  it('应拒绝 Windows 绝对路径', () => {
    const result = validateCommonPath('C:\\Windows\\System32', MEMORY_ROOT);
    expect(result.error).toBe(PATH_UNSAFE);
    expect(result.resolvedPath).toBeNull();
  });

  it('应接受空路径（返回根目录）', () => {
    const result = validateCommonPath('', MEMORY_ROOT);
    expect(result.error).toBeNull();
    expect(result.resolvedPath).toBe(path.resolve(MEMORY_ROOT));
  });

  it('应接受点号路径（返回根目录）', () => {
    const result = validateCommonPath('.', MEMORY_ROOT);
    expect(result.error).toBeNull();
    expect(result.resolvedPath).toBe(path.resolve(MEMORY_ROOT));
  });

  it('应拒绝中间包含 .. 的路径', () => {
    const result = validateCommonPath('foo/../bar', MEMORY_ROOT);
    expect(result.error).toBe(PATH_UNSAFE);
    expect(result.resolvedPath).toBeNull();
  });
});
