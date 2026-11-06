import path from 'node:path';

/**
 * Where things live. Every path can be overridden with an environment variable,
 * which is how the container points at the mounted photos and data volumes.
 *
 * - PHOTOS_DIR: the folder of albums (read-only is fine). Defaults to ./sample-photos.
 * - DATA_DIR:   writable folder for resized images, the manifest and the built site.
 */
export interface Paths {
  root: string;
  photosDir: string;
  dataDir: string;
  imgDir: string;
  manifestPath: string;
  siteDir: string;
}

export function getPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const root = path.resolve(env.PORTFOLIO_ROOT ?? process.cwd());
  const photosDir = path.resolve(root, env.PHOTOS_DIR ?? 'sample-photos');
  const dataDir = path.resolve(root, env.DATA_DIR ?? '.data');
  return {
    root,
    photosDir,
    dataDir,
    imgDir: path.join(dataDir, 'img'),
    manifestPath: path.join(dataDir, 'library.json'),
    siteDir: path.join(dataDir, 'site'),
  };
}

/** URL prefix the resized images are served under. */
export const IMG_URL_PREFIX = '/_img/';
