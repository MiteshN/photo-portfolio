// Scans the photos folder, makes web-sized images and writes the manifest.
// Usage: node scripts/process.ts   (PHOTOS_DIR / DATA_DIR override the defaults)
import { getPaths } from '../src/lib/config.ts';
import { scanLibrary } from '../src/lib/library.ts';

const { photosDir, imgDir, manifestPath } = getPaths();
console.log(`Scanning ${photosDir}`);

const { stats } = await scanLibrary({
  photosDir,
  imgDir,
  manifestPath,
  concurrency: Number(process.env.CONCURRENCY ?? 2),
  log: (m) => console.log(`  ${m}`),
});

console.log(
  `Done in ${(stats.ms / 1000).toFixed(1)}s: ${stats.albums} albums, ${stats.photos} photos` +
    (stats.skipped ? `, ${stats.skipped} skipped` : '') +
    (stats.removedFiles ? `, ${stats.removedFiles} old image files removed` : ''),
);
