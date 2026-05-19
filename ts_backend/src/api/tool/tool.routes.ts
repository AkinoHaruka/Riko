// AI 工具代理 API：将 AI 工具调用（编辑、搜索、文件操作等）转发到 Fastify HTTP 端点
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
  errorResponse,
} from '../../core/validation/schemas.js';

// 认证由全局 authMiddleware (onRequest 钩子) 统一处理

export async function registerToolRoutes(app: FastifyInstance): Promise<void> {
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

  app.get('/edit', async (request, reply) => {
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
  });

  app.get('/edit/list', async (request, reply) => {
    const query = request.query as { path?: string };
    const result = listDirectory(query.path ?? '');
    if (result.success) {
      return result;
    }
    if (result.message?.includes('不存在')) {
      return reply.status(404).send(result);
    }
    return reply.status(400).send(result);
  });

  app.delete('/edit', async (request, reply) => {
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
  });

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

  app.get('/write', async (request, reply) => {
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
  });

  app.get('/write/list', async (request, reply) => {
    const query = request.query as { path?: string };
    const result = listDirectory(query.path ?? '');
    if (result.success) {
      return result;
    }
    if (result.message?.includes('不存在')) {
      return reply.status(404).send(result);
    }
    return reply.status(400).send(result);
  });

  app.delete('/write', async (request, reply) => {
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
  });

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
      const result = executeGrep(body);
      if (result.success) return result;
      return reply.status(400).send(result);
    },
  );

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
      const result = executeLs(body);
      if (result.success) return result;
      return reply.status(400).send(result);
    },
  );

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

  app.post(
    '/memory-search',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as { query?: string; type?: string };
      if (!body.query || typeof body.query !== 'string') {
        return reply.status(400).send(errorResponse('VALIDATION_ERROR', 'query 参数不能为空'));
      }
      const result = executeSearchMemory({ query: body.query, type: body.type });
      if (result.success) return result;
      return reply.status(400).send(result);
    },
  );
}
