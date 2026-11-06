import exifr from 'exifr';
import type { ExifInfo } from './types.ts';

/** Title and caption a photo editor (e.g. Lightroom) may have embedded on export. */
export interface EmbeddedText {
  title?: string;
  caption?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Reads camera details plus any embedded title/caption. GPS is deliberately not
 * parsed, so location can never reach the manifest or the site.
 *
 * Takes a Buffer rather than a path: exifr's file reader breaks on Node 26.
 */
export async function readExif(buffer: Buffer): Promise<{ exif: ExifInfo; text: EmbeddedText }> {
  let raw: Record<string, unknown> | undefined;
  try {
    raw = await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      gps: false,
      xmp: true,
      iptc: true,
      icc: false,
      reviveValues: false,
      mergeOutput: true,
    });
  } catch {
    raw = undefined;
  }
  if (!raw) return { exif: {}, text: {} };

  const exif: ExifInfo = {
    camera: formatCamera(str(raw.Make), str(raw.Model)),
    lens: str(raw.LensModel) ?? str(raw.Lens),
    focalLength: num(raw.FocalLength),
    aperture: num(raw.FNumber),
    exposureTime: num(raw.ExposureTime),
    iso: num(raw.ISO) ?? num(raw.ISOSpeedRatings) ?? num(raw.PhotographicSensitivity),
    takenAt: normalizeExifDate(str(raw.DateTimeOriginal) ?? str(raw.CreateDate)),
  };
  for (const key of Object.keys(exif) as (keyof ExifInfo)[]) {
    if (exif[key] === undefined) delete exif[key];
  }

  const text: EmbeddedText = {
    title: langText(raw.title) ?? str(raw.ObjectName),
    caption: langText(raw.description) ?? str(raw.Caption) ?? str(raw.ImageDescription),
  };
  if (!text.title) delete text.title;
  if (!text.caption) delete text.caption;
  return { exif, text };
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') {
    // Cameras often pad fixed-width fields with NULs or spaces.
    const trimmed = value.replace(/\0/g, '').trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value) && value.length === 1) return str(value[0]);
  return undefined;
}

function num(value: unknown): number | undefined {
  if (Array.isArray(value)) return num(value[0]);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** XMP text fields come back as a string, `{ value, lang }`, or a language map. */
function langText(value: unknown): string | undefined {
  if (typeof value === 'string') return str(value);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('value' in obj) return str(obj.value);
    return str(obj['x-default']) ?? str(Object.values(obj)[0]);
  }
  return undefined;
}

/** "2026:08:14 13:05:22" -> "2026-08-14T13:05:22". Kept timezone-free on purpose. */
export function normalizeExifDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m || m[1] === '0000') return undefined;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

const CORPORATE_SUFFIX = /\s*(corporation|corp\.?|co\.?,?\s*ltd\.?|imaging|optical|company|inc\.?)\s*$/i;

/** Make "Canon" + model "Canon EOS R6" -> "Canon EOS R6"; "NIKON CORPORATION" + "Z 6" -> "NIKON Z 6". */
export function formatCamera(make?: string, model?: string): string | undefined {
  const cleanMake = make?.replace(CORPORATE_SUFFIX, '').trim();
  if (!model) return cleanMake || undefined;
  if (!cleanMake || model.toLowerCase().startsWith(cleanMake.toLowerCase())) return model;
  return `${cleanMake} ${model}`;
}

export function formatShutter(seconds: number): string {
  if (seconds >= 1) return `${Math.round(seconds * 10) / 10} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

export function formatAperture(f: number): string {
  return `ƒ/${Number(f.toFixed(1))}`;
}

export function formatFocal(mm: number): string {
  return `${Math.round(mm)} mm`;
}

/** "2026-08-14T13:05:22" -> "14 Aug 2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-08-14..." -> "Aug 2026". */
export function formatMonth(iso: string): string {
  const [y, m] = iso.slice(0, 7).split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** The rows shown on the photo page, skipping anything the file didn't record. */
export function exifRows(exif: ExifInfo): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (exif.camera) rows.push({ label: 'Camera', value: exif.camera });
  if (exif.lens) rows.push({ label: 'Lens', value: exif.lens });
  if (exif.focalLength) rows.push({ label: 'Focal length', value: formatFocal(exif.focalLength) });
  if (exif.aperture) rows.push({ label: 'Aperture', value: formatAperture(exif.aperture) });
  if (exif.exposureTime) rows.push({ label: 'Shutter', value: formatShutter(exif.exposureTime) });
  if (exif.iso) rows.push({ label: 'ISO', value: String(exif.iso) });
  if (exif.takenAt) rows.push({ label: 'Taken', value: formatDate(exif.takenAt) });
  return rows;
}
