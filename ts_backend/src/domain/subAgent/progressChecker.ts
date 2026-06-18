/**
 * 子代理返回格式合同与进度验证。
 *
 * 约束子代理的输出格式，并验证执行进度是否包含必要的章节。
 * 防止子代理返回不符合预期的格式，导致父代理无法解析结果。
 *
 * @module domain/subAgent/progressChecker
 */
import type { SubAgentTrace } from './types.js';

/** 返回格式说明文本，注入到子代理的 system prompt */
export const RETURN_FORMAT_INSTRUCTION = `## 返回格式要求

你的输出必须严格遵循以下格式合同：

### text 格式（默认）
直接输出纯文本结果，不要包含 JSON 或其他结构化标记。

### json 格式
输出必须是合法的 JSON 对象，包含以下字段：
\`\`\`json
{
  "success": true,
  "result": "执行结果摘要",
  "details": { /* 可选的详细信息 */ },
  "error": null
}
\`\`\`

### structured 格式
输出必须包含以下章节（用 Markdown 标题分隔）：

## 已解决事项
- [已完成的事项，含关键决策]

## 待解决事项
- [尚未解决的问题，含阻碍原因]

## 活跃任务
- [正在进行的工作，含当前状态]

## 关键决策
- [影响后续工作的决策及理由]

## 资源
- [文件路径/URL/标识符列表]

## 用户偏好
- [用户表达的偏好或约束]

## 承诺
- [AI 对用户的承诺]

## 开放问题
- [需要用户澄清的问题]

注意：每个章节都必须存在，即使内容为空也要写"无"。`;

/** structured 格式必需的 5 个核心章节 */
const REQUIRED_SECTIONS = [
  '## 已解决事项',
  '## 待解决事项',
  '## 活跃任务',
  '## 关键决策',
  '## 资源',
] as const;

/** structured 格式的所有章节（含可选） */
const ALL_SECTIONS = [
  '## 已解决事项',
  '## 待解决事项',
  '## 活跃任务',
  '## 关键决策',
  '## 资源',
  '## 用户偏好',
  '## 承诺',
  '## 开放问题',
] as const;

/** 进度验证结果 */
export interface ProgressValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 缺失的章节列表 */
  missingSections: string[];
  /** 错误消息（valid=false 时有值） */
  error?: string;
}

/**
 * 解析子代理输出。
 *
 * 根据 returnFormat 解析输出文本，返回结构化结果。
 *
 * @param output - 子代理的原始输出文本
 * @param format - 返回格式合同
 * @returns 解析后的结果对象
 */
export function parseSubAgentOutcome(
  output: string,
  format: 'text' | 'json' | 'structured' = 'text',
): {
  success: boolean;
  result: unknown;
  error?: string;
} {
  const trimmed = output.trim();

  if (format === 'text') {
    return { success: true, result: trimmed };
  }

  if (format === 'json') {
    try {
      const parsed = JSON.parse(trimmed);
      // 验证必需字段
      if (typeof parsed !== 'object' || parsed === null) {
        return { success: false, result: null, error: 'JSON 输出不是对象' };
      }
      if (typeof parsed.success !== 'boolean') {
        return { success: false, result: null, error: 'JSON 输出缺少 success 布尔字段' };
      }
      return {
        success: parsed.success,
        result: parsed.result ?? parsed,
        error: parsed.error,
      };
    } catch (e) {
      return {
        success: false,
        result: null,
        error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  if (format === 'structured') {
    // structured 格式：验证必需章节存在
    const validation = validateSubAgentProgress({ turns: [] } as unknown as SubAgentTrace, output);
    if (!validation.valid) {
      return {
        success: false,
        result: trimmed,
        error: `结构化输出缺少章节: ${validation.missingSections.join(', ')}`,
      };
    }
    return { success: true, result: trimmed };
  }

  return { success: false, result: null, error: `未知的返回格式: ${format}` };
}

/**
 * 验证子代理执行进度。
 *
 * 检查输出是否包含 structured 格式必需的 5 个核心章节。
 * 用于确保子代理的输出符合进度报告的结构要求。
 *
 * @param trace - 子代理执行轨迹（当前未使用，保留用于未来扩展）
 * @param output - 子代理的最终输出文本
 * @returns 验证结果
 */
export function validateSubAgentProgress(
  _trace: SubAgentTrace,
  output: string,
): ProgressValidationResult {
  const missingSections: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    if (!output.includes(section)) {
      missingSections.push(section);
    }
  }

  if (missingSections.length > 0) {
    return {
      valid: false,
      missingSections,
      error: `输出缺少必需章节: ${missingSections.join(', ')}`,
    };
  }

  return {
    valid: true,
    missingSections: [],
  };
}

/**
 * 从 structured 格式输出中提取指定章节的内容。
 *
 * @param output - structured 格式的输出文本
 * @param sectionTitle - 章节标题（如 '## 已解决事项'）
 * @returns 章节内容（不含标题），章节不存在时返回空字符串
 */
export function extractSection(output: string, sectionTitle: string): string {
  // 匹配章节标题到下一个章节标题或文本末尾
  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escapedTitle}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  const match = output.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * 检查 structured 格式输出是否包含所有章节（含可选）。
 *
 * @param output - structured 格式的输出文本
 * @returns 是否包含所有章节
 */
export function hasAllSections(output: string): boolean {
  return ALL_SECTIONS.every((section) => output.includes(section));
}
