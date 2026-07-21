/**
 * AI 工具代理路由模块
 *
 * 职责：将 AI 工具调用（文件编辑、搜索、读取等）转发到 Fastify HTTP 端点。
 * 这些端点供 AI 子代理在执行工具调用时使用，而非直接面向前端用户。
 * 认证由全局 authMiddleware (onRequest 钩子) 统一处理。
 *
 * 端点概览：
 *   POST /edit             — 编辑文件（搜索替换）
 *   GET  /edit             — 读取文件内容
 *   GET  /edit/list        — 列出目录内容
 *   DELETE /edit           — 删除文件
 *   POST /write            — 写入文件
 *   GET  /write            — 读取文件内容（同 /edit）
 *   GET  /write/list       — 列出目录内容（同 /edit/list）
 *   DELETE /write          — 删除文件（同 /edit）
 *   POST /grep             — 文本搜索（限流 30/min）
 *   POST /find             — 文件查找（限流 30/min）
 *   POST /ls               — 列出目录（限流 30/min）
 *   POST /cat              — 读取文件内容
 *   POST /stat             — 获取文件元信息
 *   POST /wc               — 统计文件字数/行数
 *   POST /head             — 读取文件头部
 *   POST /tail             — 读取文件尾部
 *   POST /memory-search    — 搜索记忆文件（限流 20/min）
 */
import type { FastifyInstance } from 'fastify';
import { executeEdit, readFile, listDirectory, deleteFile } from '../../tools/editFile/index.js';
import { executeWrite } from '../../tools/writeFile/index.js';
import { executeGrep } from '../../tools/grep/index.js';
import { executeFind } from '../../tools/findFiles/index.js';
import { executeLs } from '../../tools/listFiles/index.js';
import { executeCat } from '../../tools/readFile/index.js';
import { executeStat } from '../../tools/fileStats/index.js';
import { executeWc } from '../../tools/wordCount/index.js';
import { executeHead } from '../../tools/readHead/index.js';
import { executeTail } from '../../tools/readTail/index.js';
import { executeSearchMemory } from '../../tools/memorySearch/index.js';
import { autoDreamConfig } from '../../config/auto_dream.js';
import type {
  EditRequest,
  WriteRequest,
  GrepRequest,
  FindRequest,
  LsRequest,
  CatRequest,
  StatRequest,
  WcRequest,
  HeadRequest,
  TailRequest,
} from '../../tools/types.js';
import {
  editFileSchema,
  writeFileSchema,
  grepSchema,
  findFilesSchema,
  listFilesSchema,
  readFileSchema,
  fileStatSchema,
  wcSchema,
  headTailSchema,
  memorySearchSchema,
  errorResponse,
} from '../../core/validation/schemas.js';
import { getCurrentUser } from '../../core/middleware/index.js';

// GET /edit 和 GET /write 共享的读取文件处理函数
async function handleGetFile(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
) {
  // 调用 getCurrentUser 完成认证校验（未认证会抛出 401）
  // TODO: 文件工具目前基于全局 memoryRoot，未来需按 userId 解析用户专属 memoryRoot
  getCurrentUser(request);
  const query = request.query as { file_path?: string };
  if (!query.file_path) {
    return reply.status(400).send({ success: false, message: 'file_path 参数不能为空' });
  }
  const result = readFile(query.file_path);
  if (result.success) {
    return result;
  }
  if (result.message?.includes('不存在')) {
    return reply.status(404).send(result);
  }
  return reply.status(400).send(result);
}

// GET /edit/list 和 GET /write/list 共享的目录列表处理函数
async function handleListDirectory(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
) {
  // 调用 getCurrentUser 完成认证校验（未认证会抛出 401）
  // TODO: 文件工具目前基于全局 memoryRoot，未来需按 userId 解析用户专属 memoryRoot
  getCurrentUser(request);
  const query = request.query as { path?: string };
  const result = listDirectory(query.path ?? '');
  if (result.success) {
    return result;
  }
  if (result.message?.includes('不存在')) {
    return reply.status(404).send(result);
  }
  return reply.status(400).send(result);
}

// DELETE /edit 和 DELETE /write 共享的删除文件处理函数
async function handleDeleteFile(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
) {
  // 调用 getCurrentUser 完成认证校验（未认证会抛出 401）
  // TODO: 文件工具目前基于全局 memoryRoot，未来需按 userId 解析用户专属 memoryRoot
  getCurrentUser(request);
  const query = request.query as { file_path?: string };
  if (!query.file_path) {
    return reply.status(400).send({ success: false, message: 'file_path 参数不能为空' });
  }
  const result = deleteFile(query.file_path);
  if (result.success) {
    return result;
  }
  if (result.message?.includes('不存在')) {
    return reply.status(404).send(result);
  }
  return reply.status(400).send(result);
}

export async function registerToolRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /edit
   * 编辑文件：通过搜索替换模式修改文件内容。
   *
   * 请求体：EditRequest（Zod schema 校验）— 包含 file_path, old_string, new_string
   * 响应：{ success: boolean, message?: string }
   */
  app.post('/edit', async (request, reply) => {
    const parsed = editFileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as EditRequest;
    const result = executeEdit(body);
    if (result.success) return result;
    return reply.status(400).send(result);
  });

  /** GET /edit — 读取文件内容（查询参数 file_path） */
  app.get('/edit', handleGetFile);

  /** GET /edit/list — 列出目录内容（查询参数 path） */
  app.get('/edit/list', handleListDirectory);

  /** DELETE /edit — 删除文件（查询参数 file_path） */
  app.delete('/edit', handleDeleteFile);

  /**
   * POST /write
   * 写入文件：创建或覆盖文件内容。
   *
   * 请求体：WriteRequest（Zod schema 校验）— 包含 file_path, content
   * 响应：{ success: boolean, message?: string }
   */
  app.post('/write', async (request, reply) => {
    const parsed = writeFileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as WriteRequest;
    const result = executeWrite(body);
    if (result.success) return result;
    return reply.status(400).send(result);
  });

  /** GET /write — 读取文件内容（同 /edit） */
  app.get('/write', handleGetFile);

  /** GET /write/list — 列出目录内容（同 /edit/list） */
  app.get('/write/list', handleListDirectory);

  /** DELETE /write — 删除文件（同 /edit） */
  app.delete('/write', handleDeleteFile);

  /**
   * POST /grep
   * 文本搜索：在文件中搜索匹配指定模式的行。
   *
   * 限流：每分钟最多 30 次
   *
   * 请求体：GrepRequest（Zod schema 校验）
   * 响应：{ success: boolean, matches?: MatchResult[] }
   */
  app.post(
    '/grep',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = grepSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(
            errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'),
          );
      }
      const body = parsed.data as GrepRequest;
      const result = await executeGrep(body);
      if (result.success) return result;
      return reply.status(400).send(result);
    },
  );

  /**
   * POST /find
   * 文件查找：按名称模式搜索文件。
   *
   * 限流：每分钟最多 30 次
   *
   * 请求体：FindRequest（Zod schema 校验）
   * 响应：{ success: boolean, files?: string[] }
   */
  app.post(
    '/find',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = findFilesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(
            errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'),
          );
      }
      const body = parsed.data as FindRequest;
      const result = executeFind(body, autoDreamConfig.memoryRootDir);
      if (result.success) return result;
      return reply.status(400).send(result);
    },
  );

  /**
   * POST /ls
   * 列出目录内容。
   *
   * 限流：每分钟最多 30 次
   *
   * 请求体：LsRequest（Zod schema 校验）
   * 响应：{ success: boolean, entries?: DirEntry[] }
   */
  app.post(
    '/ls',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = listFilesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send(
            errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'),
          );
      }
      const body = parsed.data as LsRequest;
      const result = await executeLs(body);
      if (result.success) return result;
      return reply.status(400).send(result);
    },
  );

  /**
   * POST /cat
   * 读取文件全部内容。
   *
   * 请求体：CatRequest（Zod schema 校验）
   * 响应：{ success: boolean, content?: string }
   */
  app.post('/cat', async (request, reply) => {
    const parsed = readFileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as CatRequest;
    const result = executeCat(body);
    if (result.success) return result;
    return reply.status(400).send(result);
  });

  /**
   * POST /stat
   * 获取文件元信息（大小、修改时间等）。
   *
   * 请求体：StatRequest（Zod schema 校验）
   * 响应：{ success: boolean, stat?: FileStat }
   */
  app.post('/stat', async (request, reply) => {
    const parsed = fileStatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as StatRequest;
    const result = executeStat(body);
    if (result.success) return result;
    return reply.status(400).send(result);
  });

  /**
   * POST /wc
   * 统计文件的行数、词数、字节数。
   *
   * 请求体：WcRequest（Zod schema 校验）
   * 响应：{ success: boolean, counts?: WcResult }
   */
  app.post('/wc', async (request, reply) => {
    const parsed = wcSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as WcRequest;
    const result = executeWc(body, autoDreamConfig.memoryRootDir);
    if (result.success) return result;
    return reply.status(400).send(result);
  });

  /**
   * POST /head
   * 读取文件头部若干行。
   *
   * 请求体：HeadRequest（Zod schema 校验）
   * 响应：{ success: boolean, content?: string }
   */
  app.post('/head', async (request, reply) => {
    const parsed = headTailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as HeadRequest;
    const result = executeHead(body);
    if (result.success) return result;
    return reply.status(400).send(result);
  });

  /**
   * POST /tail
   * 读取文件尾部若干行。
   *
   * 请求体：TailRequest（Zod schema 校验）
   * 响应：{ success: boolean, content?: string }
   */
  app.post('/tail', async (request, reply) => {
    const parsed = headTailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
    }
    const body = parsed.data as TailRequest;
    const result = executeTail(body);
    if (result.success) return result;
    return reply.status(400).send(result);
  });

  /**
   * POST /memory-search
   * 搜索记忆文件内容。
   *
   * 限流：每分钟最多 20 次
   *
   * 请求体：
   *   - query: string — 搜索关键词（必填）
   *   - type: string — 记忆类型筛选（可选）
   *
   * 响应：{ success: boolean, results?: SearchResult[] }
   *
   * @security 使用 Zod schema 校验，拒绝 type 参数中的路径遍历字符
   */
  app.post(
    '/memory-search',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = memorySearchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(errorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? '请求参数无效'));
      }
      const result = executeSearchMemory({ query: parsed.data.query, type: parsed.data.type });
      if (result.success) return result;
      return reply.status(400).send(result);
    },
  );
}
