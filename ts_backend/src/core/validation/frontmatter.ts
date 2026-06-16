/**
 * Markdown Frontmatter 解析器（简易版，不依赖 js-yaml）。
 *
 * 设计原因：
 * - 避免引入 js-yaml 这种大依赖，仅解析最简单 key: value 格式。
 * - 对含特殊字符（括号、冒号、星号等）的值自动包裹引号，防止解析错误。
 * - 解析失败时静默降级，不中断流程。
 *
 * 注意：本模块不再重导出 memoryStorage/types 的内容。
 * 消费方如需 MEMORY_TYPES 或 parseMemoryType，请直接从 memoryStorage/types.js 导入。
 *
 * @module core/validation/frontmatter
 */

/** 解析结果：frontmatter 键值对 + 正文内容 */
export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  content: string;
}

/** YAML 特殊字符正则，匹配到这些字符的值需要用引号包裹 */
const YAML_SPECIAL_CHARS = /[{}[\]*&#!|>%@`]|: /;

/**
 * 对 YAML 值中含特殊字符的行自动包裹双引号。
 * 已被引号包裹的值跳过，避免重复引号。
 */
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

/**
 * 简易 YAML 解析器，仅支持 key: value 格式。
 * 自动识别 null、布尔值、整数和引号包裹的字符串。
 */
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
    } else if (/^\d+$/.test(value)) {
      // 仅对明确的整数格式做数字转换，避免将版本号等（如 "3.0"）误转
      value = Number(value);
    }
    result[key] = value;
  }
  return result;
}

/** Frontmatter 分隔符正则：匹配 --- 包裹的 YAML 头部 */
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)---\s*\n?/;

/**
 * 解析 Markdown 文本中的 Frontmatter。
 * 先尝试直接解析，失败后对特殊字符值包裹引号再试，均失败则返回空 frontmatter。
 *
 * @param markdownText - 包含可选 Frontmatter 的 Markdown 文本
 * @param _sourcePath - 来源文件路径（保留参数，暂未使用）
 * @returns 解析结果，包含 frontmatter 键值对和正文内容
 */
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
