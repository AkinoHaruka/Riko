/**
 * 会话记忆管理器：负责笔记文件的创建、读取、迁移、存在性判断和触发状态跟踪。
 * 笔记文件存储在 MEMORY_ROOT_DIR/session_memory/ 下，格式为 {conversationId}_{timestamp}.md。
 *
 * 文件写入采用 tmp+rename 策略：先写入临时文件，再原子重命名，防止写入中断导致文件损坏。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../../config/index.js';
import { getDb } from '../../core/database/index.js';
import { createLogger } from '../../core/logger/index.js';
import { MINIMUM_MESSAGES_TO_INIT } from './types.js';
import type { SessionMemoryTriggerState } from './types.js';
import { shouldTriggerSessionMemoryInit, shouldTriggerSessionMemoryUpdate } from './trigger.js';
import { isFeatureEnabled } from '../../domain/setting/index.js';

const logger = createLogger('SessionMemoryManager');

/**
 * @security 清理会话 ID 中的路径分隔符，防止路径遍历攻击。
 * 拒绝包含 ..、/、\ 的 ID，这些字符可能被利用来访问笔记目录之外的文件。
 */
function sanitizeId(id: string): string {
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid conversation ID: contains path separators`);
  }
  return id;
}

/** 会话笔记模板：定义笔记文件的章节结构，用于创建初始笔记文件 */
export const SESSION_MEMORY_TEMPLATE = `# 会话标题
_用5到10个字高度概括本次会话。信息密度极高，不含任何冗余。_

# 当前状态与未竟之事
_现在正聊到什么？哪些话题悬而未决？用户答应补充什么信息？这是下次对话最自然的接续点。_

# 核心诉求与意图
_用户最初为何发起对话？根本意图是求助、倾诉、寻求认同，还是随意闲聊？整体情绪温度如何：轻松、低落、焦躁还是戏谑？_

# 关键信息与实体
_对话中提到了哪些具体的人名、时间、地点、数字、承诺和链接？各人物之间是什么关系？各自有什么关键特征需要记住？_

# 前因后果与背景
_要理解当前话题，必须知道哪些"前传"？过去发生了什么导致了这次对话？将零散信息拼合成完整的故事线。_

# 用户画像与沟通偏好
_对话中呈现出的用户特质：性格倾向、价值偏好、幽默风格、思维方式。用户偏好何种交互节奏：长篇幅还是短平快？喜欢被连续追问还是自主陈述？对排版有特殊偏好吗？AI 应据此调整相处方式。_

# 边界与雷区
_哪些话题或表达方式绝对不能碰？用户明确反感什么，例如讨厌说教、反感过度乐观、不喜欢被反问？哪些沟通方式已被证明无效，不应再次尝试？_

# 误解与修正
_对话中出现过哪些理解偏差？如何澄清和修正？哪些方向已被用户否定，不应再次提起？_

# 重要共识与决定
_对话中达成了哪些关键一致意见？用户最终采纳了什么建议？做出了什么决定？只记录最终落定的结论，舍弃过程里的摇摆。_

# 情绪锚点与转折
_摒弃流水账。只记录情绪的高峰与低谷，以及认知或态度的关键转折。例如："提到某话题时明显激动"、"最后释然了"、"中途突然改变主意"。这是理解关系走向的核心线索。_`;

export class SessionMemoryManager {
  private memoryRoot: string;

  constructor(memoryRoot?: string) {
    this.memoryRoot = memoryRoot ?? env.MEMORY_ROOT_DIR;
  }

  private _sessionMemoryDir(): string {
    return path.join(this.memoryRoot, 'session_memory');
  }

  /** 查找指定会话的已有记忆文件（匹配 conv{id}_*.md） */
  findExistingFile(conversationId: string): string | null {
    const safeId = sanitizeId(conversationId);
    const dir = this._sessionMemoryDir();
    if (!fs.existsSync(dir)) return null;

    const prefix = `${safeId}_`;
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      if (name.startsWith(prefix) && name.endsWith('.md')) {
        return path.join(dir, name);
      }
    }

    // 向后兼容：旧格式为 {conversationId}/summary.md
    const oldPath = path.join(dir, safeId, 'summary.md');
    if (fs.existsSync(oldPath)) {
      return oldPath;
    }

    return null;
  }

  /** 获取或生成会话笔记文件路径。已有文件则返回现有路径，否则生成基于时间戳的新路径 */
  getSessionMemoryPath(conversationId: string): string {
    const safeId = sanitizeId(conversationId);
    const existing = this.findExistingFile(safeId);
    if (existing) return existing;

    // 无现有文件，生成基于时间戳的新文件名
    const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const name = `${safeId}_${ts}.md`;
    return path.join(this._sessionMemoryDir(), name);
  }

  /** 读取会话笔记内容，文件不存在时返回空字符串 */
  readSessionMemory(conversationId: string): string {
    const filePath = this.findExistingFile(conversationId);
    if (!filePath) return '';
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * 创建初始会话笔记文件。如果存在旧格式文件（目录/summary.md），自动迁移到新格式。
   * 返回笔记内容（已有文件返回现有内容，新文件返回模板内容）。
   */
  createInitialSessionMemory(conversationId: string): string {
    const existing = this.findExistingFile(conversationId);

    // 如果存在旧格式文件，先迁移到新格式（从目录格式改为单文件格式）
    if (existing) {
      const oldFormat = existing.endsWith('/summary.md');
      if (oldFormat) {
        const content = fs.readFileSync(existing, 'utf-8');
        const newPath = this.getSessionMemoryPath(conversationId);
        const newDir = path.dirname(newPath);
        fs.mkdirSync(newDir, { recursive: true });

        const tmpPath = newPath + `.tmp.${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.writeFileSync(tmpPath, content, 'utf-8');
          fs.renameSync(tmpPath, newPath);
        } finally {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        }

        // remove old directory
        const oldDir = path.dirname(existing);
        if (oldDir !== newDir) {
          fs.rmSync(path.dirname(existing), { recursive: true, force: true });
        }

        return content;
      }
      return fs.readFileSync(existing, 'utf-8');
    }

    const newPath = this.getSessionMemoryPath(conversationId);
    const templateContent = SESSION_MEMORY_TEMPLATE;
    const dir = path.dirname(newPath);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = newPath + `.tmp.${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(tmpPath, templateContent, 'utf-8');
      fs.renameSync(tmpPath, newPath);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }

    return templateContent;
  }

  /**
   * 判断是否应启用会话记忆。检查顺序：
   * 1. 笔记文件是否已存在 → 直接启用
   * 2. 功能开关是否禁用 → 禁用
   * 3. 数据库中是否已标记初始化 → 启用
   * 4. 消息数是否达到触发阈值 → 按结果决定
   */
  shouldEnable(conversationId: string, messageCount: number, userId?: string): boolean {
    const filePath = this.getSessionMemoryPath(conversationId);
    if (fs.existsSync(filePath)) {
      logger.info('会话记忆已存在文件 conversation=%s', conversationId);
      return true;
    }

    if (userId !== undefined && !isFeatureEnabled(userId, 'feature_session_memory')) {
      logger.info('会话记忆功能开关已禁用 conversation=%s userId=%s', conversationId, userId);
      return false;
    }

    const db = getDb();
    const row = db
      .prepare('SELECT is_initialized FROM session_notes_state WHERE conversation_id = ?')
      .get(conversationId) as { is_initialized: number } | undefined;

    if (row && row.is_initialized) {
      logger.info('会话记忆已初始化 conversation=%s', conversationId);
      return true;
    }

    if (userId !== undefined) {
      const result = shouldTriggerSessionMemoryInit(messageCount, userId);
      if (!result) {
        logger.info(
          '会话记忆未达触发条件 conversation=%s messageCount=%d',
          conversationId,
          messageCount,
        );
      }
      return result;
    }

    const fallbackMet = messageCount >= MINIMUM_MESSAGES_TO_INIT;
    if (!fallbackMet) {
      logger.info(
        '会话记忆未达兜底阈值 conversation=%s messageCount=%d min=%d',
        conversationId,
        messageCount,
        MINIMUM_MESSAGES_TO_INIT,
      );
    }
    return fallbackMet;
  }

  /**
   * 判断是否应触发笔记更新。基于 Token 增量和工具调用间隔双重条件。
   * @param currentTokenCount 当前对话的 Token 总数
   * @param toolCallCountSinceLastUpdate 自上次更新以来的工具调用总数
   * @param lastTurnHadToolCalls 上一轮是否有工具调用（有则要求更多间隔才触发）
   */
  shouldTriggerUpdate(
    conversationId: string,
    currentTokenCount: number,
    toolCallCountSinceLastUpdate: number,
    lastTurnHadToolCalls: boolean,
    userId: string,
  ): boolean {
    const triggerState = this.getTriggerState(conversationId);
    const tokenGrowth = currentTokenCount - triggerState.lastUpdateTokenCount;

    return shouldTriggerSessionMemoryUpdate(
      tokenGrowth,
      toolCallCountSinceLastUpdate - triggerState.lastUpdateToolCallCount,
      lastTurnHadToolCalls,
      userId,
    );
  }

  /** 从数据库读取触发状态快照，无记录时返回零值默认 */
  getTriggerState(conversationId: string): SessionMemoryTriggerState {
    const db = getDb();
    const row = db
      .prepare(
        'SELECT notes_token_count, tool_call_count, last_updated_at FROM session_notes_state WHERE conversation_id = ?',
      )
      .get(conversationId) as
      | { notes_token_count: number; tool_call_count: number; last_updated_at: string }
      | undefined;

    if (!row) {
      return {
        lastUpdateTokenCount: 0,
        lastUpdateToolCallCount: 0,
        lastUpdateAt: '',
      };
    }

    return {
      lastUpdateTokenCount: row.notes_token_count ?? 0,
      lastUpdateToolCallCount: row.tool_call_count ?? 0,
      lastUpdateAt: row.last_updated_at ?? '',
    };
  }

  /**
   * 获取或创建会话笔记。先判断是否应启用，启用则创建/读取笔记文件。
   * @returns [笔记内容, 是否启用]
   */
  getOrCreateSessionMemory(
    conversationId: string,
    messageCount: number,
    userId?: string,
  ): [string, boolean] {
    const enabled = this.shouldEnable(conversationId, messageCount, userId);
    if (!enabled) {
      return ['', false];
    }

    const content = this.createInitialSessionMemory(conversationId);
    return [content, true];
  }

  /**
   * 更新会话笔记状态到数据库。使用 UPSERT 保证幂等性。
   * @param tokenCount 当前笔记的 Token 数
   * @param toolCallCount 当前工具调用计数，未提供时保持原值
   */
  updateState(conversationId: string, tokenCount: number, toolCallCount?: number): void {
    const db = getDb();
    const currentState = this.getTriggerState(conversationId);
    const effectiveToolCallCount = toolCallCount ?? currentState.lastUpdateToolCallCount;

    db.prepare(
      `
      INSERT INTO session_notes_state (conversation_id, is_initialized, notes_token_count, tool_call_count, last_updated_at)
      VALUES (?, 1, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(conversation_id) DO UPDATE SET
        is_initialized = 1,
        notes_token_count = ?,
        tool_call_count = ?,
        last_updated_at = CURRENT_TIMESTAMP
    `,
    ).run(conversationId, tokenCount, effectiveToolCallCount, tokenCount, effectiveToolCallCount);
  }
}
