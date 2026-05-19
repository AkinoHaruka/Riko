import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../src/core/database/index.js';
import { generateId } from '../../src/core/utils/id.js';
import {
  saveSetting,
  getSetting,
  getAllSettings,
  getApiKey,
  saveApiKey,
  deleteSetting,
} from '../../src/domain/setting/index.js';

function createTestUser(username = 'testuser'): string {
  const db = getDb();
  const id = generateId('users');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(id, username, 'testhash');
  return id;
}

describe('Setting 领域', () => {
  let userId: string;

  beforeEach(async () => {
    closeDb();
    await initDb();
    userId = createTestUser();
  });

  afterEach(() => {
    closeDb();
  });

  it('saveSetting() 保存普通设置', () => {
    const result = saveSetting(userId, { key: 'theme', value: 'dark' });
    expect(result.message).toBe('设置已保存');
    expect(result.key).toBe('theme');
    expect(result.is_encrypted).toBe(0);
  });

  it('saveSetting() 敏感键加密存储', () => {
    const result = saveSetting(userId, { key: 'apikey_deepseek', value: 'sk-123' });
    expect(result.is_encrypted).toBe(1);

    const db = getDb();
    const row = db
      .prepare('SELECT value, is_encrypted FROM settings WHERE user_id = ? AND key = ?')
      .get(userId, 'apikey_deepseek') as { value: string; is_encrypted: number };
    expect(row.is_encrypted).toBe(1);
    expect(row.value).not.toBe('sk-123');
  });

  it('getSetting() 解密加密值', () => {
    saveSetting(userId, { key: 'apikey_deepseek', value: 'sk-123' });
    const setting = getSetting(userId, 'apikey_deepseek');
    expect(setting.value).toBe('sk-123');
  });

  it('getAllSettings() 返回所有设置并解密', () => {
    saveSetting(userId, { key: 'theme', value: 'dark' });
    saveSetting(userId, { key: 'apikey_deepseek', value: 'sk-123' });

    const { settings } = getAllSettings(userId);
    expect(settings).toHaveLength(2);

    const apiKeySetting = settings.find((s) => s.key === 'apikey_deepseek');
    expect(apiKeySetting!.value).toBe('sk-123');

    const themeSetting = settings.find((s) => s.key === 'theme');
    expect(themeSetting!.value).toBe('dark');
  });

  it('getApiKey() 返回解密后的 API Key', () => {
    saveApiKey(userId, { api_key: 'sk-mykey' });
    const result = getApiKey(userId);
    expect(result.api_key).toBe('sk-mykey');
  });

  it('saveApiKey() 加密存储 API Key', () => {
    saveApiKey(userId, { api_key: 'sk-mykey' });

    const db = getDb();
    const row = db
      .prepare('SELECT value, is_encrypted FROM settings WHERE user_id = ? AND key = ?')
      .get(userId, 'apikey_deepseek') as { value: string; is_encrypted: number };
    expect(row.is_encrypted).toBe(1);
    expect(row.value).not.toBe('sk-mykey');
  });

  it('saveApiKey() 空字符串删除 Key', () => {
    saveApiKey(userId, { api_key: 'sk-mykey' });
    saveApiKey(userId, { api_key: '' });

    const result = getApiKey(userId);
    expect(result.api_key).toBe('');
  });

  it('system_prompt 可通过 settings API 存储', () => {
    const result = saveSetting(userId, { key: 'system_prompt', value: 'some prompt' });
    expect(result.message).toBe('设置已保存');
    expect(result.is_encrypted).toBe(0);

    const setting = getSetting(userId, 'system_prompt');
    expect(setting.value).toBe('some prompt');
  });

  it('deleteSetting() 删除设置', () => {
    saveSetting(userId, { key: 'theme', value: 'dark' });
    const result = deleteSetting(userId, 'theme');
    expect(result.message).toBe('设置已删除');

    const db = getDb();
    const row = db.prepare('SELECT * FROM settings WHERE user_id = ? AND key = ?').get(userId, 'theme');
    expect(row).toBeUndefined();
  });
});
