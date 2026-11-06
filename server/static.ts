import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { IMG_FILE_PATTERN } from '../src/lib/images.ts';

/**
 * A small, read-only static file server for the built site and the resized images.
 * It only ever serves files inside the two folders it's given.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const HTML_CACHE = 'public, max-age=60, must-revalidate';
const OTHER_CACHE = 'public, max-age=3600';

export interface StaticOptions {
  siteDir: string;
  imgDir: string;
  /** Answer /healthz with this, e.g. whether a site has been built yet. */
  health?: () => { ok: boolean; [key: string]: unknown };
}

export function createStaticHandler({ siteDir, imgDir, health }: StaticOptions) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendText(res, 405, 'Method Not Allowed');
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return sendText(res, 400, 'Bad Request');
    }
    if (pathname.includes('\0') || pathname.includes('\\')) return sendText(res, 400, 'Bad Request');

    if (pathname === '/healthz') {
      const body = health?.() ?? { ok: true };
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(body.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
      return;
    }

    const serve = async (file: string, cacheControl: string) => {
      if (!(await sendFile(req, res, file, cacheControl))) await notFound(req, res, siteDir);
    };

    if (pathname.startsWith('/_img/')) {
      const name = pathname.slice('/_img/'.length);
      if (!IMG_FILE_PATTERN.test(name)) return notFound(req, res, siteDir);
      return serve(path.join(imgDir, name), IMMUTABLE);
    }

    const file = resolveInside(siteDir, pathname);
    if (!file) return notFound(req, res, siteDir);

    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      if (!pathname.endsWith('/')) return redirect(res, pathname + '/' + search(req));
      return serve(path.join(file, 'index.html'), HTML_CACHE);
    }
    if (info?.isFile()) {
      return serve(file, pathname.startsWith('/_astro/') ? IMMUTABLE : file.endsWith('.html') ? HTML_CACHE : OTHER_CACHE);
    }
    return notFound(req, res, siteDir);
  };
}

/** Joins a URL path onto a root folder, refusing anything that would escape it. */
export function resolveInside(root: string, pathname: string): string | null {
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, '.' + path.posix.normalize('/' + pathname));
  if (file !== resolvedRoot && !file.startsWith(resolvedRoot + path.sep)) return null;
  return file;
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cacheControl: string): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;

  const lastModified = info.mtime.toUTCString();
  res.setHeader('Last-Modified', lastModified);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');

  const since = req.headers['if-modified-since'];
  if (since && Date.parse(since) >= Math.floor(info.mtimeMs / 1000) * 1000) {
    res.writeHead(304);
    res.end();
    return true;
  }

  res.setHeader('Content-Length', info.size);
  res.writeHead(200);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise<void>((resolve) => {
    const stream = createReadStream(file);
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    stream.on('end', resolve);
    stream.pipe(res);
  });
  return true;
}

async function notFound(req: IncomingMessage, res: ServerResponse, siteDir: string): Promise<void> {
  const page = path.join(siteDir, '404.html');
  const info = await stat(page).catch(() => null);
  if (!info?.isFile()) return sendText(res, 404, 'Not Found');
  res.setHeader('Cache-Control', 'no-cache');
  res.writeHead(404, { 'Content-Type': TYPES['.html'], 'Content-Length': info.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(page).pipe(res);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(301, { Location: location, 'Cache-Control': OTHER_CACHE });
  res.end();
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': TYPES['.txt'], 'Cache-Control': 'no-store' });
  res.end(text);
}

function search(req: IncomingMessage): string {
  const i = req.url?.indexOf('?') ?? -1;
  return i >= 0 ? req.url!.slice(i) : '';
}
