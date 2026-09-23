import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AMBIENT_THEME_ORDER,
  AMBIENT_THEMES,
  bedAfter,
  DEFAULT_AMBIENT_THEME,
  findBed,
} from '../beds';

interface LedgerRow {
  theme: string;
  index: number;
  slug: string;
  title: string;
  file: string;
  sourceSha256: string;
  durationMs: number;
  bytes: number;
  lufs: number;
  truePeakDb: number;
}

const LEDGER_PATH = resolve(__dirname, '../../../../assets/audio/ambient/beds.json');
const ledger: LedgerRow[] = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));

// vitest resolves `require()` natively and would parse the Opus bytes as JS;
// Metro hands back an asset id, so stand in one per *ledger* slug — a registry
// slug the ledger doesn't know then has `source === undefined` and fails below.
vi.mock('../sources', async () => {
  // Hoisted above the imports: resolve the ledger path here, not via LEDGER_PATH.
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const file = nodePath.resolve(__dirname, '../../../../assets/audio/ambient/beds.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as { slug: string }[];
  return { AMBIENT_BED_SOURCES: Object.fromEntries(rows.map((r, i) => [r.slug, i + 1])) };
});

describe('AMBIENT_THEMES invariants', () => {
  it('lists every theme once, in the Settings order, with the horror default first', () => {
    expect(AMBIENT_THEME_ORDER).toEqual(['horror', 'news', 'comedy', 'action', 'education']);
    expect(new Set(AMBIENT_THEME_ORDER).size).toBe(AMBIENT_THEME_ORDER.length);
    expect(Object.keys(AMBIENT_THEMES).sort()).toEqual([...AMBIENT_THEME_ORDER].sort());
    expect(AMBIENT_THEME_ORDER[0]).toBe(DEFAULT_AMBIENT_THEME);
  });

  it('has the brief’s bed counts (1/2/2/2/4), ids matching keys, and non-empty labels', () => {
    expect(AMBIENT_THEME_ORDER.map((id) => AMBIENT_THEMES[id].beds.length)).toEqual([
      1, 2, 2, 2, 4,
    ]);
    for (const id of AMBIENT_THEME_ORDER) {
      const theme = AMBIENT_THEMES[id];
      expect(theme.id).toBe(id);
      expect(theme.label.en.length).toBeGreaterThan(0);
      expect(theme.label.ru.length).toBeGreaterThan(0);
      for (const bed of theme.beds) {
        expect(bed.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(bed.title.length).toBeGreaterThan(0);
        expect(bed.durationMs).toBeGreaterThan(0);
        expect(bed.source).toBeDefined();
      }
    }
  });

  it('keeps slugs unique across all themes (they are the persisted cursor keys)', () => {
    const slugs = AMBIENT_THEME_ORDER.flatMap((id) => AMBIENT_THEMES[id].beds.map((b) => b.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('registry ⇄ beds.json ledger', () => {
  it('registers exactly the ledger rows, per theme, in ledger order', () => {
    for (const id of AMBIENT_THEME_ORDER) {
      const rows = ledger.filter((r) => r.theme === id).sort((a, b) => a.index - b.index);
      expect(rows.map((r) => r.index)).toEqual(rows.map((_, i) => i + 1));
      expect(AMBIENT_THEMES[id].beds.map((b) => b.slug)).toEqual(rows.map((r) => r.slug));
    }
    expect(new Set(ledger.map((r) => r.theme))).toEqual(new Set(AMBIENT_THEME_ORDER));
  });

  it.each(ledger.map((r) => [r.file, r] as const))('%s matches its registry bed', (_file, row) => {
    const bed = findBed(row.theme as (typeof AMBIENT_THEME_ORDER)[number], row.slug);
    expect(bed).toBeDefined();
    expect(bed!.title).toBe(row.title);
    expect(Math.abs(bed!.durationMs - row.durationMs)).toBeLessThanOrEqual(50);
    expect(row.file).toBe(`${row.theme}/${String(row.index).padStart(2, '0')}-${row.slug}.opus`);
    expect(row.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.bytes).toBeGreaterThan(0);
  });

  it('ledger beds sit at the encode spec: −26 ± 1 LUFS, true peak ≤ −2 dBTP', () => {
    for (const row of ledger) {
      expect(Math.abs(row.lufs - -26)).toBeLessThanOrEqual(1);
      expect(row.truePeakDb).toBeLessThanOrEqual(-2);
    }
  });
});

describe('rotation helpers', () => {
  it('findBed returns the bed by slug and undefined for a stale cursor', () => {
    expect(findBed('news', 'global-affairs-briefing-2')?.title).toBe('Global Affairs Briefing 2');
    expect(findBed('news', 'tactical-breach-1')).toBeUndefined();
    expect(findBed('horror', '')).toBeUndefined();
  });

  it('bedAfter walks the rotation, wraps, and falls back to the first bed', () => {
    const [mf1, mf2, lg1, lg2] = AMBIENT_THEMES.education.beds;
    expect(bedAfter('education', mf1!.slug)).toBe(mf2);
    expect(bedAfter('education', mf2!.slug)).toBe(lg1);
    expect(bedAfter('education', lg1!.slug)).toBe(lg2);
    expect(bedAfter('education', lg2!.slug)).toBe(mf1);
    expect(bedAfter('education', 'nope')).toBe(mf1);
    expect(bedAfter('horror', 'creepy-bg-music')).toBe(AMBIENT_THEMES.horror.beds[0]);
  });
});
