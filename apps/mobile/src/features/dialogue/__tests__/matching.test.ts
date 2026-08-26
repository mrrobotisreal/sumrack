import { describe, expect, it } from 'vitest';

import {
  CHOICE_AMBIGUITY_MARGIN,
  CHOICE_SELECTION_THRESHOLD,
  matchTranscriptToChoices,
  type MatchableChoice,
} from '../matching';

/**
 * Choice-matching tests (T27). The choice sets mirror the real
 * a2-dialogue-001 fixture — including its deliberately similar pairs — plus
 * the ticket's named minimal-pair case («да, спасибо» vs «нет, спасибо»
 * must resolve by the differing token).
 */

const hungry: MatchableChoice[] = [
  { id: 'c1', ru: 'Да, я очень голодный.', asrAlternates: ['Да, очень.'] },
  { id: 'c2', ru: 'Нет, спасибо, я не голодный.' },
  { id: 'c3', ru: 'А что это на стене?' },
];

const seconds: MatchableChoice[] = [
  { id: 'more', ru: 'Да, можно ещё немного.', asrAlternates: ['Да, ещё немного, пожалуйста.'] },
  {
    id: 'stop',
    ru: 'Спасибо, я сыт, всё было очень вкусно.',
    asrAlternates: ['Спасибо, было очень вкусно.'],
  },
  { id: 'flat-no', ru: 'Нет.' },
];

const minimalPair: MatchableChoice[] = [
  { id: 'yes', ru: 'Да, спасибо.' },
  { id: 'no', ru: 'Нет, спасибо.' },
];

describe('matchTranscriptToChoices', () => {
  it('matches a cleanly spoken choice with a wide margin', () => {
    const r = matchTranscriptToChoices('да я очень голодный', hungry);
    expect(r.outcome).toBe('matched');
    expect(r.best?.choiceId).toBe('c1');
    expect(r.best?.score).toBe(100);
    expect(r.margin).toBeGreaterThanOrEqual(CHOICE_AMBIGUITY_MARGIN);
  });

  it('matches the negated twin by its differing tokens', () => {
    const r = matchTranscriptToChoices('нет спасибо я не голодный', hungry);
    expect(r.outcome).toBe('matched');
    expect(r.best?.choiceId).toBe('c2');
  });

  it('resolves the ticket’s minimal pair by the single differing token', () => {
    const yes = matchTranscriptToChoices('да спасибо', minimalPair);
    expect(yes.outcome).toBe('matched');
    expect(yes.best?.choiceId).toBe('yes');

    const no = matchTranscriptToChoices('нет спасибо', minimalPair);
    expect(no.outcome).toBe('matched');
    expect(no.best?.choiceId).toBe('no');
  });

  it('retries when only the shared token was heard (fits both, decides neither)', () => {
    const r = matchTranscriptToChoices('спасибо', minimalPair);
    // 1/2 target words lands under the selection threshold — retry either way.
    expect(r.outcome).toBe('below-threshold');
    expect(r.margin).toBeLessThan(CHOICE_AMBIGUITY_MARGIN);
  });

  it('treats an above-threshold tie as ambiguous, never guessing a branch', () => {
    const drinks: MatchableChoice[] = [
      { id: 'tea', ru: 'Я хочу чай.' },
      { id: 'coffee', ru: 'Я хочу кофе.' },
    ];
    // 2/3 of each target heard — both clear the threshold, margin 0.
    const r = matchTranscriptToChoices('я хочу', drinks);
    expect(r.outcome).toBe('ambiguous');
    expect(r.margin).toBeLessThan(CHOICE_AMBIGUITY_MARGIN);
    // The differing token resolves it.
    expect(matchTranscriptToChoices('я хочу кофе', drinks).best?.choiceId).toBe('coffee');
  });

  it('accepts an asrAlternate as a full match', () => {
    const r = matchTranscriptToChoices('да ещё немного пожалуйста', seconds);
    expect(r.outcome).toBe('matched');
    expect(r.best?.choiceId).toBe('more');
    expect(r.best?.score).toBe(100);
    expect(r.best?.target).toBe('Да, ещё немного, пожалуйста.');
  });

  it('accepts a natural partial phrasing above the selection threshold', () => {
    // Dropping the leading «да» still leaves 3/4 of the target heard.
    const r = matchTranscriptToChoices('можно ещё немного', seconds);
    expect(r.outcome).toBe('matched');
    expect(r.best?.choiceId).toBe('more');
    expect(r.best?.score).toBeGreaterThanOrEqual(CHOICE_SELECTION_THRESHOLD);
  });

  it('lets a one-word choice win outright when spoken', () => {
    const r = matchTranscriptToChoices('нет', seconds);
    expect(r.outcome).toBe('matched');
    expect(r.best?.choiceId).toBe('flat-no');
    expect(r.best?.score).toBe(100);
  });

  it('rejects a garbled answer below the selection threshold', () => {
    const r = matchTranscriptToChoices('окно собака завтра', hungry);
    expect(r.outcome).toBe('below-threshold');
    // Feedback target still exists so the retry UI can show per-word ✗.
    expect(r.best).not.toBeNull();
  });

  it('rejects a single hesitation word that fits nothing well enough', () => {
    const r = matchTranscriptToChoices('да', seconds);
    expect(r.outcome).toBe('below-threshold');
  });

  it('is ё/е-tolerant through the reused scorer', () => {
    const r = matchTranscriptToChoices('да можно еще немного', seconds);
    expect(r.outcome).toBe('matched');
    expect(r.best?.score).toBe(100);
  });

  it('survives ASR mis-spelled endings within the leniency budget', () => {
    // «голодный» heard as «голодная» — 1 edit on a 9-letter word.
    const r = matchTranscriptToChoices('да я очень голодная', hungry);
    expect(r.outcome).toBe('matched');
    expect(r.best?.choiceId).toBe('c1');
  });

  it('returns no-speech for an empty or punctuation-only transcript', () => {
    expect(matchTranscriptToChoices('', hungry).outcome).toBe('no-speech');
    expect(matchTranscriptToChoices('  …  ', hungry).outcome).toBe('no-speech');
  });

  it('keeps candidates sorted best-first with per-word detail', () => {
    const r = matchTranscriptToChoices('да я очень голодный', hungry);
    expect(r.candidates.map((c) => c.choiceId)[0]).toBe('c1');
    const scores = r.candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(r.best?.detail.words.every((w) => w.matched)).toBe(true);
  });
});
