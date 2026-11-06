/** Shape of library.json, the manifest the pipeline writes and the pages read. */

export const MANIFEST_VERSION = 1;

export type Orientation = 'landscape' | 'portrait' | 'square';

/** Camera details shown on the photo page. GPS is never read, so it can't end up here. */
export interface ExifInfo {
  camera?: string;
  lens?: string;
  focalLength?: number;
  aperture?: number;
  exposureTime?: number;
  iso?: number;
  /** Capture time as written by the camera, without a timezone: "2026-08-14T13:05:22". */
  takenAt?: string;
}

export interface ImageVariant {
  width: number;
  height: number;
  avif: string;
  webp: string;
}

export interface Photo {
  /** Content hash; also the prefix of every resized file. */
  id: string;
  slug: string;
  albumSlug: string;
  /** Source path relative to the photos folder (for logs and debugging). */
  source: string;
  title: string;
  caption?: string;
  width: number;
  height: number;
  orientation: Orientation;
  /** Dominant colour, shown while the image loads. */
  color: string;
  /** Smallest first. */
  variants: ImageVariant[];
  /** 1200px JPEG for link previews (Discord, iMessage, etc.). */
  og: string;
  exif: ExifInfo;
}

export interface Album {
  slug: string;
  title: string;
  description?: string;
  order: number;
  coverSlug: string;
  photos: Photo[];
  /** Earliest and latest capture dates (YYYY-MM-DD), when the photos have them. */
  dateRange?: [string, string];
}

export interface SiteConfig {
  title: string;
  author: string;
  location: string;
  intro: string;
  instagram: string;
  email: string;
  /** Optional hand-picked photos for the home page, as "album-slug/photo-slug". */
  featured: string[];
}

export interface Library {
  version: typeof MANIFEST_VERSION;
  generatedAt: string;
  site: SiteConfig;
  albums: Album[];
}
