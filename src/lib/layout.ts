import type { Orientation } from './types.ts';

/**
 * Turns a list of photos into magazine-style rows on a 12-column grid, picking a
 * row pattern from the shapes of the next few photos. It's deterministic, so the
 * same photos always give the same layout, and every photo is placed exactly once.
 */

export interface Slot<T> {
  item: T;
  /** CSS grid-column value, e.g. "1 / span 5". */
  column: string;
  /** Push this item down for a staggered look (desktop only). */
  offset: boolean;
}

export interface Row<T> {
  pattern: string;
  slots: Slot<T>[];
}

type Shape = 'L' | 'P';

const shapeOf = (o: Orientation): Shape => (o === 'landscape' ? 'L' : 'P');

/** [start column, span, offset] per item, for each pattern. Mirrored on alternate rows. */
const PATTERNS: Record<string, [number, number, boolean][]> = {
  PPP: [[1, 4, false], [5, 4, true], [9, 4, false]],
  PL: [[1, 5, false], [7, 6, true]],
  LP: [[1, 7, false], [9, 4, true]],
  LL: [[1, 7, false], [9, 4, true]],
  PP: [[2, 4, false], [7, 5, true]],
  L: [[2, 10, false]],
  P: [[4, 6, false]],
};

/** Every fourth row, a lone landscape gets the full-width "feature" treatment. */
const FEATURE_EVERY = 4;

export function buildRows<T>(items: T[], orientationOf: (item: T) => Orientation): Row<T>[] {
  const rows: Row<T>[] = [];
  let i = 0;
  while (i < items.length) {
    const shapes = items.slice(i, i + 3).map((it) => shapeOf(orientationOf(it)));
    const rowIndex = rows.length;
    let pattern: string;
    if (rowIndex % FEATURE_EVERY === FEATURE_EVERY - 1 && shapes[0] === 'L') pattern = 'L';
    else if (shapes.length === 3 && shapes.every((s) => s === 'P')) pattern = 'PPP';
    else if (shapes.length >= 2) pattern = shapes[0] + shapes[1];
    else pattern = shapes[0];

    const spec = PATTERNS[pattern];
    const mirror = rowIndex % 2 === 1 && spec.length > 1 && pattern !== 'PPP';
    const slots = spec.map(([start, span, offset], k) => ({
      item: items[i + k],
      column: `${mirror ? 13 - start - span + 1 : start} / span ${span}`,
      offset,
    }));
    if (mirror) slots.reverse();
    rows.push({ pattern, slots });
    i += spec.length;
  }
  return rows;
}
