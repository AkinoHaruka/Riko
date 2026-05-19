// 记忆文件系统 API：浏览和读取记忆目录中的 Markdown/文本文件
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { sanitizeSearchPath } from '../../tools/pathSecurity.js';
import { env } from '../../config/index.js';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
}

const EXT_ORDER: Record<string, number> = {
  '': 0,
  '.md': 1,
  '.json': 2,
};

function listFiles(dirPath: string): FileEntry[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result: FileEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(memoriesRoot(), fullPath).replaceAll(path.sep, '/');

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
      });
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      result.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    const extA = path.extname(a.name).toLowerCase();
    const extB = path.extname(b.name).toLowerCase();
    const orderA = EXT_ORDER[extA] ?? 10;
    const orderB = EXT_ORDER[extB] ?? 10;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });

  return result;
}

function memoriesRoot(): string {
  return path.resolve(env.MEMORY_ROOT_DIR);
}

export async function memoryFilesRoutes(app: FastifyInstance): Promise<void> {
  app.get('', async (request, reply) => {
    const query = request.query as { dir?: string };
    const base = memoriesRoot();
    const targetPath = query.dir ? sanitizeSearchPath(query.dir, base) : base;

    // Auto-create base directory if it doesn't exist yet (onReady may be async)
    if (!fs.existsSync(targetPath)) {
      if (targetPath === base) {
        fs.mkdirSync(base, { recursive: true });
      } else {
        return reply.status(404).send({ error: '目录不存在' });
      }
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return reply.status(400).send({ error: '路径不是目录' });
    }

    const files = listFiles(targetPath);
    const relativeDir = path.relative(base, targetPath).replaceAll(path.sep, '/');

    return reply.send({ dir: relativeDir, files });
  });

  app.get('/read', async (request, reply) => {
    const query = request.query as { file?: string };
    if (!query.file) {
      return reply.status(400).send({ error: 'file 参数不能为空' });
    }

    const base = memoriesRoot();
    const targetPath = sanitizeSearchPath(query.file, base);

    if (!fs.existsSync(targetPath)) {
      return reply.status(404).send({ error: '文件不存在' });
    }

    if (!fs.statSync(targetPath).isFile()) {
      return reply.status(400).send({ error: '路径不是文件' });
    }

    // only allow text-based files
    const ext = path.extname(targetPath).toLowerCase();
    const textExts = ['.md', '.json', '.txt', '.yml', '.yaml', '.css', '.html', '.js', '.ts', ''];
    if (!textExts.includes(ext)) {
      return reply.status(400).send({ error: '不支持预览此文件类型' });
    }

    const content = fs.readFileSync(targetPath, 'utf-8');
    const stat = fs.statSync(targetPath);

    return reply.send({
      name: path.basename(targetPath),
      path: path.relative(base, targetPath).replaceAll(path.sep, '/'),
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  });
}
