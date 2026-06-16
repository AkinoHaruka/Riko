/**
 * Frontmatter 解析器单元测试
 * 测试 YAML frontmatter 的解析、类型转换、注释跳过及记忆类型校验
 */
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/core/validation/frontmatter.js';
import { parseMemoryType } from '../../src/memoryStorage/types.js';

describe('Frontmatter 解析器', () => {
  it('应正确解析标准 frontmatter', () => {
    const md = '---\nname: test\ntype: traits_roles\n---\nContent here';
    const result = parseFrontmatter(md);
    expect(result.frontmatter.name).toBe('test');
    expect(result.frontmatter.type).toBe('traits_roles');
    expect(result.content).toBe('Content here');
  });

  it('应处理无 frontmatter 的文本', () => {
    const md = 'Just plain text';
    const result = parseFrontmatter(md);
    expect(result.frontmatter).toEqual({});
    expect(result.content).toBe('Just plain text');
  });

  it('应正确解析布尔值', () => {
    const md = '---\nenabled: true\ndisabled: false\n---\n';
    const result = parseFrontmatter(md);
    expect(result.frontmatter.enabled).toBe(true);
    expect(result.frontmatter.disabled).toBe(false);
  });

  it('应正确解析数字', () => {
    const md = '---\ncount: 42\nratio: 3.14\n---\n';
    const result = parseFrontmatter(md);
    expect(result.frontmatter.count).toBe(42);
    // 浮点数字符串不再自动转为数字，保留为字符串以避免版本号等误转
    expect(result.frontmatter.ratio).toBe('3.14');
  });

  it('应正确解析带引号的值', () => {
    const md = '---\nname: "hello world"\n---\n';
    const result = parseFrontmatter(md);
    expect(result.frontmatter.name).toBe('hello world');
  });

  it('应正确解析 null 值', () => {
    const md = '---\nempty: null\n---\n';
    const result = parseFrontmatter(md);
    expect(result.frontmatter.empty).toBeNull();
  });

  it('应跳过注释行', () => {
    const md = '---\n# comment\nname: test\n---\n';
    const result = parseFrontmatter(md);
    expect(result.frontmatter.name).toBe('test');
    expect(result.frontmatter).not.toHaveProperty('# comment');
  });

  it('应正确校验记忆类型', () => {
    expect(parseMemoryType('traits_roles')).toBe('traits_roles');
    expect(parseMemoryType('interaction_rules')).toBe('interaction_rules');
    expect(parseMemoryType('key_experiences')).toBe('key_experiences');
    expect(parseMemoryType('promises_goals')).toBe('promises_goals');
    expect(parseMemoryType('invalid')).toBeNull();
    expect(parseMemoryType(null)).toBeNull();
    expect(parseMemoryType(undefined)).toBeNull();
  });

  it('应大小写不敏感地校验记忆类型', () => {
    expect(parseMemoryType('TRAITS_ROLES')).toBe('traits_roles');
    expect(parseMemoryType('Interaction_Rules')).toBe('interaction_rules');
  });
});
