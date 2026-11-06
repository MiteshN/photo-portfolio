import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  exifRows,
  formatAperture,
  formatCamera,
  formatDate,
  formatShutter,
  normalizeExifDate,
  readExif,
} from '../src/lib/exif.ts';

describe('formatting', () => {
  it('formats shutter speeds', () => {
    expect(formatShutter(0.004)).toBe('1/250 s');
    expect(formatShutter(1 / 60)).toBe('1/60 s');
    expect(formatShutter(2)).toBe('2 s');
    expect(formatShutter(1.3)).toBe('1.3 s');
  });

  it('formats apertures', () => {
    expect(formatAperture(2.8)).toBe('ƒ/2.8');
    expect(formatAperture(8)).toBe('ƒ/8');
    expect(formatAperture(1.4000001)).toBe('ƒ/1.4');
  });

  it('avoids repeating the brand in camera names', () => {
    expect(formatCamera('Canon', 'Canon EOS R6')).toBe('Canon EOS R6');
    expect(formatCamera('NIKON CORPORATION', 'NIKON Z 6')).toBe('NIKON Z 6');
    expect(formatCamera('FUJIFILM', 'X-T5')).toBe('FUJIFILM X-T5');
    expect(formatCamera('SONY', undefined)).toBe('SONY');
    expect(formatCamera(undefined, undefined)).toBeUndefined();
  });

  it('keeps capture dates timezone-free', () => {
    expect(normalizeExifDate('2026:08:14 13:05:22')).toBe('2026-08-14T13:05:22');
    expect(normalizeExifDate('2026:08:14')).toBe('2026-08-14T00:00:00');
    expect(normalizeExifDate('0000:00:00 00:00:00')).toBeUndefined();
    expect(normalizeExifDate('garbage')).toBeUndefined();
    expect(formatDate('2026-08-14T13:05:22')).toBe('14 Aug 2026');
  });

  it('only lists rows the photo has', () => {
    expect(exifRows({ aperture: 2, iso: 400 })).toEqual([
      { label: 'Aperture', value: 'ƒ/2' },
      { label: 'ISO', value: '400' },
    ]);
  });
});

describe('readExif', () => {
  it('reads camera details and the caption from a real file', async () => {
    const { exif, text } = await readExif(await readFile('sample-photos/01 Coast/still-water.jpg'));
    expect(exif).toEqual({
      camera: 'Sample Camera X1',
      lens: 'Sample 23mm F1.4',
      focalLength: 23,
      aperture: 2,
      exposureTime: 1 / 60,
      iso: 800,
      takenAt: '2026-08-14T20:41:09',
    });
    expect(text.caption).toBe('Waiting for the last of the light.');
  });

  it('never returns GPS, even when the file has it', async () => {
    const { exif } = await readExif(await readFile('sample-photos/01 Coast/sunny-shoreline.jpg'));
    expect(JSON.stringify(exif)).not.toMatch(/lat|lon|gps/i);
  });

  it('copes with files that have no EXIF', async () => {
    expect(await readExif(Buffer.from('not an image'))).toEqual({ exif: {}, text: {} });
  });
});
