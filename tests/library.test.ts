import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/lib/library.ts';

let work: string;
let photosDir: string;
let imgDir: string;
let manifestPath: string;
const scan = () => scanLibrary({ photosDir, imgDir, manifestPath });

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'portfolio-test-'));
  photosDir = path.join(work, 'photos');
  imgDir = path.join(work, 'data', 'img');
  manifestPath = path.join(work, 'data', 'library.json');
  await mkdir(photosDir, { recursive: true });
  await cp('sample-photos/01 Coast', path.join(photosDir, '01 Coast'), { recursive: true });
  await cp('sample-photos/03 Fog', path.join(photosDir, '03 Fog'), { recursive: true });
  await cp('sample-photos/site.json', path.join(photosDir, 'site.json'));
  // Clutter that must be ignored or survived:
  await writeFile(path.join(photosDir, '01 Coast', '._still-water.jpg'), 'macOS resource fork');
  await writeFile(path.join(photosDir, '01 Coast', 'broken.jpg'), 'not really a jpeg');
  await mkdir(path.join(photosDir, '@eaDir'));
  await mkdir(path.join(photosDir, 'Drafts'));
  await cp('sample-photos/02 Hills/alpenglow.jpg', path.join(photosDir, 'Drafts', 'alpenglow.jpg'));
  await writeFile(path.join(photosDir, 'Drafts', 'album.json'), JSON.stringify({ hidden: true }));
}, 30_000);

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe('scanLibrary', () => {
  it('builds albums from folders, skipping clutter and hidden albums', async () => {
    const { library, stats } = await scan();
    expect(library.albums.map((a) => [a.order, a.slug, a.title, a.photos.length])).toEqual([
      [1, 'coast', 'Coast', 2],
      [3, 'fog', 'Fog', 1],
    ]);
    expect(stats.skipped).toBe(1); // broken.jpg
    expect(library.site.author).toBe('[YOUR NAME]');
    expect(library.albums[0].description).toBe('Beaches and open water, from midday to blue hour.');
    // Sorted by capture time, not file name.
    expect(library.albums[0].photos.map((p) => p.slug)).toEqual(['sunny-shoreline', 'still-water']);
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).albums).toHaveLength(2);
  }, 120_000);

  it('auto-rotates photos stored sideways', async () => {
    const { library } = await scan();
    const pines = library.albums[1].photos[0];
    expect([pines.width, pines.height, pines.orientation]).toEqual([1200, 1600, 'portrait']);
    const meta = await sharp(path.join(imgDir, path.basename(pines.variants[0].webp))).metadata();
    expect(meta.height).toBeGreaterThan(meta.width);
  });

  it('strips all metadata, including GPS, from the published images', async () => {
    const { library } = await scan();
    const shore = library.albums[0].photos.find((p) => p.slug === 'sunny-shoreline')!;
    const files = [...shore.variants.flatMap((v) => [v.avif, v.webp]), shore.og].map((u) => path.join(imgDir, path.basename(u)));
    for (const file of files) {
      const buffer = await readFile(file);
      expect(await exifr.gps(buffer).catch(() => undefined)).toBeUndefined();
      expect((await sharp(buffer).metadata()).exif).toBeUndefined();
    }
    expect(JSON.stringify(shore)).not.toMatch(/latitude|longitude|gps/i);
  });

  it('never upscales and always includes the original width', async () => {
    const { library } = await scan();
    const widths = library.albums[0].photos[0].variants.map((v) => v.width);
    expect(widths).toEqual([640, 1024, 1600, 1920]);
  });

  it('reuses existing images on the next run', async () => {
    const before = (await readdir(imgDir)).sort();
    const { stats } = await scan();
    expect(stats.removedFiles).toBe(0);
    expect((await readdir(imgDir)).sort()).toEqual(before);
  });

  it('cleans up images of deleted photos and drops empty albums', async () => {
    await rm(path.join(photosDir, '03 Fog', 'into-the-pines.jpg'));
    const { library, stats } = await scan();
    expect(library.albums.map((a) => a.slug)).toEqual(['coast']);
    expect(stats.removedFiles).toBe(7); // 3 widths x (AVIF + WebP) + the preview JPEG
  });
});
