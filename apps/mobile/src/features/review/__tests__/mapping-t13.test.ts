import { describe, expect, it } from 'vitest';

import { Rating } from '@/db/repositories/reviews';

import {
  CLOZE_TILE_FAST_THRESHOLD_MS,
  clozeOutcomeToRating,
  sbFastThresholdMs,
  sbOutcomeToRating,
} from '../mapping';

/** T13: outcome→FSRS mappings for cloze and sentence builder. */

describe('clozeOutcomeToRating', () => {
  it('typed: correct-no-hint = Good, any hint caps at Hard, reveal/wrong = Again', () => {
    const base = {
      variant: 'typed' as const,
      correct: true,
      hintsUsed: 0,
      revealed: false,
      durationMs: 5000,
    };
    expect(clozeOutcomeToRating(base)).toBe(Rating.Good);
    expect(clozeOutcomeToRating({ ...base, hintsUsed: 1 })).toBe(Rating.Hard);
    expect(clozeOutcomeToRating({ ...base, hintsUsed: 2 })).toBe(Rating.Hard);
    expect(clozeOutcomeToRating({ ...base, revealed: true })).toBe(Rating.Again);
    expect(clozeOutcomeToRating({ ...base, correct: false })).toBe(Rating.Again);
  });

  it('tiles: fast = Good, slow = Hard, wrong = Again; never Easy', () => {
    const base = {
      variant: 'tiles' as const,
      correct: true,
      hintsUsed: 0,
      revealed: false,
      durationMs: 0,
    };
    expect(clozeOutcomeToRating({ ...base, durationMs: CLOZE_TILE_FAST_THRESHOLD_MS })).toBe(
      Rating.Good,
    );
    expect(clozeOutcomeToRating({ ...base, durationMs: CLOZE_TILE_FAST_THRESHOLD_MS + 1 })).toBe(
      Rating.Hard,
    );
    expect(clozeOutcomeToRating({ ...base, correct: false })).toBe(Rating.Again);
  });
});

describe('sbOutcomeToRating', () => {
  it('threshold scales with word count, floor 10s', () => {
    expect(sbFastThresholdMs(2)).toBe(10_000);
    expect(sbFastThresholdMs(8)).toBe(20_000);
  });

  it('correct-fast = Good, take-backs or slow = Hard, wrong = Again', () => {
    const base = { correct: true, removals: 0, wordCount: 4, durationMs: 9000 };
    expect(sbOutcomeToRating(base)).toBe(Rating.Good);
    expect(sbOutcomeToRating({ ...base, removals: 1 })).toBe(Rating.Hard);
    expect(sbOutcomeToRating({ ...base, durationMs: sbFastThresholdMs(4) + 1 })).toBe(Rating.Hard);
    expect(sbOutcomeToRating({ ...base, correct: false, removals: 0 })).toBe(Rating.Again);
  });
});
