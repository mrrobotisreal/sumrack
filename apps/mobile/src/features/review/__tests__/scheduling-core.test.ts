import { describe, expect, it } from 'vitest';

import { DEFAULT_W, type StoredFsrsParams } from '../fsrs-settings';
import {
  buildReviewLogExport,
  exportResultMessage,
  formatOptimizerSubtitle,
  formatRetentionPercent,
  formatWeights,
  isBuried,
  REVIEW_LOG_KIND,
  retentionIsDefault,
  reviewLogFileName,
} from '../scheduling-core';

const params = (over: Partial<StoredFsrsParams> = {}): StoredFsrsParams => ({
  v: 1,
  w: [...DEFAULT_W],
  fittedAt: '2026-10-09T10:00:00.000Z',
  importedAt: 1,
  reviewCount: 1234,
  cardCount: 321,
  ...over,
});

describe('formatOptimizerSubtitle', () => {
  it('shows the default line when no params are stored', () => {
    expect(formatOptimizerSubtitle(null)).toBe('Default parameters (FSRS-6)');
  });
  it('shows the fit date (YYYY-MM-DD) and review count', () => {
    expect(formatOptimizerSubtitle(params())).toBe('Optimized · 2026-10-09 · 1234 reviews');
  });
});

describe('retention copy', () => {
  it('formats as a whole percent', () => {
    expect(formatRetentionPercent(0.9)).toBe('90 %');
    expect(formatRetentionPercent(0.85)).toBe('85 %');
    expect(formatRetentionPercent(0.8)).toBe('80 %');
  });
  it('knows when the value is the default', () => {
    expect(retentionIsDefault(0.9)).toBe(true);
    expect(retentionIsDefault(0.91)).toBe(false);
  });
});

describe('formatWeights', () => {
  it('prints 21 numbers, 2 decimals, in rows of 7', () => {
    const out = formatWeights(DEFAULT_W);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    const all = out.trim().split(/\s+/);
    expect(all).toHaveLength(21);
    for (const token of all) expect(token).toMatch(/^-?\d+\.\d{2}$/);
  });
});

describe('buildReviewLogExport', () => {
  const rows = [
    {
      cardId: 'c1',
      direction: 'ru-en',
      rating: 3,
      state: 2,
      reviewedAt: 1000,
      durationMs: 4200,
    },
    {
      cardId: 'c2',
      direction: 'listening',
      rating: 1,
      state: 1,
      reviewedAt: 2000,
      durationMs: null,
    },
  ];

  it('writes the documented envelope with exactly the six columns', () => {
    const now = new Date('2026-10-09T12:00:00.000Z');
    const out = buildReviewLogExport(rows, now, 'America/Denver');
    expect(out).toEqual({
      v: 1,
      kind: REVIEW_LOG_KIND,
      exportedAt: '2026-10-09T12:00:00.000Z',
      timezone: 'America/Denver',
      rows,
    });
    expect(Object.keys(out.rows[0]!).sort()).toEqual(
      ['cardId', 'direction', 'durationMs', 'rating', 'reviewedAt', 'state'].sort(),
    );
  });

  it('keeps a null duration as null', () => {
    const out = buildReviewLogExport(rows, new Date(0), 'UTC');
    expect(out.rows[1]!.durationMs).toBeNull();
  });

  it('exports an empty history as zero rows', () => {
    expect(buildReviewLogExport([], new Date(0), 'UTC').rows).toEqual([]);
  });
});

describe('reviewLogFileName', () => {
  it('uses the local calendar date', () => {
    expect(reviewLogFileName(new Date(2026, 0, 5, 9, 30))).toBe(
      'sumrak-review-log-2026-01-05.json',
    );
  });
});

describe('exportResultMessage', () => {
  it('pluralises', () => {
    expect(exportResultMessage(1, 'a.json')).toBe('Saved 1 review to a.json');
    expect(exportResultMessage(3, 'a.json')).toBe('Saved 3 reviews to a.json');
  });
});

describe('isBuried', () => {
  it('is buried only while buriedUntil is in the future', () => {
    expect(isBuried(null, 1)).toBe(false);
    expect(isBuried(undefined, 1)).toBe(false);
    expect(isBuried(10, 5)).toBe(true);
    expect(isBuried(5, 10)).toBe(false);
  });
});
