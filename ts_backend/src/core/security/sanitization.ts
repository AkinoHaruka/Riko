/**
 * Unicode 清洗模块
 *
 * 防御基于不可见 Unicode 字符的隐藏攻击（ASCII Smuggling、隐藏提示注入）。
 * 这些攻击利用不可见字符（零宽空格、方向控制、私有区、Tag 字符等）
 * 在用户不可见的情况下向 AI 模型注入恶意指令。
 *
 * 参考：HackerOne #3086545（Claude Desktop MCP 中的 Unicode Tag 字符注入）
 * 参考：https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/
 *
 * 实现策略：
 * 1. NFKC 标准化处理组合字符序列
 * 2. 移除危险 Unicode 类别（格式控制符、私有区、未分配字符）
 * 3. 显式字符范围作为回退（部分环境不支持 Unicode 属性类正则）
 * 4. 迭代清洗直到稳定，安全上限防止无限循环
 *
 * 移植自 cc-haha/src/utils/sanitization.ts，适配 Riko 项目规范。
 */

/** 安全迭代上限，防止异常输入导致无限循环 */
const MAX_ITERATIONS = 10;

/**
 * 对字符串进行 Unicode 清洗，移除不可见/危险字符。
 *
 * 处理流程：
 * 1. NFKC 标准化（将组合字符转为规范形式）
 * 2. 移除 Unicode 格式控制符（Cf）、私有使用区（Co）、未分配字符（Cn）
 * 3. 显式移除已知危险字符范围（零宽空格、方向控制、BOM、私有区）
 *
 * @param input - 待清洗的字符串
 * @returns 清洗后的字符串
 * @throws 输入导致迭代超过上限时抛出错误（通常意味着恶意构造的深层嵌套 Unicode）
 */
export function sanitizeUnicode(input: string): string {
  let current = input;
  let previous = '';
  let iterations = 0;

  while (current !== previous && iterations < MAX_ITERATIONS) {
    previous = current;

    // NFKC 标准化：处理组合字符序列，如 ﬁ → fi
    current = current.normalize('NFKC');

    // 方法1：Unicode 属性类（主要防线）
    // Cf = 格式控制符（零宽空格、方向标记等）
    // Co = 私有使用区（自定义字符，AI 模型不应处理）
    // Cn = 未分配字符（可能是 Tag 字符等攻击载体）
    current = current.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '');

    // 方法2：显式字符范围（回退防线，覆盖属性类正则可能遗漏的环境）
    current = current
      .replace(/[\u200B-\u200F]/g, '') // 零宽空格、LTR/RTL 标记
      .replace(/[\u202A-\u202E]/g, '') // 方向格式化字符
      .replace(/[\u2066-\u2069]/g, '') // 方向隔离符
      .replace(/[\uFEFF]/g, '')        // 字节序标记（BOM）
      .replace(/[\uE000-\uF8FF]/g, ''); // 基本多文种平面私有使用区

    iterations++;
  }

  if (iterations >= MAX_ITERATIONS) {
    throw new Error(
      `Unicode 清洗达到最大迭代次数 (${MAX_ITERATIONS})，输入可能被恶意构造: ${input.slice(0, 100)}`,
    );
  }

  return current;
}

/**
 * 递归清洗嵌套数据结构中的所有字符串。
 *
 * 遍历对象、数组和字符串，对所有字符串值应用 sanitizeUnicode。
 * 数字、布尔值、null、undefined 等原始值原样返回。
 *
 * @param value - 待清洗的值（任意类型）
 * @returns 清洗后的值，结构与输入相同
 */
export function sanitizeUnicodeRecursive<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeUnicode(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeUnicodeRecursive) as T;
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[sanitizeUnicode(key)] = sanitizeUnicodeRecursive(val);
    }
    return sanitized as T;
  }

  return value;
}
