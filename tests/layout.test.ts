import { describe, expect, it } from 'vitest';
import { buildRows } from '../src/lib/layout.ts';
import type { Orientation } from '../src/lib/types.ts';

const shapes: Record<string, Orientation> = { L: 'landscape', P: 'portrait', S: 'square' };
const make = (pattern: string) => pattern.split('').map((c, i) => ({ id: i, o: shapes[c] }));

function columns(column: string): [number, number] {
  const m = /^(\d+) \/ span (\d+)$/.exec(column);
  if (!m) throw new Error(`bad column ${column}`);
  return [Number(m[1]), Number(m[1]) + Number(m[2]) - 1];
}

describe('buildRows', () => {
  const cases = ['', 'L', 'P', 'LL', 'PPP', 'LPLPLPLP', 'PPPPPPP', 'LLLLLLLLL', 'SLPSSPLLPPLS', 'PLLPPPLPLLLLPP'];

  it.each(cases)('places every photo exactly once (%s)', (pattern) => {
    const items = make(pattern);
    const rows = buildRows(items, (it) => it.o);
    const placed = rows.flatMap((r) => r.slots.map((s) => s.item.id)).sort((a, b) => a - b);
    expect(placed).toEqual(items.map((it) => it.id));
  });

  it.each(cases)('keeps slots inside the grid without overlapping (%s)', (pattern) => {
    for (const row of buildRows(make(pattern), (it) => it.o)) {
      const spans = row.slots.map((s) => columns(s.column)).sort((a, b) => a[0] - b[0]);
      for (const [start, end] of spans) {
        expect(start).toBeGreaterThanOrEqual(1);
        expect(end).toBeLessThanOrEqual(12);
      }
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
    }
  });

  it('lists slots left to right, even on mirrored rows', () => {
    for (const row of buildRows(make('PLPLPLPL'), (it) => it.o)) {
      const starts = row.slots.map((s) => columns(s.column)[0]);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    }
  });

  it('is deterministic', () => {
    const items = make('PLLPPPLPLLLLPP');
    expect(buildRows(items, (it) => it.o)).toEqual(buildRows(items, (it) => it.o));
  });
});
