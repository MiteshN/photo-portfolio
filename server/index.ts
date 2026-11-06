// Production entry point: builds the site, serves it, and rebuilds whenever the
// photos folder changes. Run with `node server/index.ts` (Node 24+ runs TypeScript).
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, rename, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { getPaths } from '../src/lib/config.ts';
import { scanLibrary } from '../src/lib/library.ts';
import { createStaticHandler } from './static.ts';

const paths = getPaths();
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
/** Wait this long after the last change before rebuilding (copying a batch of photos takes a while). */
const DEBOUNCE_MS = Number(process.env.REBUILD_DEBOUNCE_MS ?? 5000);
/** Safety net in case a change event is missed: re-check the folder this often. 0 turns it off. */
const RESCAN_MINUTES = Number(process.env.RESCAN_MINUTES ?? 30);
/** "auto" (filesystem events), "polling" (for network mounts), or "off". */
const WATCH_MODE = process.env.WATCH_MODE ?? 'auto';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);

const state = {
  building: false,
  queued: false,
  fingerprint: '',
  lastBuild: null as null | { at: string; albums: number; photos: number; seconds: number },
  lastError: null as null | string,
};
let child: ChildProcess | null = null;
let siteReady = false;

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

async function rebuild(reason: string): Promise<void> {
  if (state.building) {
    state.queued = true;
    return;
  }
  state.building = true;
  const started = Date.now();
  try {
    log(`Rebuilding (${reason})`);
    const fingerprint = await fingerprintPhotos();
    const { stats } = await scanLibrary({
      photosDir: paths.photosDir,
      imgDir: paths.imgDir,
      manifestPath: paths.manifestPath,
      concurrency: CONCURRENCY,
      log: (m) => log(`  ${m}`),
    });

    const nextDir = path.join(paths.dataDir, 'site-next');
    await rm(nextDir, { recursive: true, force: true });
    await runAstroBuild(nextDir);
    await swapIn(nextDir, paths.siteDir);

    state.fingerprint = fingerprint;
    state.lastError = null;
    state.lastBuild = {
      at: new Date().toISOString(),
      albums: stats.albums,
      photos: stats.photos,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    };
    siteReady = true;
    log(`Site updated: ${stats.albums} albums, ${stats.photos} photos in ${state.lastBuild.seconds}s`);
  } catch (err) {
    state.lastError = (err as Error).message;
    log(`Rebuild failed, still serving the previous version: ${state.lastError}`);
  } finally {
    state.building = false;
    if (state.queued) {
      state.queued = false;
      void rebuild('changes during the last build');
    }
  }
}

function runAstroBuild(outDir: string): Promise<void> {
  const astro = path.join(paths.root, 'node_modules', 'astro', 'bin', 'astro.mjs');
  return new Promise((resolve, reject) => {
    const output: string[] = [];
    child = spawn(process.execPath, [astro, 'build', '--outDir', outDir], {
      cwd: paths.root,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (chunk: Buffer) => {
      output.push(chunk.toString());
      if (output.length > 200) output.shift();
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      child = null;
      if (code === 0) resolve();
      else reject(new Error(`astro build exited with ${signal ?? code}\n${output.join('').slice(-4000)}`));
    });
  });
}

/** Replace the live site folder with the freshly built one. */
async function swapIn(nextDir: string, liveDir: string): Promise<void> {
  const oldDir = `${liveDir}-old`;
  await rm(oldDir, { recursive: true, force: true });
  const hadLive = await stat(liveDir).then(() => true, () => false);
  if (hadLive) await retry(() => rename(liveDir, oldDir));
  await retry(() => rename(nextDir, liveDir));
  await rm(oldDir, { recursive: true, force: true });
}

async function retry(fn: () => Promise<void>, attempts = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      // Windows refuses to rename a folder while a file in it is being read.
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
}

/** Cheap summary of the photos folder (names, sizes, times) to spot changes without reading files. */
async function fingerprintPhotos(): Promise<string> {
  const hash = createHash('sha1');
  const walk = async (dir: string, depth: number) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('@') || e.name.startsWith('#')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 1) {
        hash.update(`d:${e.name}\n`);
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        const s = await stat(full).catch(() => null);
        if (s) hash.update(`f:${path.relative(paths.photosDir, full)}:${s.size}:${s.mtimeMs}\n`);
      }
    }
  };
  await walk(paths.photosDir, 0);
  return hash.digest('hex');
}

let debounce: NodeJS.Timeout | undefined;
function scheduleRebuild(reason: string): void {
  clearTimeout(debounce);
  debounce = setTimeout(() => void rebuild(reason), DEBOUNCE_MS);
}

function startWatching(): FSWatcher | null {
  if (WATCH_MODE === 'off') return null;
  const watcher = chokidar.watch(paths.photosDir, {
    ignoreInitial: true,
    depth: 1,
    ignored: (p) => /(^|[\\/])(\.|@eaDir|#recycle|#snapshot)/.test(path.relative(paths.photosDir, p)),
    awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 250 },
    backend: WATCH_MODE === 'polling' ? 'polling' : 'auto',
    pollingInterval: 5000,
  });
  watcher.on('all', (event, file) => {
    log(`Change: ${event} ${path.relative(paths.photosDir, file) || '.'}`);
    scheduleRebuild('photos changed');
  });
  watcher.on('error', (err) => log(`Watcher error: ${(err as Error).message}`));
  return watcher;
}

const handle = createStaticHandler({
  siteDir: paths.siteDir,
  imgDir: paths.imgDir,
  health: () => ({ ok: siteReady, building: state.building, lastBuild: state.lastBuild, lastError: state.lastError }),
});

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    log(`Request error ${req.url}: ${(err as Error).message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

siteReady = await stat(path.join(paths.siteDir, 'index.html')).then(() => true, () => false);
server.listen(PORT, HOST, () => {
  log(`Serving on http://${HOST}:${PORT} (photos: ${paths.photosDir}, data: ${paths.dataDir})`);
});

const watcher = startWatching();
const rescan =
  RESCAN_MINUTES > 0
    ? setInterval(async () => {
        if (!state.building && (await fingerprintPhotos()) !== state.fingerprint) void rebuild('periodic check found changes');
      }, RESCAN_MINUTES * 60_000)
    : undefined;

// Always build on start: the code or image settings may have changed since last time.
void rebuild('startup');

async function shutdown(signal: string): Promise<void> {
  log(`${signal}: shutting down`);
  clearTimeout(debounce);
  clearInterval(rescan);
  child?.kill('SIGTERM');
  await watcher?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
