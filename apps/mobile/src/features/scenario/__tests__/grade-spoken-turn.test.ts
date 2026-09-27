import { Rating } from 'ts-fsrs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  gradeSpokenTurn,
  producedLemmas,
  SCENARIO_MAX_RATING,
  scenarioRating,
} from '../grade-spoken-turn';

import { graph } from './engine-fixtures';

const findWordByLemma = vi.hoisted(() => vi.fn());
const getCard = vi.hoisted(() => vi.fn());
const gradeCard = vi.hoisted(() => vi.fn());
const recordReviewOutcome = vi.hoisted(() => vi.fn());
vi.mock('@/db', () => ({
  repos: {
    bank: { findWordByLemma },
    reviews: { getCard, gradeCard },
  },
}));
vi.mock('@/features/motivation/service', () => ({ recordReviewOutcome }));

/** Grading (T60, SPEAKING_SCENARIOS §5.4): production cards, capped at Good, source 'scenario'. */

const t03 = graph.turns.find((t) => t.id === 'radio-a1-t03')!;
const t02 = graph.turns.find((t) => t.id === 'radio-a1-t02')!;

describe('scenarioRating', () => {
  it('is the T12 mapping capped at Good (Easy never)', () => {
    expect(SCENARIO_MAX_RATING).toBe(Rating.Good);
    expect(scenarioRating(100)).toBe(Rating.Good);
    expect(scenarioRating(80)).toBe(Rating.Good);
    expect(scenarioRating(79)).toBe(Rating.Hard);
    expect(scenarioRating(50)).toBe(Rating.Hard);
    expect(scenarioRating(49)).toBe(Rating.Again);
  });
});

describe('producedLemmas', () => {
  it("the hit option's lemma per forms slot; free/number hits carry none; deduped", () => {
    expect(producedLemmas(t03, { slots: { mood: 'bad' } })).toEqual(['плохо']);
    expect(producedLemmas(t03, { slots: { mood: null } })).toEqual([]);
    expect(producedLemmas(t03, { slots: { mood: 'number' } })).toEqual([]);
    expect(producedLemmas(t02, { slots: { name: 'free' } })).toEqual([]);
    const two = {
      expect: {
        slots: [
          {
            kind: 'forms' as const,
            id: 'a',
            required: true,
            acceptsNumber: false,
            options: [{ key: 'x', lemma: 'Плохо', forms: ['плохо'] }],
          },
          {
            kind: 'forms' as const,
            id: 'b',
            required: false,
            acceptsNumber: false,
            options: [{ key: 'y', lemma: 'плохо', forms: ['плохо'] }],
          },
        ],
        accept: ['x'],
      },
    };
    expect(producedLemmas(two, { slots: { a: 'x', b: 'y' } })).toEqual(['Плохо']);
  });
});

describe('gradeSpokenTurn', () => {
  beforeEach(() => {
    findWordByLemma.mockReset();
    getCard.mockReset();
    gradeCard.mockReset();
    recordReviewOutcome.mockReset();
  });

  it('grades the production card of a banked lemma with source scenario + the motivation bump', async () => {
    findWordByLemma.mockResolvedValue({ id: 'item-1' });
    getCard.mockResolvedValue({ id: 'card-1' });
    const n = await gradeSpokenTurn(t03, {
      verdict: 'matched',
      score: 100,
      slots: { mood: 'bad' },
    });
    expect(n).toBe(1);
    expect(findWordByLemma).toHaveBeenCalledWith('плохо');
    expect(getCard).toHaveBeenCalledWith('item-1', 'production');
    expect(gradeCard).toHaveBeenCalledWith('card-1', Rating.Good, { source: 'scenario' });
    expect(recordReviewOutcome).toHaveBeenCalledWith(Rating.Good);
  });

  it('a partial score grades Hard; never auto-creates items or cards', async () => {
    findWordByLemma.mockResolvedValueOnce(null);
    expect(
      await gradeSpokenTurn(t03, { verdict: 'matched', score: 60, slots: { mood: 'good' } }),
    ).toBe(0);
    expect(gradeCard).not.toHaveBeenCalled();
    findWordByLemma.mockResolvedValueOnce({ id: 'item-2' });
    getCard.mockResolvedValueOnce(null);
    expect(
      await gradeSpokenTurn(t03, { verdict: 'matched', score: 60, slots: { mood: 'good' } }),
    ).toBe(0);
    findWordByLemma.mockResolvedValueOnce({ id: 'item-2' });
    getCard.mockResolvedValueOnce({ id: 'card-2' });
    expect(
      await gradeSpokenTurn(t03, { verdict: 'matched', score: 60, slots: { mood: 'good' } }),
    ).toBe(1);
    expect(gradeCard).toHaveBeenCalledWith('card-2', Rating.Hard, { source: 'scenario' });
  });

  it('misses and free-slot turns write nothing', async () => {
    expect(await gradeSpokenTurn(t03, { verdict: 'miss', score: 0, slots: { mood: null } })).toBe(
      0,
    );
    expect(
      await gradeSpokenTurn(t02, { verdict: 'matched', score: 100, slots: { name: 'free' } }),
    ).toBe(0);
    expect(findWordByLemma).not.toHaveBeenCalled();
  });
});
