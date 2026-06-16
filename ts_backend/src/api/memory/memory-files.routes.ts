/**
 * 记忆文件系统路由模块
 *
 * 职责：提供浏览和读取记忆目录中文件（Markdown、JSON 等文本文件）的端点。
 * 前端通过这些端点展示记忆文件目录树和文件内容预览。
 *
 * 端点概览：
 *   GET /memory-files      — 浏览记忆目录结构（支持子目录导航）
 *   GET /memory-files/read — 读取指定记忆文件内容
 */
import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { sanitizeSearchPath } from '../../tools/pathSecurity.js';
import { env } from '../../config/index.js';
import { getCurrentUser } from '../../core/middleware/index.js';

/** 文件读取大小上限，超过此大小的文件不返回内容（防止内存溢出） */
const MAX_READ_SIZE = 1 * 1024 * 1024; // 1MB

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
}

/** 文件扩展名排序优先级：无扩展名 > .md > .json > 其他 */
const EXT_ORDER: Record<string, number> = {
  '': 0,
  '.md': 1,
  '.json': 2,
};

/** 列出目录内容，按目录优先、扩展名排序、名称字母序排列 */
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
  /**
   * GET /memory-files
   * 浏览记忆目录结构。不传 dir 参数时返回根目录，传 dir 时返回指定子目录。
   *
   * 查询参数：dir: string — 相对于记忆根目录的子目录路径（可选）
   * 响应：{ dir: string, files: FileEntry[] }
   *
   * @security 需要认证；dir 参数通过 sanitizeSearchPath 校验，防止路径遍历
   */
  app.get('', async (request, reply) => {
    getCurrentUser(request);
    const query = request.query as { dir?: string };
    const base = memoriesRoot();
    // @security sanitizeSearchPath 确保路径不会逃逸出记忆根目录
    const targetPath = query.dir ? sanitizeSearchPath(query.dir, base) : base;

    // 首次访问时自动创建根目录（onReady 可能异步执行，目录可能尚未创建）
    let stat: fs.Stats;
    try {
      stat = fs.statSync(targetPath);
    } catch {
      if (targetPath === base) {
        fs.mkdirSync(base, { recursive: true });
        stat = fs.statSync(base);
      } else {
        return reply.status(404).send({ error: '目录不存在' });
      }
    }

    if (!stat.isDirectory()) {
      return reply.status(400).send({ error: '路径不是目录' });
    }

    const files = listFiles(targetPath);
    const relativeDir = path.relative(base, targetPath).replaceAll(path.sep, '/');

    return reply.send({ dir: relativeDir, files });
  });

  /**
   * GET /memory-files/read
   * 读取指定记忆文件的内容。仅支持文本类型文件，超过 1MB 的文件不返回内容。
   *
   * 查询参数：file: string — 相对于记忆根目录的文件路径（必填）
   * 响应：{ name, path, content, size, modifiedAt, truncated?, message? }
   *
   * @security 需要认证；file 参数通过 sanitizeSearchPath 校验，防止路径遍历
   */
  app.get('/read', async (request, reply) => {
    getCurrentUser(request);
    const query = request.query as { file?: string };
    if (!query.file) {
      return reply.status(400).send({ error: 'file 参数不能为空' });
    }

    const base = memoriesRoot();
    // @security sanitizeSearchPath 确保路径不会逃逸出记忆根目录
    const targetPath = sanitizeSearchPath(query.file, base);

    // 合并 existsSync + statSync 为单次 statSync 调用，消除 TOCTOU 竞态
    let stat: fs.Stats;
    try {
      stat = fs.statSync(targetPath);
    } catch {
      return reply.status(404).send({ error: '文件不存在' });
    }

    if (!stat.isFile()) {
      return reply.status(400).send({ error: '路径不是文件' });
    }

    // @security 仅允许文本类型文件预览，防止泄露二进制文件内容
    const ext = path.extname(targetPath).toLowerCase();
    const textExts = ['.md', '.json', '.txt', '.yml', '.yaml', '.css', '.html', '.js', '.ts', ''];
    if (!textExts.includes(ext)) {
      return reply.status(400).send({ error: '不支持预览此文件类型' });
    }

    // 文件大小超过 1MB 时不读取内容，防止内存溢出
    if (stat.size > MAX_READ_SIZE) {
      return reply.send({
        name: path.basename(targetPath),
        path: path.relative(base, targetPath).replaceAll(path.sep, '/'),
        content: null,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        truncated: true,
        message: '文件超过 1MB，不支持预览',
      });
    }

    const content = await fs.promises.readFile(targetPath, 'utf-8');

    return reply.send({
      name: path.basename(targetPath),
      path: path.relative(base, targetPath).replaceAll(path.sep, '/'),
      content,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  });
}
