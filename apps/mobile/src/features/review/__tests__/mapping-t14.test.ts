import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';

import {
  LISTENING_FAST_THRESHOLD_MS,
  listeningOutcomeToRating,
  type ListeningOutcome,
} from '../mapping';

/** T14: listening-quiz outcome → FSRS rating rules (recorded in the ticket). */

function outcome(partial: Partial<ListeningOutcome>): ListeningOutcome {
  return {
    variant: 'pick4',
    correct: true,
    replays: 0,
    slowReplays: 0,
    durationMs: 3000,
    ...partial,
  };
}

describe('listeningOutcomeToRating', () => {
  it('wrong answer is Again regardless of variant or replays', () => {
    expect(listeningOutcomeToRating(outcome({ correct: false }))).toBe(Rating.Again);
    expect(listeningOutcomeToRating(outcome({ correct: false, variant: 'typed' }))).toBe(
      Rating.Again,
    );
    expect(listeningOutcomeToRating(outcome({ correct: false, slowReplays: 2 }))).toBe(
      Rating.Again,
    );
  });

  it('slow-replay use caps a correct answer at Hard on both variants', () => {
    expect(listeningOutcomeToRating(outcome({ slowReplays: 1 }))).toBe(Rating.Hard);
    expect(listeningOutcomeToRating(outcome({ slowReplays: 1, variant: 'typed' }))).toBe(
      Rating.Hard,
    );
  });

  it('normal-speed replays are free', () => {
    expect(listeningOutcomeToRating(outcome({ replays: 5 }))).toBe(Rating.Good);
    expect(listeningOutcomeToRating(outcome({ replays: 5, variant: 'typed' }))).toBe(Rating.Good);
  });

  it('pick4 splits Good/Hard at the 10s threshold', () => {
    expect(listeningOutcomeToRating(outcome({ durationMs: LISTENING_FAST_THRESHOLD_MS }))).toBe(
      Rating.Good,
    );
    expect(listeningOutcomeToRating(outcome({ durationMs: LISTENING_FAST_THRESHOLD_MS + 1 }))).toBe(
      Rating.Hard,
    );
  });

  it('typed correct has no speed gate', () => {
    expect(listeningOutcomeToRating(outcome({ variant: 'typed', durationMs: 60_000 }))).toBe(
      Rating.Good,
    );
  });

  it('never emits Easy', () => {
    const outcomes: ListeningOutcome[] = [
      outcome({}),
      outcome({ variant: 'typed' }),
      outcome({ durationMs: 1 }),
    ];
    for (const o of outcomes) {
      expect(listeningOutcomeToRating(o)).not.toBe(Rating.Easy);
    }
  });
});
