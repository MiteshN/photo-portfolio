import { describe, expect, it } from 'vitest';
import { parseFolderName, slugify, titleFromFilename, uniqueSlug } from '../src/lib/slug.ts';

describe('slugify', () => {
  it('makes URL-safe slugs', () => {
    expect(slugify('Night streets')).toBe('night-streets');
    expect(slugify('  Côte d’Azur — 2026! ')).toBe('cote-d-azur-2026');
    expect(slugify('無月')).toBe('');
  });
});

describe('parseFolderName', () => {
  it('reads a leading number as the order', () => {
    expect(parseFolderName('01 Coast')).toEqual({ order: 1, title: 'Coast' });
    expect(parseFolderName('12_Night streets')).toEqual({ order: 12, title: 'Night streets' });
    expect(parseFolderName('3-Fog')).toEqual({ order: 3, title: 'Fog' });
  });

  it('leaves plain names alone', () => {
    expect(parseFolderName('Coast')).toEqual({ order: null, title: 'Coast' });
    expect(parseFolderName('2026')).toEqual({ order: null, title: '2026' });
  });
});

describe('titleFromFilename', () => {
  it('turns file names into readable titles', () => {
    expect(titleFromFilename('moon-over_still-water.jpg')).toBe('Moon over still water');
    expect(titleFromFilename('DSCF1234.JPG')).toBe('DSCF1234');
    expect(titleFromFilename('.jpg')).toBe('Untitled');
  });
});

describe('uniqueSlug', () => {
  it('adds a number when a slug is taken', () => {
    const used = new Set<string>();
    expect(uniqueSlug('fog', used)).toBe('fog');
    expect(uniqueSlug('fog', used)).toBe('fog-2');
    expect(uniqueSlug('fog', used)).toBe('fog-3');
    expect(uniqueSlug('', used)).toBe('photo');
  });
});
