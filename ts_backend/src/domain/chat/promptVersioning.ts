/**
 * 系统提示版本管理（延迟失效机制）。
 *
 * 系统提示词（mainPrompt + toolRules + persistentMemory）可能因用户编辑、
 * 记忆整合、工具规则更新等原因发生变化。频繁变更会导致 Prompt Cache 反复失效，
 * 降低缓存命中率。
 *
 * 本模块实现"延迟失效"策略：
 * - 系统提示变更后，不立即失效旧缓存，而是标记"待失效"（pendingInvalidation）
 * - 下一次请求时检测到版本变更，才真正失效（更新 effectiveVersion）
 * - 这样可以让正在进行的请求继续使用旧缓存，新请求才使用新版本
 *
 * @module domain/chat/promptVersioning
 */
import crypto from 'crypto';

/** 系统提示版本信息 */
export interface PromptVersion {
  /** 版本号，单调递增 */
  version: number;
  /** 系统提示内容的 SHA-256 哈希（64 字符十六进制） */
  hash: string;
  /** 是否有待失效标记（已检测到内容变更但未真正失效） */
  pendingInvalidation: boolean;
  /** 最后更新时间戳（ms） */
  updatedAt: number;
}

/**
 * 计算系统提示内容的稳定哈希。
 *
 * @param content - 系统提示内容
 * @returns 64 字符十六进制 SHA-256 哈希
 */
function computePromptHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * 会话级系统提示版本管理器。
 *
 * 维护每个会话的系统提示版本，实现延迟失效策略。
 * 全局单例 `sessionPromptVersionManager` 在模块导入时创建。
 */
export class SessionPromptVersionManager {
  /** 会话 ID → 版本信息 */
  private readonly versions = new Map<string, PromptVersion>();
  /** 全局版本号计数器，单调递增 */
  private globalVersionCounter = 0;

  /**
   * 获取会话的当前生效版本（不触发延迟失效）。
   *
   * @param conversationId - 会话 ID
   * @returns 当前版本信息，未记录时返回 undefined
   */
  getVersion(conversationId: string): PromptVersion | undefined {
    return this.versions.get(conversationId);
  }

  /**
   * 标记会话的系统提示有待失效。
   *
   * 当检测到系统提示内容变更时调用。不立即更新 version，
   * 而是设置 pendingInvalidation=true，等待下次 getEffectiveVersion 时真正失效。
   *
   * @param conversationId - 会话 ID
   * @param content - 新的系统提示内容
   */
  markPendingInvalidation(conversationId: string, content: string): void {
    const newHash = computePromptHash(content);
    const current = this.versions.get(conversationId);

    if (!current) {
      // 首次记录：直接创建版本，无需延迟
      this.globalVersionCounter += 1;
      this.versions.set(conversationId, {
        version: this.globalVersionCounter,
        hash: newHash,
        pendingInvalidation: false,
        updatedAt: Date.now(),
      });
      return;
    }

    // 内容未变化：无需任何操作
    if (current.hash === newHash) {
      return;
    }

    // 内容变化但已标记待失效：仅更新 hash，不重复标记
    if (current.pendingInvalidation) {
      current.hash = newHash;
      current.updatedAt = Date.now();
      return;
    }

    // 内容变化且未标记：设置待失效
    current.hash = newHash;
    current.pendingInvalidation = true;
    current.updatedAt = Date.now();
  }

  /**
   * 获取会话的生效版本（触发延迟失效）。
   *
   * 如果当前版本有待失效标记，则真正失效：
   * - 递增全局版本号
   * - 清除 pendingInvalidation 标记
   * - 返回新版本
   *
   * 用于新请求开始时，确保新请求使用最新版本。
   *
   * @param conversationId - 会话 ID
   * @returns 生效版本信息，未记录时返回 undefined
   */
  getEffectiveVersion(conversationId: string): PromptVersion | undefined {
    const current = this.versions.get(conversationId);
    if (!current) return undefined;

    if (current.pendingInvalidation) {
      // 真正失效：递增版本号，清除标记
      this.globalVersionCounter += 1;
      current.version = this.globalVersionCounter;
      current.pendingInvalidation = false;
      current.updatedAt = Date.now();
    }

    return current;
  }

  /**
   * 清除指定会话的版本记录（会话结束时调用）。
   *
   * @param conversationId - 会话 ID
   */
  clear(conversationId: string): void {
    this.versions.delete(conversationId);
  }

  /** 清除所有会话的版本记录（测试用） */
  clearAll(): void {
    this.versions.clear();
    this.globalVersionCounter = 0;
  }
}

/** 全局单例 */
export const sessionPromptVersionManager = new SessionPromptVersionManager();
