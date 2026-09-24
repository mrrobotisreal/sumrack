import { describe, expect, it, vi } from 'vitest';

import { AMBIENT_THEMES } from '../beds';
import { END_SKIP_MS, nextStart, parseAmbientCursors } from '../cursors';

vi.mock('../sources', async () => {
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const file = nodePath.resolve(__dirname, '../../../../assets/audio/ambient/beds.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as { slug: string }[];
  return { AMBIENT_BED_SOURCES: Object.fromEntries(rows.map((r, i) => [r.slug, i + 1])) };
});

const GA1 = AMBIENT_THEMES.news.beds[0]!;
const GA2 = AMBIENT_THEMES.news.beds[1]!;

describe('parseAmbientCursors', () => {
  it('returns an empty map for anything that is not an object', () => {
    expect(parseAmbientCursors(null)).toEqual({});
    expect(parseAmbientCursors(undefined)).toEqual({});
    expect(parseAmbientCursors('news')).toEqual({});
    expect(parseAmbientCursors([1])).toEqual({});
    expect(parseAmbientCursors(42)).toEqual({});
  });

  it('keeps valid entries and drops unknown themes and slugs', () => {
    expect(
      parseAmbientCursors({
        news: { bed: GA2.slug, positionMs: 40_000 },
        comedy: { bed: 'not-a-bed', positionMs: 5 },
        thriller: { bed: 'tactical-breach-1', positionMs: 5 },
        horror: 'creepy-bg-music',
        action: { bed: 7, positionMs: 5 },
      }),
    ).toEqual({ news: { bed: GA2.slug, positionMs: 40_000 } });
  });

  it('normalises positions: NaN/negative/non-number → 0, past the end → duration, fractions rounded', () => {
    expect(parseAmbientCursors({ news: { bed: GA1.slug, positionMs: NaN } }).news).toEqual({
      bed: GA1.slug,
      positionMs: 0,
    });
    expect(parseAmbientCursors({ news: { bed: GA1.slug, positionMs: -9 } }).news?.positionMs).toBe(
      0,
    );
    expect(parseAmbientCursors({ news: { bed: GA1.slug } }).news?.positionMs).toBe(0);
    expect(
      parseAmbientCursors({ news: { bed: GA1.slug, positionMs: '12' } }).news?.positionMs,
    ).toBe(0);
    expect(
      parseAmbientCursors({ news: { bed: GA1.slug, positionMs: 10_000_000 } }).news?.positionMs,
    ).toBe(GA1.durationMs);
    expect(
      parseAmbientCursors({ news: { bed: GA1.slug, positionMs: 1234.6 } }).news?.positionMs,
    ).toBe(1235);
  });
});

describe('nextStart', () => {
  it('starts bed 1 at 0 without a cursor', () => {
    expect(nextStart('news', undefined)).toEqual({ bed: GA1, positionMs: 0 });
    expect(nextStart('horror', undefined)).toEqual({
      bed: AMBIENT_THEMES.horror.beds[0],
      positionMs: 0,
    });
  });

  it('resumes exactly where the cursor points', () => {
    expect(nextStart('news', { bed: GA2.slug, positionMs: 40_000 })).toEqual({
      bed: GA2,
      positionMs: 40_000,
    });
  });

  it('skips to the next bed (wrapping) inside the last five seconds', () => {
    const edge = GA1.durationMs - END_SKIP_MS;
    expect(nextStart('news', { bed: GA1.slug, positionMs: edge - 1 })).toEqual({
      bed: GA1,
      positionMs: edge - 1,
    });
    expect(nextStart('news', { bed: GA1.slug, positionMs: edge })).toEqual({
      bed: GA2,
      positionMs: 0,
    });
    expect(nextStart('news', { bed: GA2.slug, positionMs: GA2.durationMs })).toEqual({
      bed: GA1,
      positionMs: 0,
    });
    // A single-bed theme "wraps" onto itself from 0.
    const creepy = AMBIENT_THEMES.horror.beds[0]!;
    expect(nextStart('horror', { bed: creepy.slug, positionMs: creepy.durationMs - 100 })).toEqual({
      bed: creepy,
      positionMs: 0,
    });
  });

  it('falls back to bed 1 for a stale slug and clamps an out-of-range position', () => {
    expect(nextStart('news', { bed: 'gone', positionMs: 5 })).toEqual({ bed: GA1, positionMs: 0 });
    expect(nextStart('news', { bed: GA2.slug, positionMs: -5 })).toEqual({
      bed: GA2,
      positionMs: 0,
    });
  });
});
