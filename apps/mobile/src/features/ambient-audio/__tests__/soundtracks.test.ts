import { describe, expect, it, vi } from 'vitest';

import { AMBIENT_THEME_ORDER } from '../beds';
import { nextStart } from '../cursors';
import { DEFAULT_AMBIENT_PREFS } from '../preferences';
import {
  formatClock,
  formatTrackCount,
  previewDisabledReason,
  SOUNDTRACK_ICONS,
  themeDurationMs,
} from '../soundtracks';

vi.mock('../sources', async () => {
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const file = nodePath.resolve(__dirname, '../../../../assets/audio/ambient/beds.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as { slug: string }[];
  return { AMBIENT_BED_SOURCES: Object.fromEntries(rows.map((r, i) => [r.slug, i + 1])) };
});

describe('formatClock', () => {
  it('renders m:ss rounded to the nearest second', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(999)).toBe('0:01');
    expect(formatClock(59_400)).toBe('0:59');
    expect(formatClock(800_007)).toBe('13:20');
    expect(formatClock(1_601_988)).toBe('26:42');
  });

  it('never goes negative or NaN', () => {
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
  });
});

describe('formatTrackCount', () => {
  it('pluralises', () => {
    expect(formatTrackCount(1)).toBe('1 track');
    expect(formatTrackCount(2)).toBe('2 tracks');
    expect(formatTrackCount(4)).toBe('4 tracks');
  });
});

describe('themeDurationMs — the Settings captions', () => {
  it('matches the ticket per theme', () => {
    const rows = AMBIENT_THEME_ORDER.map((theme) => formatClock(themeDurationMs(theme)));
    expect(rows).toEqual(['13:20', '3:12', '2:30', '5:29', '26:42']);
  });

  it('has an icon for every theme in order', () => {
    expect(AMBIENT_THEME_ORDER.map((theme) => SOUNDTRACK_ICONS[theme])).toEqual([
      'skull-outline',
      'newspaper-outline',
      'happy-outline',
      'flash-outline',
      'school-outline',
    ]);
  });
});

describe('«Up next» after a reset', () => {
  it('is bed 1 at 0:00 when the theme has no cursor', () => {
    const start = nextStart('education', undefined);
    expect(start.bed.slug).toBe('mechanical-focus-1');
    expect(formatClock(start.positionMs)).toBe('0:00');
  });
});

describe('previewDisabledReason', () => {
  it('allows a preview with the defaults', () => {
    expect(previewDisabledReason(DEFAULT_AMBIENT_PREFS, false)).toBeNull();
    expect(previewDisabledReason(DEFAULT_AMBIENT_PREFS, true)).toBeNull();
  });

  it('explains ambience off and zero volume', () => {
    expect(previewDisabledReason({ ...DEFAULT_AMBIENT_PREFS, enabled: false }, false)).toMatch(
      /Turn on study ambience/,
    );
    expect(previewDisabledReason({ ...DEFAULT_AMBIENT_PREFS, volume: 0 }, false)).toMatch(
      /music volume/,
    );
  });

  it('explains a narration block only when narration is live and the mix is off', () => {
    const prefs = { ...DEFAULT_AMBIENT_PREFS, playDuringNarration: false };
    expect(previewDisabledReason(prefs, false)).toBeNull();
    expect(previewDisabledReason(prefs, true)).toMatch(/Pause narration/);
  });
});
