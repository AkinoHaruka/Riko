/**
 * 凭证脱敏模块。
 *
 * 在日志、错误响应和监控记录中脱敏凭证，防止泄露 API Key、OAuth Token 等。
 *
 * 识别前缀：
 * - `sk-`：OpenAI API Key
 * - `ghp_`：GitHub Personal Access Token (classic)
 * - `github_pat_`：GitHub Personal Access Token (fine-grained)
 * - `xox`：Slack Token（xoxb/xoxp/xoxa/xoxr/xoxt 等）
 * - `AIza`：Google API Key
 *
 * 安全设计：
 * - `_REDACT_ENABLED` 标志在模块导入时冻结，运行时不可篡改
 * - 匹配后替换为 `<REDACTED:prefix>`，不泄露完整凭证
 *
 * @module core/security/redact
 */

/**
 * 脱敏开关，模块导入时冻结。
 *
 * 通过环境变量 `DISABLE_REDACT=true` 可禁用脱敏（仅用于测试环境）。
 * 生产环境默认启用，且运行时不可篡改（Object.freeze）。
 */
export const _REDACT_ENABLED: Readonly<boolean> = Object.freeze(
  process.env.DISABLE_REDACT !== 'true',
) as Readonly<boolean>;

/** 凭证模式定义 */
interface SecretPattern {
  /** 凭证前缀（用于脱敏后的标识） */
  prefix: string;
  /** 匹配正则表达式 */
  regex: RegExp;
}

/**
 * 凭证匹配模式列表。
 *
 * 正则设计原则：
 * - 最小长度限制，避免误匹配短字符串
 * - 字符集限制，匹配真实凭证的字符范围
 * - 全局匹配（g 标志），替换所有出现
 */
const SECRET_PATTERNS: SecretPattern[] = [
  // OpenAI API Key：sk- + 至少 20 个字母数字
  { prefix: 'sk-', regex: /sk-[a-zA-Z0-9]{20,}/g },
  // GitHub Personal Access Token (classic)：ghp_ + 36 个字母数字
  { prefix: 'ghp_', regex: /ghp_[a-zA-Z0-9]{36}/g },
  // GitHub Personal Access Token (fine-grained)：github_pat_ + 22 字符 + _ + 59 字符
  { prefix: 'github_pat_', regex: /github_pat_[a-zA-Z0-9_]{22}_[a-zA-Z0-9]{59}/g },
  // Slack Token：xox[baprs]- + 字母数字和连字符
  { prefix: 'xox', regex: /xox[baprs]-[a-zA-Z0-9-]+/g },
  // Google API Key：AIza + 35 个字母数字/下划线/连字符
  { prefix: 'AIza', regex: /AIza[a-zA-Z0-9_-]{35}/g },
];

/**
 * 脱敏单个字符串中的凭证。
 *
 * 将匹配的凭证替换为 `<REDACTED:prefix>`，如 `sk-abc123` → `<REDACTED:sk->`。
 * 脱敏禁用时返回原字符串。
 *
 * @param text - 待脱敏的文本
 * @returns 脱敏后的文本
 */
export function redactSecrets(text: string): string {
  if (!_REDACT_ENABLED) return text;
  let result = text;
  for (const { prefix, regex } of SECRET_PATTERNS) {
    result = result.replace(regex, `<REDACTED:${prefix}>`);
  }
  return result;
}

/**
 * 递归脱敏对象中的所有字符串值。
 *
 * 遍历对象的所有嵌套层级，对字符串值调用 `redactSecrets`。
 * 非字符串值（数字、布尔、null、undefined）保持不变。
 * 返回新对象，不修改原对象。
 *
 * @param obj - 待脱敏的对象
 * @returns 脱敏后的新对象
 */
export function redactSecretsRecursive<T>(obj: T): T {
  if (!_REDACT_ENABLED) return obj;

  if (typeof obj === 'string') {
    return redactSecrets(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecretsRecursive(item)) as unknown as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = redactSecretsRecursive(value);
    }
    return result as unknown as T;
  }

  return obj;
}

/**
 * 脱敏 URL 中的凭证。
 *
 * 处理 URL 中的 userinfo 部分（`https://user:pass@host/path`）和查询参数中的 token。
 *
 * @param url - 待脱敏的 URL 字符串
 * @returns 脱敏后的 URL
 */
export function redactUrl(url: string): string {
  if (!_REDACT_ENABLED) return url;

  let result = url;

  // 脱敏 userinfo：https://user:pass@host → https://<REDACTED:userinfo>@host
  result = result.replace(
    /(https?:\/\/)[^:@/\s]+:[^@/\s]+@/g,
    '$1<REDACTED:userinfo>@',
  );

  // 脱敏查询参数中的 token/key/secret/password
  result = result.replace(
    /([?&](?:token|key|secret|password|api_key|apikey|access_token)=)[^&\s]+/gi,
    '$1<REDACTED:param>',
  );

  // 脱敏 URL 中的凭证前缀（如 https://sk-xxx@api.example.com）
  result = redactSecrets(result);

  return result;
}
