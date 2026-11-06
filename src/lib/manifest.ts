import { readFileSync } from 'node:fs';
import { getPaths } from './config.ts';
import { MANIFEST_VERSION, type Album, type Library, type Photo } from './types.ts';

/** Build-time access to library.json for the pages. */

let cached: Library | undefined;

export function loadLibrary(): Library {
  if (cached) return cached;
  const { manifestPath } = getPaths();
  let text: string;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`No photo library at ${manifestPath}. Run "npm run process" first.`);
  }
  const library = JSON.parse(text) as Library;
  if (library.version !== MANIFEST_VERSION) {
    throw new Error(`library.json is version ${library.version}, expected ${MANIFEST_VERSION}. Run "npm run process".`);
  }
  cached = library;
  return library;
}

export const albumUrl = (album: Pick<Album, 'slug'>) => `/albums/${album.slug}/`;
export const photoUrl = (photo: Pick<Photo, 'albumSlug' | 'slug'>) => `/albums/${photo.albumSlug}/${photo.slug}/`;

export function findAlbum(library: Library, slug: string): Album | undefined {
  return library.albums.find((a) => a.slug === slug);
}

export function coverOf(album: Album): Photo {
  return album.photos.find((p) => p.slug === album.coverSlug) ?? album.photos[0];
}

/**
 * The home page selection: the photos listed in site.json "featured" (as
 * "album-slug/photo-slug"), or else the newest photos across all albums.
 */
export function homePhotos(library: Library, limit = 12): Photo[] {
  const all = library.albums.flatMap((a) => a.photos);
  if (library.site.featured.length) {
    const byKey = new Map(all.map((p) => [`${p.albumSlug}/${p.slug}`, p]));
    const picked = library.site.featured.map((key) => byKey.get(key.replace(/^\/+|\/+$/g, ''))).filter((p): p is Photo => !!p);
    if (picked.length) return picked;
  }
  return [...all]
    .sort((a, b) => (b.exif.takenAt ?? '').localeCompare(a.exif.takenAt ?? ''))
    .slice(0, limit);
}

/** A wide photo for the little window in the home headline. */
export function headlinePhoto(photos: Photo[]): Photo | undefined {
  return photos.find((p) => p.orientation === 'landscape') ?? photos[0];
}

/** "2026" or "2025–2026" for an album's date range. */
export function yearSpan(album: Album): string | undefined {
  if (!album.dateRange) return undefined;
  const [from, to] = album.dateRange.map((d) => d.slice(0, 4));
  return from === to ? from : `${from}–${to}`;
}
