import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';

import {
  allowedEdits,
  charDistance,
  PRONUNCIATION_HARD_SCORE,
  PRONUNCIATION_PASS_SCORE,
  pronunciationScoreToRating,
  scoreAttempt,
  scoringTokens,
  wordsMatch,
} from '../scoring';

/** T12: the lenient alignment scoring pipeline (design §6). */

describe('scoringTokens', () => {
  it('normalizes, lowercases, folds ё and strips punctuation', () => {
    expect(scoringTokens('Всё хорошо, спасибо!')).toEqual(['все', 'хорошо', 'спасибо']);
  });

  it('keeps in-word hyphens («кто-то» is one word)', () => {
    expect(scoringTokens('Кто-то стучит')).toEqual(['кто-то', 'стучит']);
  });

  it('handles « » quoting and em-dashes from story sentences', () => {
    expect(scoringTokens('«Иди сюда» — сказал он.')).toEqual(['иди', 'сюда', 'сказал', 'он']);
  });

  it('returns empty for empty/punctuation-only input', () => {
    expect(scoringTokens('')).toEqual([]);
    expect(scoringTokens('… — !')).toEqual([]);
  });
});

describe('charDistance / allowedEdits / wordsMatch', () => {
  it('computes plain Levenshtein', () => {
    expect(charDistance('дом', 'дом')).toBe(0);
    expect(charDistance('дом', 'том')).toBe(1);
    expect(charDistance('стена', 'стенах')).toBe(1);
  });

  it('short words must be exact, longer words earn edit budget', () => {
    expect(allowedEdits(3)).toBe(0);
    expect(allowedEdits(5)).toBe(1);
    expect(allowedEdits(8)).toBe(2);
    expect(allowedEdits(12)).toBe(3);
  });

  it('tolerates an ending slip on a long word but not a different short word', () => {
    expect(wordsMatch('фотография', 'фотографии')).toBe(true);
    expect(wordsMatch('дом', 'том')).toBe(false);
  });
});

describe('scoreAttempt', () => {
  it('perfect attempt scores 100 with every word green', () => {
    const r = scoreAttempt('Я слышу стук в стене', 'я слышу стук в стене');
    expect(r.score).toBe(100);
    expect(r.words.every((w) => w.matched)).toBe(true);
  });

  it('is ё/е-, case- and punctuation-tolerant (comparison only)', () => {
    const r = scoreAttempt('Всё тихо.', 'все тихо');
    expect(r.score).toBe(100);
    // Display keeps the authored ё for the UI.
    expect(r.words[0]!.display).toBe('Всё');
  });

  it('a deliberately wrong word turns exactly that word red', () => {
    const r = scoreAttempt('Я слышу стук в стене', 'я слышу голос в стене');
    expect(r.words.map((w) => w.matched)).toEqual([true, true, false, true, true]);
    expect(r.words[2]!.heard).toBe('голос');
    expect(r.score).toBe(80);
  });

  it('missing words fail their slots without derailing the rest', () => {
    const r = scoreAttempt('Он открыл старую дверь', 'он открыл дверь');
    expect(r.matchedCount).toBe(3);
    const missed = r.words.find((w) => !w.matched)!;
    expect(missed.target).toBe('старую');
    expect(missed.heard).toBeNull();
  });

  it('extra transcript words never hurt the score', () => {
    const r = scoreAttempt('дом', 'ну дом да');
    expect(r.score).toBe(100);
  });

  it('empty transcript = zero, all red', () => {
    const r = scoreAttempt('Я слышу стук', '');
    expect(r.score).toBe(0);
    expect(r.words.every((w) => !w.matched)).toBe(true);
  });
});

describe('pronunciationScoreToRating (the T12 mapping recorded in the ticket)', () => {
  it('≥80 Good · 50–79 Hard · <50 Again · Easy never emitted', () => {
    expect(pronunciationScoreToRating(100)).toBe(Rating.Good);
    expect(pronunciationScoreToRating(PRONUNCIATION_PASS_SCORE)).toBe(Rating.Good);
    expect(pronunciationScoreToRating(PRONUNCIATION_PASS_SCORE - 1)).toBe(Rating.Hard);
    expect(pronunciationScoreToRating(PRONUNCIATION_HARD_SCORE)).toBe(Rating.Hard);
    expect(pronunciationScoreToRating(PRONUNCIATION_HARD_SCORE - 1)).toBe(Rating.Again);
    expect(pronunciationScoreToRating(0)).toBe(Rating.Again);
  });
});
