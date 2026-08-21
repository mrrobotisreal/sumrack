import { Rating, type Grade } from 'ts-fsrs';

/**
 * Multiple-choice outcome → FSRS rating (design §7.3: correct-fast = Good,
 * correct-slow = Hard, wrong = Again).
 *
 * T06 decision — the fast/slow threshold is 7 seconds, measured from the
 * moment the choices render to the tap. Generous on purpose: reading a
 * Russian prompt plus four options at A1 takes time, and FSRS "Hard" should
 * mean genuinely effortful recall, not a slow thumb. Recognition can never
 * demonstrate effortless recall, so MC never emits Easy — that rating stays
 * reserved for self-graded flashcards (and future typed modes).
 * T12/T14 read this file when mapping their own outcomes.
 */
export const MC_FAST_THRESHOLD_MS = 7000;

export function mcOutcomeToRating(correct: boolean, durationMs: number): Grade {
  if (!correct) return Rating.Again;
  return durationMs <= MC_FAST_THRESHOLD_MS ? Rating.Good : Rating.Hard;
}

/**
 * Session-accuracy semantics (game_sessions.correctCount and the summary
 * screen): Again = miss, anything else = got it. For MC this coincides with
 * "picked the right option"; for flashcards it means Hard still counts as
 * recalled — it was recalled, just slowly.
 */
export function ratingCountsAsCorrect(rating: Grade): boolean {
  return rating !== Rating.Again;
}
