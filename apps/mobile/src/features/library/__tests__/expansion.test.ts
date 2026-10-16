import { describe, expect, it } from 'vitest';

import {
  MAX_EXPANSION_KEYS,
  bookKey,
  chapterKey,
  familyKey,
  packKey,
  sanitizeExpansion,
  sectionDataFor,
  summarizeStories,
  toggleKey,
} from '../expansion';

describe('key builders', () => {
  it('uses the exact persisted formats', () => {
    expect(packKey('a1-tall-dog-001')).toBe('pack:a1-tall-dog-001');
    expect(familyKey('tall-dog')).toBe('family:tall-dog');
    expect(bookKey('three-body', 2)).toBe('series:three-body:book:2');
    expect(chapterKey('three-body', 4)).toBe('series:three-body:chapter:4');
  });
});

describe('sanitizeExpansion', () => {
  it('reads a well-formed row', () => {
    expect(sanitizeExpansion({ v: 1, keys: ['pack:a', 'family:b'] })).toEqual([
      'pack:a',
      'family:b',
    ]);
  });

  it('heals malformed values to an empty list', () => {
    expect(sanitizeExpansion(null)).toEqual([]);
    expect(sanitizeExpansion('pack:a')).toEqual([]);
    expect(sanitizeExpansion({ v: 2, keys: ['pack:a'] })).toEqual([]);
    expect(sanitizeExpansion({ v: 1, keys: 'pack:a' })).toEqual([]);
    expect(sanitizeExpansion({ keys: ['pack:a'] })).toEqual([]);
  });

  it('treats a row with any non-string entry as malformed; unknown strings are kept', () => {
    expect(sanitizeExpansion({ v: 1, keys: ['pack:a', 7, null] })).toEqual([]);
    expect(sanitizeExpansion({ v: 1, keys: ['pack:a', 'series:x:book:9'] })).toEqual([
      'pack:a',
      'series:x:book:9',
    ]);
  });

  it('caps at 500 and keeps the newest', () => {
    const keys = Array.from({ length: MAX_EXPANSION_KEYS + 3 }, (_, i) => `pack:${i}`);
    const out = sanitizeExpansion({ v: 1, keys });
    expect(out).toHaveLength(MAX_EXPANSION_KEYS);
    expect(out[0]).toBe('pack:3');
    expect(out[out.length - 1]).toBe(`pack:${MAX_EXPANSION_KEYS + 2}`);
  });
});

describe('toggleKey', () => {
  it('appends an expanded key as the newest', () => {
    expect(toggleKey(['pack:a'], 'pack:b', true)).toEqual(['pack:a', 'pack:b']);
  });

  it('moves an existing key to the newest position instead of duplicating', () => {
    expect(toggleKey(['pack:a', 'pack:b'], 'pack:a', true)).toEqual(['pack:b', 'pack:a']);
  });

  it('removes the key when collapsing', () => {
    expect(toggleKey(['pack:a', 'pack:b'], 'pack:a', false)).toEqual(['pack:b']);
    expect(toggleKey(['pack:a'], 'pack:missing', false)).toEqual(['pack:a']);
  });

  it('caps on append, keeping the newest', () => {
    const full = Array.from({ length: MAX_EXPANSION_KEYS }, (_, i) => `pack:${i}`);
    const next = toggleKey(full, 'pack:new', true);
    expect(next).toHaveLength(MAX_EXPANSION_KEYS);
    expect(next[next.length - 1]).toBe('pack:new');
    expect(next[0]).toBe('pack:1');
  });
});

describe('sectionDataFor', () => {
  const rows = [{ id: 1 }, { id: 2 }];

  it('returns no rows for a collapsed section', () => {
    expect(sectionDataFor('pack:a', rows, new Set())).toEqual([]);
  });

  it('returns the same array identity when expanded', () => {
    expect(sectionDataFor('pack:a', rows, new Set(['pack:a']))).toBe(rows);
  });
});

describe('summarizeStories', () => {
  it('counts finished over total', () => {
    expect(summarizeStories([{ finished: true }, { finished: false }, { finished: true }])).toEqual({
      finished: 2,
      total: 3,
    });
  });

  it('is zero for no stories', () => {
    expect(summarizeStories([])).toEqual({ finished: 0, total: 0 });
  });
});
