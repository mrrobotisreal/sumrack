import { describe, expect, it } from 'vitest';

import { answersMatch, foldForAnswer } from '../text';

/** T13: the shared tolerant comparator typed cloze (and future typed modes) use. */

describe('foldForAnswer', () => {
  it('lowercases and NFC-normalizes', () => {
    expect(foldForAnswer('СЛОВО')).toBe('слово');
    // decomposed е + combining diaeresis (ё in NFD) folds like composed ё
    expect(foldForAnswer('ещё'.normalize('NFD'))).toBe('еще');
  });

  it('folds ё to е', () => {
    expect(foldForAnswer('ещё')).toBe('еще');
    expect(foldForAnswer('Ёлка')).toBe('елка');
  });

  it('strips stress accents without touching й', () => {
    expect(foldForAnswer('сло́во')).toBe('слово');
    expect(foldForAnswer('до̀ма')).toBe('дома');
    expect(foldForAnswer('чай')).toBe('чай');
  });

  it('collapses and trims whitespace', () => {
    expect(foldForAnswer('  в   доме ')).toBe('в доме');
  });
});

describe('answersMatch', () => {
  it('accepts е for ё in both directions (acceptance criterion)', () => {
    expect(answersMatch('ещё', 'еще')).toBe(true);
    expect(answersMatch('еще', 'ещё')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(answersMatch('Москва', 'москва')).toBe(true);
    expect(answersMatch('слово', 'СЛОВО')).toBe(true);
  });

  it('rejects genuinely different words — no edit-distance leniency for typing', () => {
    expect(answersMatch('слово', 'слова')).toBe(false);
    expect(answersMatch('дом', 'том')).toBe(false);
    expect(answersMatch('стена', '')).toBe(false);
  });
});
