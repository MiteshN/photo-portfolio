/** Naming helpers: folder and file names in, URL slugs and display titles out. */

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * "01 Coast" -> { order: 1, title: "Coast" }. A leading number sets the album order,
 * so renaming folders on the share is all it takes to reorder them.
 */
export function parseFolderName(name: string): { order: number | null; title: string } {
  const match = /^(\d+)[\s._-]+(.+)$/.exec(name.trim());
  if (match) return { order: Number(match[1]), title: match[2].trim() };
  return { order: null, title: name.trim() };
}

/** "moon-over_still-water.jpg" -> "Moon over still water". */
export function titleFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  const words = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return 'Untitled';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Returns `base`, or `base-2`, `base-3`... whichever is free, and records it as used. */
export function uniqueSlug(base: string, used: Set<string>, fallback = 'photo'): string {
  const root = base || fallback;
  let slug = root;
  for (let n = 2; used.has(slug); n++) slug = `${root}-${n}`;
  used.add(slug);
  return slug;
}
