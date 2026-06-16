/**
 * FTS5 查询构建器单元测试
 */
import { describe, it, expect } from 'vitest';
import { buildFtsQuery } from '../../src/domain/memory/ftsQuery.js';

describe('buildFtsQuery', () => {
  it('纯英文分词', () => {
    expect(buildFtsQuery('hello world')).toBe('"hello" OR "world"');
  });

  it('单个英文词', () => {
    expect(buildFtsQuery('hello')).toBe('"hello"');
  });

  it('CJK 字符分词', () => {
    expect(buildFtsQuery('你好世界')).toBe('"你好世界"');
  });

  it('混合语言', () => {
    expect(buildFtsQuery('Riko项目')).toBe('"Riko项目"');
  });

  it('英文和 CJK 混合（空格分隔）', () => {
    expect(buildFtsQuery('hello 你好')).toBe('"hello" OR "你好"');
  });

  it('空字符串返回 null', () => {
    expect(buildFtsQuery('')).toBeNull();
  });

  it('纯空格返回 null', () => {
    expect(buildFtsQuery('   ')).toBeNull();
  });

  it('纯标点/符号返回 null', () => {
    expect(buildFtsQuery('!@#$%')).toBeNull();
  });

  it('双引号清洗（防 FTS5 语法注入）', () => {
    // 双引号不是 token 字符，hello"world 被分为两个 token
    expect(buildFtsQuery('hello"world')).toBe('"hello" OR "world"');
  });

  it('数字 token', () => {
    expect(buildFtsQuery('version 3.14')).toBe('"version" OR "3" OR "14"');
  });

  it('下划线连接词作为单个 token', () => {
    expect(buildFtsQuery('my_var')).toBe('"my_var"');
  });

  it('多个空格分隔的词', () => {
    expect(buildFtsQuery('a   b   c')).toBe('"a" OR "b" OR "c"');
  });

  it('包含标点的混合文本', () => {
    expect(buildFtsQuery('hello, world!')).toBe('"hello" OR "world"');
  });

  it('日文分词', () => {
    expect(buildFtsQuery('こんにちは')).toBe('"こんにちは"');
  });

  it('韩文分词', () => {
    expect(buildFtsQuery('안녕하세요')).toBe('"안녕하세요"');
  });
});
