/**
 * MCP 配置加载单元测试
 *
 * 测试 loadMcpConfig 和 saveMcpConfig 的核心逻辑。
 * 使用 vi.mock('fs') 模拟文件系统。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

describe('loadMcpConfig', () => {
  let fs: typeof import('fs');

  beforeEach(async () => {
    fs = (await import('fs')).default;
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
  });

  it('文件不存在时返回空数组', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { loadMcpConfig } = await import('../../../src/domain/mcp/config.js');
    const result = loadMcpConfig('/nonexistent/mcp_servers.json');

    expect(result).toEqual([]);
  });

  it('正常 JSON 解析', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: {
          filesystem: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
          },
          'remote-api': {
            type: 'http',
            url: 'http://localhost:8080/mcp',
          },
        },
      }),
    );

    const { loadMcpConfig } = await import('../../../src/domain/mcp/config.js');
    const result = loadMcpConfig('/config/mcp_servers.json');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('filesystem');
    expect(result[0].config.type).toBe('stdio');
    expect(result[1].name).toBe('remote-api');
    expect(result[1].config.type).toBe('http');
  });

  it('缺少 mcpServers 字段时返回空数组', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ otherField: 'value' }),
    );

    const { loadMcpConfig } = await import('../../../src/domain/mcp/config.js');
    const result = loadMcpConfig('/config/mcp_servers.json');

    expect(result).toEqual([]);
  });

  it('JSON 解析失败时返回空数组', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('invalid json {{{');

    const { loadMcpConfig } = await import('../../../src/domain/mcp/config.js');
    const result = loadMcpConfig('/config/mcp_servers.json');

    expect(result).toEqual([]);
  });
});

describe('saveMcpConfig', () => {
  let fs: typeof import('fs');

  beforeEach(async () => {
    fs = (await import('fs')).default;
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
  });

  it('正确保存 JSON', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const { saveMcpConfig } = await import('../../../src/domain/mcp/config.js');
    saveMcpConfig('/config/mcp_servers.json', [
      {
        name: 'filesystem',
        config: { type: 'stdio', command: 'npx', args: ['-y', 'server'] },
      },
    ]);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/config/mcp_servers.json',
      expect.any(String),
      'utf-8',
    );

    const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcpServers.filesystem.type).toBe('stdio');
    expect(parsed.mcpServers.filesystem.command).toBe('npx');
  });

  it('目录不存在时自动创建', async () => {
    // existsSync 对目录返回 false
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const { saveMcpConfig } = await import('../../../src/domain/mcp/config.js');
    saveMcpConfig('/new/config/mcp_servers.json', []);

    expect(fs.mkdirSync).toHaveBeenCalledWith('/new/config', { recursive: true });
  });
});
