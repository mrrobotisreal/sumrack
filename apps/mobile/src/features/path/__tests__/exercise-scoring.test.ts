import { describe, expect, it } from 'vitest';

import { passes, scoreOutcomes, typedTextMatches, type SpecOutcome } from '../exercises/scoring';

/** T17: test scoring — skipped items leave the denominator; typed matching tolerance. */

const outcome = (correct: boolean, skipped = false): SpecOutcome => ({
  specId: 'x',
  kind: 'multiple-choice',
  correct,
  skipped,
  durationMs: 1000,
});

describe('scoreOutcomes', () => {
  it('computes percent over scorable items only', () => {
    const score = scoreOutcomes([
      outcome(true),
      outcome(true),
      outcome(false),
      outcome(false, true), // skipped pronunciation — excluded
    ]);
    expect(score.scored).toBe(3);
    expect(score.skipped).toBe(1);
    expect(score.correct).toBe(2);
    expect(score.scorePercent).toBeCloseTo(66.7, 1);
  });

  it('applies the threshold at exactly the boundary', () => {
    const eighty = scoreOutcomes([
      outcome(true),
      outcome(true),
      outcome(true),
      outcome(true),
      outcome(false),
    ]);
    expect(eighty.scorePercent).toBe(80);
    expect(passes(eighty, 0.8)).toBe(true);
    expect(passes(eighty, 0.9)).toBe(false);
  });

  it('an all-skipped test never passes', () => {
    const score = scoreOutcomes([outcome(false, true), outcome(false, true)]);
    expect(score.scorePercent).toBe(0);
    expect(passes(score, 0.8)).toBe(false);
  });
});

describe('typedTextMatches', () => {
  it('ignores punctuation, case, ё and extra whitespace', () => {
    expect(typedTextMatches('Кто там?', 'кто там')).toBe(true);
    expect(typedTextMatches('В комнате очень тихо.', 'в  комнате очень тихо')).toBe(true);
    expect(typedTextMatches('Всё хорошо.', 'все хорошо')).toBe(true);
  });

  it('keeps in-word hyphens significant and rejects real differences', () => {
    expect(typedTextMatches('Кто-то стоит.', 'кто-то стоит')).toBe(true);
    expect(typedTextMatches('Кто там?', 'что там')).toBe(false);
    // No edit-distance leniency for typed input (T13 rule).
    expect(typedTextMatches('тихо', 'тихом')).toBe(false);
  });
});
