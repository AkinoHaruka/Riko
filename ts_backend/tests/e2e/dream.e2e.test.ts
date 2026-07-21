/**
 * Dream（梦境整合）端到端测试
 *
 * 测试 /dream 和 /dream/status 端点，覆盖以下场景：
 * - 无运行中任务时触发 Dream 返回 200（started）
 * - 任务运行中再次触发返回 409（拒绝重复触发）
 * - 查询梦境任务状态返回 200
 * - 单用户模式下未认证请求自动登录
 *
 * 关于 500 状态码：仅在路由 try 块内抛出未捕获异常时返回
 * （如 getCurrentUser/getCurrentDreamTask 等同步调用异常）。
 * 正常测试环境下这些调用不会抛出异常，因此 500 场景需要
 * 模拟内部模块异常才能复现，本 e2e 测试不覆盖该场景。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildE2EApp, teardownE2EApp, registerAndLogin } from './helpers.js';
import * as dreamService from '../../src/domain/autoDream/service.js';
import type { DreamTaskState } from '../../src/domain/autoDream/types.js';

process.env.JWT_SECRET = 'test-secret-key-for-e2e';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.ALLOWED_ORIGINS = '';
process.env.MEMORY_ROOT_DIR = './data/test_memories_e2e';
process.env.LOG_LEVEL = 'ERROR';

describe('Dream E2E', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildE2EApp();
    const auth = await registerAndLogin(app);
    token = auth.token;
    // 初始化 AutoDream 服务，注册 runner 函数
    // buildE2EApp 不调用 initAutoDream，需手动初始化才能触发真实任务
    dreamService.initAutoDream();
  });

  afterAll(async () => {
    await teardownE2EApp(app);
  });

  // ── POST /dream ──

  it('POST /dream — 无运行中任务时返回 200 started', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dream',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('started');
    // 路由返回 task（任务已注册）或 message（任务尚未注册）
    expect(body.task !== undefined || body.message !== undefined).toBe(true);
  });

  it('POST /dream — 任务运行中再次触发返回 409', async () => {
    // 通过 spyOn 模拟 dream 任务运行中的状态。
    // 测试环境下 dream 任务因缺少 API Key 会在 microtask 阶段快速失败，
    // 无法通过并发请求稳定观测到 running 状态，因此使用 spy 注入运行中任务。
    const runningTask: DreamTaskState = {
      id: 'test-running-task',
      type: 'dream',
      phase: 'starting',
      status: 'running',
      sessionsReviewing: 1,
      filesTouched: [],
      turns: [],
      priorMtime: 0,
      startTime: new Date().toISOString(),
      endTime: null,
      notified: false,
    };

    const spy = vi
      .spyOn(dreamService, 'getCurrentDreamTask')
      .mockReturnValue(runningTask);

    const res = await app.inject({
      method: 'POST',
      url: '/dream',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.task).toBeDefined();
    expect(body.task.status).toBe('running');

    spy.mockRestore();
  });

  // ── GET /dream/status ──

  it('GET /dream/status — 返回 200 和任务状态摘要', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dream/status',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeDefined();
    // 有任务时返回 TaskSummary（含 id/status 等字段），无任务时返回 idle
    expect(body.status !== undefined).toBe(true);
  });

  // ── 单用户模式自动登录 ──

  it('POST /dream — 单用户模式未认证请求自动登录返回 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dream',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('started');
  });

  it('GET /dream/status — 单用户模式未认证请求自动登录返回 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dream/status',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeDefined();
  });
});
