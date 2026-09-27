import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { BED_DUCK, findSceneBed, isKnownSceneBedSlug, SCENE_BED_SLUGS, SCENE_BEDS } from '../beds';

interface LedgerRow {
  slug: string;
  title: string;
  file: string;
  sourceSha256: string;
  durationMs: number;
  bytes: number;
  lufs: number;
  truePeakDb: number;
}

const LEDGER_PATH = resolve(__dirname, '../../../../../assets/audio/scene/beds.json');
const ledger: LedgerRow[] = existsSync(LEDGER_PATH)
  ? (JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as LedgerRow[])
  : [];

vi.mock('../bed-sources', async () => {
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const file = nodePath.resolve(__dirname, '../../../../../assets/audio/scene/beds.json');
  const rows = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { slug: string }[])
    : [];
  return { SCENE_BED_SOURCES: Object.fromEntries(rows.map((r, i) => [r.slug, i + 1])) };
});

describe('scene bed registry (§8.4)', () => {
  it('knows the six family rooms plus none', () => {
    expect(SCENE_BED_SLUGS).toEqual([
      'none',
      'studio',
      'clinic',
      'bank',
      'forecourt',
      'station',
      'night-shop',
    ]);
    expect(isKnownSceneBedSlug('studio')).toBe(true);
    expect(isKnownSceneBedSlug('disco')).toBe(false);
  });

  it('ducks to 35 %', () => {
    expect(BED_DUCK).toBe(0.35);
  });

  it('none, unknown, and not-yet-encoded slugs resolve to silence (undefined)', () => {
    expect(findSceneBed('none')).toBeUndefined();
    expect(findSceneBed('disco')).toBeUndefined();
    expect(findSceneBed(null)).toBeUndefined();
    expect(findSceneBed('')).toBeUndefined();
    for (const slug of SCENE_BED_SLUGS) {
      if (SCENE_BEDS.some((b) => b.slug === slug)) continue;
      expect(findSceneBed(slug), slug).toBeUndefined();
    }
  });

  it('every registered bed is a known slug (never none) with a source and a duration', () => {
    for (const bed of SCENE_BEDS) {
      expect(isKnownSceneBedSlug(bed.slug)).toBe(true);
      expect(bed.slug).not.toBe('none');
      expect(bed.durationMs).toBeGreaterThan(0);
      expect(bed.source).toBeDefined();
      expect(findSceneBed(bed.slug)).toBe(bed);
    }
    expect(new Set(SCENE_BEDS.map((b) => b.slug)).size).toBe(SCENE_BEDS.length);
  });
});

describe('registry ⇄ beds.json ledger', () => {
  it('registers exactly the ledger rows, in ledger order', () => {
    expect(SCENE_BEDS.map((b) => b.slug)).toEqual(ledger.map((r) => r.slug));
  });

  it.each(ledger.map((r) => [r.file, r] as const))('%s matches its registry bed', (_file, row) => {
    const bed = findSceneBed(row.slug);
    expect(bed).toBeDefined();
    expect(bed!.title).toBe(row.title);
    expect(Math.abs(bed!.durationMs - row.durationMs)).toBeLessThanOrEqual(50);
    expect(row.file).toBe(`${row.slug}.opus`);
    expect(row.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.bytes).toBeGreaterThan(0);
    // Loopable room tones: 45–90 s (§8.4).
    expect(row.durationMs).toBeGreaterThanOrEqual(45_000);
    expect(row.durationMs).toBeLessThanOrEqual(90_000);
  });

  it('ledger beds sit at the encode spec: −32 ± 1 LUFS, true peak ≤ −2 dBTP', () => {
    for (const row of ledger) {
      expect(Math.abs(row.lufs - -32)).toBeLessThanOrEqual(1);
      expect(row.truePeakDb).toBeLessThanOrEqual(-2);
    }
  });
});
