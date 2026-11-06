import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readExif } from './exif.ts';
import { IMG_FILE_PATTERN, PIPELINE_VERSION, processImage } from './images.ts';
import { parseFolderName, slugify, titleFromFilename, uniqueSlug } from './slug.ts';
import { MANIFEST_VERSION, type Album, type Library, type Photo, type SiteConfig } from './types.ts';

/** Formats sharp can read with its bundled libvips. (HEIC isn't one: export JPEGs.) */
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff']);

/** NAS and OS clutter that should never become an album or a photo. */
const IGNORED_DIRS = new Set(['@eaDir', '#recycle', '#snapshot', '.zfs', '$RECYCLE.BIN', 'System Volume Information', 'lost+found']);

export const DEFAULT_SITE: SiteConfig = {
  title: 'Mugetsu',
  author: '',
  location: '',
  intro: '',
  instagram: '',
  email: '',
  featured: [],
};

/** Optional per-album settings, from `album.json` inside the album folder. */
interface AlbumSettings {
  title?: string;
  description?: string;
  order?: number;
  /** File name of the cover photo. Defaults to the first photo. */
  cover?: string;
  /** "date" (capture time, the default) or "name" (file name). */
  sort?: 'date' | 'name';
  hidden?: boolean;
}

export interface ScanOptions {
  photosDir: string;
  imgDir: string;
  manifestPath: string;
  /** How many photos to resize at once. Kept low so the NAS stays responsive. */
  concurrency?: number;
  log?: (message: string) => void;
}

export interface ScanResult {
  library: Library;
  stats: { albums: number; photos: number; skipped: number; removedFiles: number; ms: number };
}

/**
 * Scans the photos folder, makes any missing web-sized images, deletes images for
 * photos that are gone, and writes library.json. Safe to run as often as you like.
 */
export async function scanLibrary(options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const { photosDir, imgDir, manifestPath } = options;
  const concurrency = Math.max(1, options.concurrency ?? 2);

  const site = await readSiteConfig(photosDir, log);
  const entries = await readdir(photosDir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      log(`photos folder not found: ${photosDir}`);
      return [];
    }
    throw err;
  });

  const albums: Album[] = [];
  const albumSlugs = new Set<string>();
  let skipped = 0;

  const folders = entries
    .filter((e) => e.isDirectory() && !isHidden(e.name) && !IGNORED_DIRS.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const folder of folders) {
    const dir = path.join(photosDir, folder);
    const settings = await readJson<AlbumSettings>(path.join(dir, 'album.json'), log);
    if (settings?.hidden) continue;

    const parsed = parseFolderName(folder);
    const title = settings?.title?.trim() || parsed.title;
    const slug = uniqueSlug(slugify(title), albumSlugs, 'album');

    const files = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && !isHidden(e.name) && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    const results = await mapLimit(files, concurrency, async (file) => {
      try {
        return await loadPhoto(path.join(dir, file), path.join(folder, file), slug, imgDir);
      } catch (err) {
        log(`skipped ${folder}/${file}: ${(err as Error).message}`);
        skipped++;
        return null;
      }
    });
    const loaded = results.filter((r): r is LoadedPhoto => r !== null);
    if (loaded.length === 0) continue;

    if (settings?.sort !== 'name') {
      // Capture time first; photos without one keep file-name order at the end.
      loaded.sort((a, b) => (a.photo.exif.takenAt ?? '￿').localeCompare(b.photo.exif.takenAt ?? '￿'));
    }

    const photoSlugs = new Set<string>();
    const photos = loaded.map(({ photo }) => ({ ...photo, slug: uniqueSlug(photo.slug, photoSlugs) }));
    const coverFile = settings?.cover?.toLowerCase();
    const cover = photos.find((p) => coverFile && path.basename(p.source).toLowerCase() === coverFile) ?? photos[0];
    const dates = photos.map((p) => p.exif.takenAt?.slice(0, 10)).filter((d): d is string => !!d).sort();

    albums.push({
      slug,
      title,
      description: settings?.description?.trim() || undefined,
      order: settings?.order ?? parsed.order ?? Number.MAX_SAFE_INTEGER,
      coverSlug: cover.slug,
      photos,
      dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : undefined,
    });
  }

  albums.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  const library: Library = { version: MANIFEST_VERSION, generatedAt: new Date().toISOString(), site, albums };
  const removedFiles = await removeOrphans(imgDir, new Set(albums.flatMap((a) => a.photos.map((p) => p.id))));
  await writeJsonAtomic(manifestPath, library);

  const photoCount = albums.reduce((n, a) => n + a.photos.length, 0);
  return { library, stats: { albums: albums.length, photos: photoCount, skipped, removedFiles, ms: Date.now() - started } };
}

interface LoadedPhoto {
  photo: Photo;
}

async function loadPhoto(file: string, source: string, albumSlug: string, imgDir: string): Promise<LoadedPhoto> {
  const buffer = await readFile(file);
  // Content hash: renaming or moving a file doesn't trigger re-encoding.
  const id = createHash('sha256').update(`v${PIPELINE_VERSION}:`).update(buffer).digest('hex').slice(0, 16);
  const [{ exif, text }, image] = await Promise.all([readExif(buffer), processImage(buffer, id, imgDir)]);
  const name = path.basename(source);
  return {
    photo: {
      id,
      slug: slugify(name.replace(/\.[^.]+$/, '')),
      albumSlug,
      source: source.split(path.sep).join('/'),
      title: text.title ?? titleFromFilename(name),
      caption: text.caption,
      ...image,
      exif,
    },
  };
}

async function readSiteConfig(photosDir: string, log: (m: string) => void): Promise<SiteConfig> {
  const raw = await readJson<Partial<SiteConfig>>(path.join(photosDir, 'site.json'), log);
  const site: SiteConfig = { ...DEFAULT_SITE };
  if (!raw) return site;
  for (const key of ['title', 'author', 'location', 'intro', 'instagram', 'email'] as const) {
    if (typeof raw[key] === 'string') site[key] = raw[key].trim();
  }
  if (!site.title) site.title = DEFAULT_SITE.title;
  if (Array.isArray(raw.featured)) site.featured = raw.featured.filter((f): f is string => typeof f === 'string');
  return site;
}

async function readJson<T>(file: string, log: (m: string) => void): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, '')) as T;
  } catch (err) {
    log(`ignored ${file}: ${(err as Error).message}`);
    return null;
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, file);
}

/** Deletes resized files whose photo no longer exists. Returns how many were removed. */
async function removeOrphans(imgDir: string, keep: Set<string>): Promise<number> {
  let names: string[];
  try {
    names = await readdir(imgDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const match = IMG_FILE_PATTERN.exec(name);
    if (match && !keep.has(match[1])) {
      await rm(path.join(imgDir, name), { force: true });
      removed++;
    }
  }
  return removed;
}

function isHidden(name: string): boolean {
  // Dotfiles, macOS "._" resource forks written over SMB, and Windows temp files.
  return name.startsWith('.') || name.startsWith('~$');
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
