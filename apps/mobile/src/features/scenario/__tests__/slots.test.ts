import { describe, expect, it } from 'vitest';

import { scoringTokens } from '@/features/pronunciation/scoring';

import {
  contentTokens,
  coveredTokenIndexes,
  hasNumeral,
  isContentToken,
  isNumeralToken,
  isStopword,
  matchForm,
  matchForms,
  negationMismatch,
  parseRuNumber,
  RU_NUMERALS,
  STOP_RU,
  stemMatches,
} from '../judge/slots';

/** Slot primitives (T60, SPEAKING_SCENARIOS §5.1). */

describe('STOP_RU', () => {
  it('holds the §5.1 list (ё/е-folded) and never «из»', () => {
    for (const w of ['я', 'ты', 'и', 'это', 'не', 'что', 'очень', 'пожалуйста', 'спасибо', 'еще']) {
      expect(STOP_RU.has(w), w).toBe(true);
    }
    expect(isStopword('Ещё')).toBe(true);
    expect(STOP_RU.has('из')).toBe(false);
    expect(isContentToken('из')).toBe(true);
  });

  it('contentTokens strips stopwords, fillers and hesitation noises only', () => {
    expect(contentTokens(scoringTokens('Ну, э-э, я Митч, спасибо'))).toEqual(['митч']);
    expect(contentTokens(scoringTokens('очень хорошо'))).toEqual(['хорошо']);
    expect(contentTokens(scoringTokens('да нет ну вот'))).toEqual([]);
  });
});

describe('RU_NUMERALS', () => {
  it('covers 1–100: units, teens, tens, «сто», plus digits', () => {
    for (const w of ['один', 'пять', 'одиннадцать', 'двадцать', 'сорок', 'девяносто', 'сто']) {
      expect(isNumeralToken(w), w).toBe(true);
    }
    expect(RU_NUMERALS.get('двадцать')).toBe(20);
    expect(isNumeralToken('25')).toBe(true);
    expect(isNumeralToken('лет')).toBe(false);
  });

  it('is exact — a near-spelling never reads as a number', () => {
    expect(isNumeralToken('путь')).toBe(false); // «пять» ± 1 edit
    expect(isNumeralToken('семя')).toBe(false);
  });

  it('parses compounds and oblique forms', () => {
    expect(parseRuNumber(scoringTokens('двадцать пять лет'))).toBe(25);
    expect(parseRuNumber(scoringTokens('уже двух лет'))).toBe(2);
    expect(parseRuNumber(scoringTokens('сто'))).toBe(100);
    expect(parseRuNumber(scoringTokens('я тут 7 лет'))).toBe(7);
    expect(parseRuNumber(scoringTokens('давно'))).toBeNull();
    // «пять пять» is two numbers, not 10.
    expect(parseRuNumber(scoringTokens('пять пять'))).toBe(5);
  });

  it('hasNumeral sees a digit string or a numeral word anywhere', () => {
    expect(hasNumeral(scoringTokens('я учу русский три года'))).toBe(true);
    expect(hasNumeral(scoringTokens('давно'))).toBe(false);
  });
});

describe('stemMatches', () => {
  it('prefix hit, and the T12 edit budget applied to the stem («голава» → «голов*»)', () => {
    expect(stemMatches('голов', 'голова')).toBe(true);
    expect(stemMatches('голов', 'голава')).toBe(true); // 1 edit on a 5-char stem
    expect(stemMatches('голов', 'нога')).toBe(false);
  });

  it('short stems get no budget (≤ 3 chars)', () => {
    expect(stemMatches('игр', 'игры')).toBe(true);
    expect(stemMatches('игр', 'икра')).toBe(false);
  });

  it('a token a little shorter than the stem can still hit', () => {
    expect(stemMatches('чита', 'чит')).toBe(true); // budget 1 on a 4-char stem
    expect(stemMatches('программ', 'прог')).toBe(false);
  });
});

describe('matchForm / matchForms', () => {
  it('exact forms are tolerant, globs are stems', () => {
    expect(matchForm('колорадо', scoringTokens('я из колорадо'))).toEqual({
      at: 2,
      span: 1,
      form: 'колорадо',
    });
    expect(matchForm('америк*', scoringTokens('из америки'))?.at).toBe(1);
    expect(matchForm('колорадо', scoringTokens('из колорада'))).not.toBeNull(); // 1 edit
    expect(matchForm('сша', scoringTokens('из сшп'))).toBeNull(); // 3 chars: no budget
  });

  it('multi-word forms must be consecutive', () => {
    expect(matchForm('не очень', scoringTokens('ну не очень'))).toEqual({
      at: 1,
      span: 2,
      form: 'не очень',
    });
    expect(matchForm('не очень', scoringTokens('не так очень'))).toBeNull();
  });

  it('ё/е and case are folded on both sides', () => {
    expect(matchForm('шофёр*', scoringTokens('Я ШОФЕР'))).not.toBeNull();
  });

  it('matchForms prefers the longest span («не люблю» over «люблю»)', () => {
    const hit = matchForms(['люблю', 'не люблю'], scoringTokens('нет, не люблю'));
    expect(hit?.form).toBe('не люблю');
  });

  it('a leading «не» is never an edit («плохо» ≠ «неплохо», «давно» ≠ «недавно»)', () => {
    expect(negationMismatch('плохо', 'неплохо')).toBe(true);
    expect(negationMismatch('давно', 'недавно')).toBe(true);
    expect(negationMismatch('плохо', 'плохо')).toBe(false);
    expect(negationMismatch('недавно', 'недавна')).toBe(false);
    expect(matchForm('неплохо', scoringTokens('плохо'))).toBeNull();
    expect(matchForm('давно', scoringTokens('недавно'))).toBeNull();
    expect(matchForm('недел*', scoringTokens('дела'))).toBeNull();
    expect(matchForm('неплохо', scoringTokens('неплохо'))).not.toBeNull();
  });

  it('coveredTokenIndexes masks every token a form spans', () => {
    expect([...coveredTokenIndexes(['не очень'], scoringTokens('мне не очень'))]).toEqual([1, 2]);
    expect(coveredTokenIndexes(['спасибо'], scoringTokens('митч')).size).toBe(0);
  });
});
