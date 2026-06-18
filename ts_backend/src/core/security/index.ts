/**
 * 安全模块入口
 *
 * 统一导出 Unicode 清洗、威胁模式扫描、工具调用护栏、凭证脱敏、Doom Loop 检测五大安全能力。
 */

export { sanitizeUnicode, sanitizeUnicodeRecursive } from './sanitization.js';
export { scanForThreats, firstThreatMessage, type ThreatScope, type ThreatScanResult } from './threatPatterns.js';
export {
  ToolCallGuardrailController,
  buildGuardrailSyntheticResult,
  type GuardrailConfig,
  type GuardrailDecision,
} from './toolGuardrails.js';
export {
  redactSecrets,
  redactSecretsRecursive,
  redactUrl,
  _REDACT_ENABLED,
} from './redact.js';
export {
  stableStringify,
  stepSignature,
  DoomLoopDetector,
  StagnationDetector,
  DOOM_LOOP_BREAKER,
  STAGNATION_WARNING,
  type TurnToolCalls,
} from './doomLoopDetector.js';
