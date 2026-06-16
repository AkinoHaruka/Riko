/**
 * 安全模块入口
 *
 * 统一导出 Unicode 清洗、威胁模式扫描、工具调用护栏三大安全能力。
 */

export { sanitizeUnicode, sanitizeUnicodeRecursive } from './sanitization.js';
export { scanForThreats, firstThreatMessage, type ThreatScope, type ThreatScanResult } from './threatPatterns.js';
export {
  ToolCallGuardrailController,
  buildGuardrailSyntheticResult,
  type GuardrailConfig,
  type GuardrailDecision,
} from './toolGuardrails.js';
