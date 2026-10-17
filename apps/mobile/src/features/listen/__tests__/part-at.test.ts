import { describe, expect, it } from 'vitest';

import { partAt } from '../part-at';

const segs = [
  { startMs: 0, endMs: 1000 },
  { startMs: 2200, endMs: 5000 },
  { startMs: 6200, endMs: 9000 },
];

describe('partAt', () => {
  it('exactly startMs belongs to that part', () => {
    expect(partAt(segs, 0)).toBe(0);
    expect(partAt(segs, 2200)).toBe(1);
    expect(partAt(segs, 6200)).toBe(2);
  });
  it('exactly endMs stays in the part; the gap belongs to the part before', () => {
    expect(partAt(segs, 1000)).toBe(0);
    expect(partAt(segs, 2199)).toBe(0);
    expect(partAt(segs, 5000)).toBe(1);
  });
  it('past the last end -> last index', () => {
    expect(partAt(segs, 9000)).toBe(2);
    expect(partAt(segs, 99999)).toBe(2);
  });
  it('before the first start -> 0; empty -> 0', () => {
    expect(partAt([{ startMs: 500, endMs: 900 }], 100)).toBe(0);
    expect(partAt([], 10)).toBe(0);
    expect(partAt(segs, -5)).toBe(0);
  });
});
