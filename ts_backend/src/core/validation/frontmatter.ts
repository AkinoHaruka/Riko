/**
 * Markdown Frontmatter 解析器（简易版，不依赖 js-yaml）。
 *
 * 设计原因：
 * - 避免引入 js-yaml 这种大依赖，仅解析最简单 key: value 格式。
 * - 对含特殊字符（括号、冒号、星号等）的值自动包裹引号，防止解析错误。
 * - 解析失败时静默降级，不中断流程。
 */
import { MEMORY_TYPES, parseMemoryType } from '../../memoryStorage/types.js';
import type { MemoryType } from '../../memoryStorage/types.js';

export { MEMORY_TYPES, parseMemoryType };
export type { MemoryType };

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
}

const YAML_SPECIAL_CHARS = /[{}[\]*&#!|>%@`]|: /;

function quoteProblematicValues(frontmatterText: string): string {
  const result: string[] = [];
  for (const line of frontmatterText.split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_.\-]*):\s+(.+)$/);
    if (m) {
      const key = m[1];
      const value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        result.push(line);
        continue;
      }
      if (YAML_SPECIAL_CHARS.test(value)) {
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        result.push(`${key}: "${escaped}"`);
        continue;
      }
    }
    result.push(line);
  }
  return result.join('\n');
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    const colonIdx = stripped.indexOf(':');
    if (colonIdx === -1) continue;
    const key = stripped.slice(0, colonIdx).trim();
    let value: string | number | boolean | null = stripped.slice(colonIdx + 1).trim();
    if (!key) continue;
    if (!value) {
      result[key] = null;
      continue;
    }
    if (['null', 'none', '~'].includes(value.toLowerCase())) {
      result[key] = null;
      continue;
    }
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (value.toLowerCase() === 'true') {
      value = true;
    } else if (value.toLowerCase() === 'false') {
      value = false;
    } else {
      const num = Number(value);
      if (!isNaN(num)) value = num;
    }
    result[key] = value;
  }
  return result;
}

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)---\s*\n?/;

export function parseFrontmatter(markdownText: string, _sourcePath = ''): ParsedMarkdown {
  const match = FRONTMATTER_PATTERN.exec(markdownText);
  if (!match) {
    return { frontmatter: {}, content: markdownText };
  }

  const rawYaml = match[1];
  const content = markdownText.slice(match[0].length);

  try {
    const frontmatter = parseSimpleYaml(rawYaml);
    if (Object.keys(frontmatter).length > 0) {
      return { frontmatter, content };
    }
  } catch {
    /* 降级 */
  }

  try {
    const quotedYaml = quoteProblematicValues(rawYaml);
    const frontmatter = parseSimpleYaml(quotedYaml);
    if (Object.keys(frontmatter).length > 0) {
      return { frontmatter, content };
    }
  } catch {
    /* 降级 */
  }

  return { frontmatter: {}, content };
}
