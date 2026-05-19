import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  estimateTokenCount,
  analyzeSectionSizes,
  substituteVariables,
  generateSectionReminders,
} from '../../../src/domain/sessionMemory/promptBuilder.js';
import { buildAllToolDefinitions } from '../../../src/domain/sessionMemory/toolDefinitions.js';
import { SessionMemoryManager } from '../../../src/domain/sessionMemory/manager.js';
import { MAX_SECTION_LENGTH, MAX_TOTAL_SESSION_MEMORY_TOKENS, MINIMUM_MESSAGES_TO_INIT } from '../../../src/domain/sessionMemory/types.js';
import { initDb, closeDb, getDb } from '../../../src/core/database/index.js';
import { generateId } from '../../../src/core/utils/id.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-memory-test-'));

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('estimateTokenCount', () => {
  it('纯 ASCII 文本按每 4 字符约 1 token 估算', () => {
    const text = 'abcdefghij';
    const tokens = estimateTokenCount(text);
    expect(tokens).toBe(2);
  });

  it('纯 CJK 文本按每 1.5 字符约 1 token 估算', () => {
    const text = '你好世界测试';
    const tokens = estimateTokenCount(text);
    expect(tokens).toBe(4);
  });

  it('混合 CJK 和 ASCII 文本分别计算后求和', () => {
    const text = '你好ab';
    const tokens = estimateTokenCount(text);
    expect(tokens).toBe(1);
  });

  it('空字符串返回 0', () => {
    expect(estimateTokenCount('')).toBe(0);
  });
});

describe('analyzeSectionSizes', () => {
  it('解析 markdown 内容中各章节的 token 大小', () => {
    const content = `# 标题一
这是标题一的内容，包含一些文字。

# 标题二
标题二的内容更多，包含中文和 English 混合。`;

    const sizes = analyzeSectionSizes(content);

    expect(sizes['# 标题一']).toBeTypeOf('number');
    expect(sizes['# 标题二']).toBeTypeOf('number');
    expect(sizes['# 标题二']).toBeGreaterThan(sizes['# 标题一']);
  });

  it('无标题的纯文本不产生章节', () => {
    const content = '这是一段没有标题的纯文本内容。';
    const sizes = analyzeSectionSizes(content);
    expect(Object.keys(sizes)).toHaveLength(0);
  });

  it('空字符串返回空对象', () => {
    const sizes = analyzeSectionSizes('');
    expect(Object.keys(sizes)).toHaveLength(0);
  });
});

describe('substituteVariables', () => {
  it('替换 {{notesPath}} 和 {{currentNotes}} 变量', () => {
    const template = '路径: {{notesPath}}\n内容: {{currentNotes}}';
    const result = substituteVariables(template, {
      notesPath: 'session-memory/42/summary.md',
      currentNotes: '这是笔记内容',
    });

    expect(result).toBe('路径: session-memory/42/summary.md\n内容: 这是笔记内容');
  });

  it('未提供的变量保持原样', () => {
    const template = '路径: {{notesPath}} 未知: {{unknown}}';
    const result = substituteVariables(template, {
      notesPath: 'some/path',
    });

    expect(result).toContain('some/path');
    expect(result).toContain('{{unknown}}');
  });

  it('无变量的模板原样返回', () => {
    const template = '没有变量的模板';
    const result = substituteVariables(template, {});
    expect(result).toBe('没有变量的模板');
  });
});

describe('buildAllToolDefinitions', () => {
  it('返回 6 个工具定义', () => {
    const definitions = buildAllToolDefinitions();
    expect(definitions).toHaveLength(5);
  });

  it('每个工具定义包含 type 和 function 字段', () => {
    const definitions = buildAllToolDefinitions();
    for (const def of definitions) {
      expect(def).toHaveProperty('type');
      expect(def).toHaveProperty('function');
      const fn = def.function as Record<string, unknown>;
      expect(fn).toHaveProperty('name');
      expect(fn).toHaveProperty('description');
    }
  });
});

describe('generateSectionReminders', () => {
  it('无超限时返回空字符串', () => {
    const sectionSizes = { '# 小章节': 100 };
    const totalTokens = 1000;
    const result = generateSectionReminders(sectionSizes, totalTokens);
    expect(result).toBe('');
  });

  it('总 token 超限时生成严重警告', () => {
    const sectionSizes = { '# 章节': 100 };
    const totalTokens = MAX_TOTAL_SESSION_MEMORY_TOKENS + 1;
    const result = generateSectionReminders(sectionSizes, totalTokens);
    expect(result).toContain('严重警告');
    expect(result).toContain(String(totalTokens));
    expect(result).toContain(String(MAX_TOTAL_SESSION_MEMORY_TOKENS));
    expect(result).toContain('当前状态与未竟之事');
    expect(result).toContain('误解与修正');
  });

  it('单章节超限时列出具体超长章节', () => {
    const sectionSizes = { '# 超长章节': MAX_SECTION_LENGTH + 100, '# 正常章节': 500 };
    const totalTokens = 3000;
    const result = generateSectionReminders(sectionSizes, totalTokens);
    expect(result).toContain('超出单章节限制');
    expect(result).toContain('# 超长章节');
    expect(result).toContain(String(MAX_SECTION_LENGTH + 100));
    expect(result).not.toContain('# 正常章节');
  });

  it('总超限且单章节超限时同时包含两种提醒', () => {
    const sectionSizes = { '# 超长章节': MAX_SECTION_LENGTH + 100 };
    const totalTokens = MAX_TOTAL_SESSION_MEMORY_TOKENS + 1;
    const result = generateSectionReminders(sectionSizes, totalTokens);
    expect(result).toContain('严重警告');
    expect(result).toContain('需要精简的超长章节');
    expect(result).toContain('# 超长章节');
  });
});

describe('SessionMemoryManager', () => {
  it('getSessionMemoryPath 返回正确的路径', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const result = manager.getSessionMemoryPath('conv-42');
    expect(result).toContain(path.join('session_memory', 'conv-42_'));
    expect(result).toContain('.md');
  });

  it('createInitialSessionMemory 创建包含模板内容的文件', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const conversationId = 'conv-test-9999';
    const content = manager.createInitialSessionMemory(conversationId);

    expect(content).toContain('# 会话标题');
    expect(content).toContain('# 当前状态与未竟之事');
    expect(content).toContain('# 核心诉求与意图');

    const filePath = manager.getSessionMemoryPath(conversationId);
    expect(fs.existsSync(filePath)).toBe(true);

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe(content);
  });

  it('createInitialSessionMemory 对已存在的文件不覆盖', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const conversationId = 'conv-8888';
    const filePath = manager.getSessionMemoryPath(conversationId);

    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, '已有内容', 'utf-8');

    const content = manager.createInitialSessionMemory(conversationId);
    expect(content).toBe('已有内容');

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe('已有内容');
  });

  it('readSessionMemory 读取已存在的文件内容', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const conversationId = 'conv-7777';
    const filePath = manager.getSessionMemoryPath(conversationId);

    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, '测试读取内容', 'utf-8');

    const content = manager.readSessionMemory(conversationId);
    expect(content).toBe('测试读取内容');
  });

  it('readSessionMemory 对不存在的文件返回空字符串', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const content = manager.readSessionMemory('conv-55555');
    expect(content).toBe('');
  });
});

describe('SessionMemoryManager - shouldEnable 三级判断', () => {
  let convId: string;

  beforeEach(async () => {
    closeDb();
    await initDb();
    const db = getDb();
    const userId = generateId('users');
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, 'smtest', 'hash');
    convId = generateId('conversations');
    db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').run(convId, userId, 'test');
  });

  afterEach(() => {
    closeDb();
  });

  it('第一级：笔记文件已存在时始终启用', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const filePath = manager.getSessionMemoryPath(convId);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, '已有笔记', 'utf-8');

    const enabled = manager.shouldEnable(convId, 0);
    expect(enabled).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('第二级：数据库标记 is_initialized=1 时启用', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const db = getDb();
    db.prepare(
      'INSERT INTO session_notes_state (conversation_id, is_initialized, notes_token_count) VALUES (?, 1, 0)',
    ).run(convId);

    const enabled = manager.shouldEnable(convId, 0);
    expect(enabled).toBe(true);
  });

  it('第三级：消息数达到阈值时启用', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const enabled = manager.shouldEnable(convId, MINIMUM_MESSAGES_TO_INIT);
    expect(enabled).toBe(true);
  });

  it('消息数未达阈值且无文件和数据库标记时不启用', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const enabled = manager.shouldEnable(convId, MINIMUM_MESSAGES_TO_INIT - 1);
    expect(enabled).toBe(false);
  });
});

describe('SessionMemoryManager - updateState', () => {
  let convId: string;

  beforeEach(async () => {
    closeDb();
    await initDb();
    const db = getDb();
    const userId = generateId('users');
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, 'smtest2', 'hash');
    convId = generateId('conversations');
    db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').run(convId, userId, 'test');
  });

  afterEach(() => {
    closeDb();
  });

  it('首次 upsert 插入新记录', () => {
    const manager = new SessionMemoryManager(tmpDir);
    manager.updateState(convId, 150);

    const db = getDb();
    const row = db.prepare('SELECT * FROM session_notes_state WHERE conversation_id = ?').get(convId) as { is_initialized: number; notes_token_count: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.is_initialized).toBe(1);
    expect(row!.notes_token_count).toBe(150);
  });

  it('再次 upsert 更新已有记录', () => {
    const manager = new SessionMemoryManager(tmpDir);
    manager.updateState(convId, 150);
    manager.updateState(convId, 300);

    const db = getDb();
    const rows = db.prepare('SELECT * FROM session_notes_state WHERE conversation_id = ?').all(convId) as Array<{ notes_token_count: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].notes_token_count).toBe(300);
  });
});

describe('SessionMemoryManager - getOrCreateSessionMemory', () => {
  let convId: string;

  beforeEach(async () => {
    closeDb();
    await initDb();
    const db = getDb();
    const userId = generateId('users');
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, 'smtest3', 'hash');
    convId = generateId('conversations');
    db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').run(convId, userId, 'test');
  });

  afterEach(() => {
    closeDb();
  });

  it('未启用时返回空内容和 false', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const [content, isEnabled] = manager.getOrCreateSessionMemory(convId, 0);
    expect(content).toBe('');
    expect(isEnabled).toBe(false);
  });

  it('消息数达到阈值时自动创建并返回模板内容', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const [content, isEnabled] = manager.getOrCreateSessionMemory(convId, MINIMUM_MESSAGES_TO_INIT);
    expect(isEnabled).toBe(true);
    expect(content).toContain('# 会话标题');
    expect(content).toContain('# 当前状态与未竟之事');
  });

  it('已存在的笔记文件直接返回内容', () => {
    const manager = new SessionMemoryManager(tmpDir);
    const filePath = manager.getSessionMemoryPath(convId);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, '已有笔记内容', 'utf-8');

    const [content, isEnabled] = manager.getOrCreateSessionMemory(convId, 0);
    expect(isEnabled).toBe(true);
    expect(content).toBe('已有笔记内容');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
