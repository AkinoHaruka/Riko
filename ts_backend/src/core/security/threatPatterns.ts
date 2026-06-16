/**
 * 威胁模式扫描模块
 *
 * 检测提示注入、数据外泄、C2 僵尸网络等安全威胁。
 * 模式按攻击类别组织，每个模式有三级作用域：
 *
 * - "all"     — 最低误报，适用于所有文本（经典注入、外泄）
 * - "context" — 中等误报，适用于上下文/记忆/工具结果（C2、角色劫持）
 * - "strict"  — 最高误报，仅适用于记忆写入和技能安装（持久化、SSH 后门）
 *
 * 移植自 hermes-agent/tools/threat_patterns.py，适配 Riko 项目规范。
 * 正则模式使用 (?:\w+\s+)* 在关键词之间允许可选填充词，防止攻击者
 * 通过插入无关词绕过检测（如 "ignore all prior instructions" 代替 "ignore all instructions"）。
 */

import { eventManager } from '../events/index.js';

/** 威胁模式定义：(正则, 模式ID, 作用域) */
type ThreatPattern = [RegExp, string, ThreatScope];

/** 扫描作用域 */
export type ThreatScope = 'all' | 'context' | 'strict';

/** 扫描结果 */
export interface ThreatScanResult {
  /** 匹配到的模式 ID 列表 */
  patternIds: string[];
  /** 是否检测到威胁 */
  hasThreats: boolean;
}

// ── 不可见 Unicode 字符集合 ────────────────────────────────────────
// 用于 ASCII Smuggling 和方向控制攻击
const INVISIBLE_CHARS = new Set([
  '\u200B', // 零宽空格
  '\u200C', // 零宽非连接符
  '\u200D', // 零宽连接符
  '\u2060', // 字连接符
  '\u2062', // 不可见乘号
  '\u2063', // 不可见分隔符
  '\u2064', // 不可见加号
  '\uFEFF', // 零宽不换行空格（BOM）
  '\u202A', // 从左到右嵌入
  '\u202B', // 从右到左嵌入
  '\u202C', // 弹出方向格式化
  '\u202D', // 从左到右覆盖
  '\u202E', // 从右到左覆盖
  '\u2066', // 从左到右隔离
  '\u2067', // 从右到左隔离
  '\u2068', // 首强隔离
  '\u2069', // 弹出方向隔离
]);

// ── 威胁模式定义 ──────────────────────────────────────────────────
const PATTERNS: ThreatPattern[] = [
  // 经典提示注入（适用于所有文本，最低误报）
  [/ignore\s+(?:\w+\s+)*(previous|all|above|prior)\s+(?:\w+\s+)*instructions/i, 'prompt_injection', 'all'],
  [/system\s+prompt\s+override/i, 'sys_prompt_override', 'all'],
  [/disregard\s+(?:\w+\s+)*(your|all|any)\s+(?:\w+\s+)*(instructions|rules|guidelines)/i, 'disregard_rules', 'all'],
  [/act\s+as\s+(if|though)\s+(?:\w+\s+)*you\s+(?:\w+\s+)*(have\s+no|don'?t\s+have)\s+(?:\w+\s+)*(restrictions|limits|rules)/i, 'bypass_restrictions', 'all'],
  [/<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/, 'html_comment_injection', 'all'],
  [/<\s*div\s+style\s*=\s*["'][\s\S]*?display\s*:\s*none/, 'hidden_div', 'all'],
  [/do\s+not\s+(?:\w+\s+)*tell\s+(?:\w+\s+)*the\s+user/i, 'deception_hide', 'all'],

  // 角色劫持（上下文作用域，中等误报）
  [/you\s+are\s+(?:\w+\s+)*now\s+(?:a|an|the)\s+/i, 'role_hijack', 'context'],
  [/pretend\s+(?:\w+\s+)*(you\s+are|to\s+be)\s+/i, 'role_pretend', 'context'],
  [/output\s+(?:\w+\s+)*(system|initial)\s+prompt/i, 'leak_system_prompt', 'context'],
  [/(respond|answer|reply)\s+without\s+(?:\w+\s+)*(restrictions|limitations|filters|safety)/i, 'remove_filters', 'context'],
  [/you\s+have\s+been\s+(?:\w+\s+)*(updated|upgraded|patched)\s+to/i, 'fake_update', 'context'],

  // C2 / 僵尸网络风格提示件（上下文作用域）
  [/register\s+(as\s+)?a?\s*node/i, 'c2_node_registration', 'context'],
  [/(heartbeat|beacon|check[\s-]?in)\s+(to|with)\s+/i, 'c2_heartbeat', 'context'],
  [/pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b/i, 'c2_task_pull', 'context'],
  [/connect\s+to\s+the\s+network\b/i, 'c2_network_connect', 'context'],
  [/you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b/i, 'forced_action', 'context'],

  // 数据外泄（所有文本作用域）
  [/curl\s+[^\n]*\$[\{]?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, 'exfil_curl', 'all'],
  [/wget\s+[^\n]*\$[\{]?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, 'exfil_wget', 'all'],
  [/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i, 'read_secrets', 'all'],

  // 持久化 / SSH 后门（严格作用域，仅记忆写入和技能安装）
  [/authorized_keys/, 'ssh_backdoor', 'strict'],
  [/\$HOME\/\.ssh|~\/\.ssh/, 'ssh_access', 'strict'],
  [/(update|modify|edit|write|change|append|add\s+to)\s+.*(?:AGENTS\.md|CLAUDE\.md|\.cursorrules)/i, 'agent_config_mod', 'strict'],

  // 硬编码密钥（严格作用域）
  [/(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}/i, 'hardcoded_secret', 'strict'],
];

// ── 按作用域编译模式集 ─────────────────────────────────────────────
// "all" 模式进入所有集合，"context" 模式进入 context + strict，"strict" 仅进入 strict
const compiledPatterns: Record<ThreatScope, Array<{ pattern: RegExp; id: string }>> = {
  all: [],
  context: [],
  strict: [],
};

for (const [pattern, id, scope] of PATTERNS) {
  const entry = { pattern, id };
  compiledPatterns[scope].push(entry);
  // 向上冒泡：context 包含 all，strict 包含 all + context
  if (scope === 'all') {
    compiledPatterns.context.push(entry);
    compiledPatterns.strict.push(entry);
  } else if (scope === 'context') {
    compiledPatterns.strict.push(entry);
  }
}

/**
 * 扫描内容中的安全威胁。
 *
 * @param content - 待扫描的文本内容
 * @param scope - 扫描作用域：
 *   - "all"：经典注入 + 外泄，最低误报
 *   - "context"：增加 C2/角色劫持检测，适用于上下文和工具结果
 *   - "strict"：增加持久化/SSH/硬编码密钥检测，适用于记忆写入和技能安装
 * @returns 扫描结果，包含匹配的模式 ID 列表
 */
export function scanForThreats(content: string, scope: ThreatScope = 'context'): ThreatScanResult {
  if (!content) {
    return { patternIds: [], hasThreats: false };
  }

  const findings: string[] = [];

  // 检测不可见 Unicode 字符
  for (const ch of content) {
    if (INVISIBLE_CHARS.has(ch)) {
      findings.push(`invisible_unicode_U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }

  // 检测威胁模式
  const patterns = compiledPatterns[scope];
  for (const { pattern, id } of patterns) {
    if (pattern.test(content)) {
      findings.push(id);
    }
  }

  const result = { patternIds: findings, hasThreats: findings.length > 0 };

  if (result.hasThreats) {
    eventManager.emit('security:threat:detected', { patternIds: findings, scope });
  }

  return result;
}

/**
 * 返回第一个威胁的人类可读错误消息，无威胁时返回 null。
 *
 * 适用于需要"发现即阻止"的场景（记忆写入、技能安装）。
 *
 * @param content - 待扫描的文本内容
 * @param scope - 扫描作用域，默认 "strict"
 * @returns 错误消息字符串，或 null
 */
export function firstThreatMessage(content: string, scope: ThreatScope = 'strict'): string | null {
  const { patternIds } = scanForThreats(content, scope);
  if (patternIds.length === 0) return null;

  const pid = patternIds[0];
  if (pid.startsWith('invisible_unicode_')) {
    const codepoint = pid.replace('invisible_unicode_', '');
    return `已阻止：内容包含不可见 Unicode 字符 ${codepoint}（可能是注入攻击）`;
  }
  return `已阻止：内容匹配威胁模式 "${pid}"。注入到系统提示词的内容不得包含注入或外泄载荷。`;
}
