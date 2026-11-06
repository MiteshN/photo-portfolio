import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { IMG_URL_PREFIX } from './config.ts';
import type { ImageVariant, Orientation } from './types.ts';

/**
 * Bump when the output settings change, so every photo is re-encoded once.
 * It's part of each photo's id, and so of every file name.
 */
export const PIPELINE_VERSION = 1;

/** Widths generated for each photo (never upscaled; the original width is always included). */
export const WIDTHS = [640, 1024, 1600, 2400];
const OG_WIDTH = 1200;

/** Resized files are named `<id>-<width>.<ext>`; anything else in the folder is left alone. */
export const IMG_FILE_PATTERN = /^([a-f0-9]{16})-(\d+)\.(avif|webp|jpg)$/;

export interface ProcessedImage {
  width: number;
  height: number;
  orientation: Orientation;
  color: string;
  variants: ImageVariant[];
  og: string;
}

/**
 * Makes the web-sized copies of one photo. Output is auto-rotated, converted to sRGB
 * and has all metadata stripped (sharp's default), so GPS and serial numbers never
 * leave the NAS. Files that already exist are reused, so re-runs are cheap.
 */
export async function processImage(buffer: Buffer, id: string, imgDir: string): Promise<ProcessedImage> {
  await mkdir(imgDir, { recursive: true });
  const base = () => sharp(buffer, { autoOrient: true, failOn: 'error' });

  const meta = await sharp(buffer).metadata();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new Error('could not read image dimensions');

  const widths = targetWidths(width);
  const variants: ImageVariant[] = [];
  for (const w of widths) {
    const h = Math.round((height * w) / width);
    const avif = `${id}-${w}.avif`;
    const webp = `${id}-${w}.webp`;
    await writeIfMissing(path.join(imgDir, avif), (out) =>
      base().resize({ width: w }).avif({ quality: 55, effort: 4 }).toFile(out),
    );
    await writeIfMissing(path.join(imgDir, webp), (out) =>
      base().resize({ width: w }).webp({ quality: 80, effort: 4 }).toFile(out),
    );
    variants.push({ width: w, height: h, avif: IMG_URL_PREFIX + avif, webp: IMG_URL_PREFIX + webp });
  }

  const ogW = Math.min(OG_WIDTH, width);
  const og = `${id}-${ogW}.jpg`;
  await writeIfMissing(path.join(imgDir, og), (out) =>
    base().resize({ width: ogW }).jpeg({ quality: 82, mozjpeg: true }).toFile(out),
  );

  const { dominant } = await base().resize({ width: 64 }).stats();

  return {
    width,
    height,
    orientation: orientationOf(width, height),
    color: toHex(dominant),
    variants,
    og: IMG_URL_PREFIX + og,
  };
}

export function targetWidths(original: number): number[] {
  const below = WIDTHS.filter((w) => w < original);
  const top = Math.min(original, WIDTHS[WIDTHS.length - 1]);
  return [...new Set([...below, top])].sort((a, b) => a - b);
}

export function orientationOf(width: number, height: number): Orientation {
  const ratio = width / height;
  if (ratio > 1.1) return 'landscape';
  if (ratio < 0.9) return 'portrait';
  return 'square';
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

async function writeIfMissing(file: string, write: (out: string) => Promise<unknown>): Promise<void> {
  if (await exists(file)) return;
  // Write to a temp name first so the server never serves a half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await write(tmp);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
