import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler, resolveInside } from '../server/static.ts';

let work: string;
let server: http.Server;
let port: number;

/** Raw request, so paths like /../ reach the server unnormalized. */
function request(rawPath: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: init.method ?? 'GET', headers: init.headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'portfolio-static-'));
  const siteDir = path.join(work, 'site');
  const imgDir = path.join(work, 'img');
  await mkdir(path.join(siteDir, 'albums', 'coast'), { recursive: true });
  await mkdir(path.join(siteDir, '_astro'), { recursive: true });
  await mkdir(imgDir);
  await writeFile(path.join(siteDir, 'index.html'), '<h1>home</h1>');
  await writeFile(path.join(siteDir, 'albums', 'coast', 'index.html'), '<h1>coast</h1>');
  await writeFile(path.join(siteDir, '404.html'), '<h1>missing</h1>');
  await writeFile(path.join(siteDir, '_astro', 'app.abc123.css'), 'body{}');
  await writeFile(path.join(work, 'secret.txt'), 'do not serve');
  await writeFile(path.join(imgDir, '0123456789abcdef-640.webp'), 'webp-bytes');
  await writeFile(path.join(imgDir, 'notes.txt'), 'not an image');

  const handle = createStaticHandler({ siteDir, imgDir, health: () => ({ ok: true, building: false }) });
  server = http.createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(work, { recursive: true, force: true });
});

describe('static server', () => {
  it('serves pages with short caching and security headers', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('<h1>home</h1>');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toContain('max-age=60');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('redirects folders to their trailing-slash URL', async () => {
    const res = await request('/albums/coast?x=1');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/albums/coast/?x=1');
    expect((await request('/albums/coast/')).body).toBe('<h1>coast</h1>');
  });

  it('caches hashed assets and images forever', async () => {
    expect((await request('/_astro/app.abc123.css')).headers['cache-control']).toContain('immutable');
    const img = await request('/_img/0123456789abcdef-640.webp');
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('immutable');
  });

  it('only serves image files that match the generated naming', async () => {
    expect((await request('/_img/notes.txt')).status).toBe(404);
    expect((await request('/_img/../site/index.html')).status).toBe(404);
  });

  it('never escapes the site folder', async () => {
    for (const p of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/albums/../../secret.txt', '/..\\secret.txt']) {
      const res = await request(p);
      expect(res.body, p).not.toContain('do not serve');
      expect([400, 404], p).toContain(res.status);
    }
  });

  it('uses the site 404 page', async () => {
    const res = await request('/nope/');
    expect(res.status).toBe(404);
    expect(res.body).toBe('<h1>missing</h1>');
  });

  it('rejects bad input and other methods', async () => {
    expect((await request('/%E0%A4%A')).status).toBe(400);
    expect((await request('/', { method: 'POST' })).status).toBe(405);
    expect((await request('/a%00b')).status).toBe(400);
  });

  it('supports HEAD and conditional requests', async () => {
    const head = await request('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    const again = await request('/', { headers: { 'If-Modified-Since': String(head.headers['last-modified']) } });
    expect(again.status).toBe(304);
  });

  it('answers health checks', async () => {
    const res = await request('/healthz');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, building: false });
  });
});

describe('resolveInside', () => {
  it('keeps paths inside the root', () => {
    const root = path.resolve('/srv/site');
    expect(resolveInside(root, '/a/b.html')).toBe(path.join(root, 'a', 'b.html'));
    expect(resolveInside(root, '/../../etc/passwd')).toBe(path.join(root, 'etc', 'passwd'));
    expect(resolveInside(root, '/')).toBe(root);
  });
});
