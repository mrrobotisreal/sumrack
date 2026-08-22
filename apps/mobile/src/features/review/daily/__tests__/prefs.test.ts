import { describe, expect, it } from 'vitest';

import { DEFAULT_DAILY_PREFS, parseDailyPrefs, weightForMode } from '../prefs';

/** T14: stored daily-session prefs are Zod-validated on read, healing to defaults. */

describe('parseDailyPrefs', () => {
  it('accepts a valid stored value', () => {
    const stored = {
      length: 30,
      weights: { flashcard: 0, mc: 2, cloze: 1, sentenceBuilder: 3, listening: 5 },
    };
    expect(parseDailyPrefs(stored)).toEqual(stored);
  });

  it.each([
    ['null', null],
    ['garbage string', 'twenty'],
    ['missing weights', { length: 20 }],
    ['out-of-range length', { length: 500, weights: DEFAULT_DAILY_PREFS.weights }],
    ['out-of-range weight', { length: 20, weights: { ...DEFAULT_DAILY_PREFS.weights, mc: 9 } }],
    ['non-integer weight', { length: 20, weights: { ...DEFAULT_DAILY_PREFS.weights, mc: 1.5 } }],
    [
      'unknown key (strictObject)',
      { length: 20, weights: { ...DEFAULT_DAILY_PREFS.weights, bogus: 1 } },
    ],
  ])('falls back to defaults on %s', (_name, raw) => {
    expect(parseDailyPrefs(raw)).toEqual(DEFAULT_DAILY_PREFS);
  });
});

describe('weightForMode', () => {
  it('maps the kebab-case mode id to the camelCase stored key', () => {
    const weights = { flashcard: 1, mc: 2, cloze: 3, sentenceBuilder: 4, listening: 5 };
    expect(weightForMode(weights, 'sentence-builder')).toBe(4);
    expect(weightForMode(weights, 'flashcard')).toBe(1);
    expect(weightForMode(weights, 'listening')).toBe(5);
  });
});
