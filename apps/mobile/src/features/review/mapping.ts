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

/**
 * Cloze outcome → FSRS rating (T13, per the ticket's explicit rules):
 *
 *   wrong, or "reveal" used            → Again
 *   typed correct, no hint             → Good
 *   typed correct, any hint used       → Hard  (hints cap the rating)
 *   tile-pick correct, fast            → Good
 *   tile-pick correct, slow            → Hard
 *
 * The tile threshold is 12 s — deliberately wider than MC's 7 s because a
 * cloze prompt is a full sentence, not a single word. Easy is never emitted
 * (same reasoning as MC: recognition/completion can't prove effortless
 * recall). The hint ladder exists only on the typed variant — tiles already
 * show the answer among the options.
 */
export const CLOZE_TILE_FAST_THRESHOLD_MS = 12_000;

export interface ClozeOutcome {
  variant: 'tiles' | 'typed';
  correct: boolean;
  /** first-letter / lemma hints taken (typed only). */
  hintsUsed: number;
  /** The answer was revealed (typed only) — never counts as recalled. */
  revealed: boolean;
  durationMs: number;
}

export function clozeOutcomeToRating(outcome: ClozeOutcome): Grade {
  if (!outcome.correct || outcome.revealed) return Rating.Again;
  if (outcome.variant === 'typed') {
    return outcome.hintsUsed > 0 ? Rating.Hard : Rating.Good;
  }
  return outcome.durationMs <= CLOZE_TILE_FAST_THRESHOLD_MS ? Rating.Good : Rating.Hard;
}

/**
 * Sentence-builder outcome → FSRS rating (T13):
 *
 *   wrong sentence                     → Again
 *   correct, but tiles were taken back → Hard  ("mistakes recovered")
 *   correct, slow                      → Hard
 *   correct, fast, no take-backs       → Good
 *
 * "Fast" scales with sentence length: 2.5 s per word tile, floor 10 s —
 * assembling eight tiles honestly takes time. Easy is never emitted.
 */
export function sbFastThresholdMs(wordCount: number): number {
  return Math.max(10_000, wordCount * 2_500);
}

export interface SbOutcome {
  correct: boolean;
  /** Tiles removed from the answer row before checking (recovered mistakes). */
  removals: number;
  wordCount: number;
  durationMs: number;
}

export function sbOutcomeToRating(outcome: SbOutcome): Grade {
  if (!outcome.correct) return Rating.Again;
  if (outcome.removals > 0) return Rating.Hard;
  return outcome.durationMs <= sbFastThresholdMs(outcome.wordCount) ? Rating.Good : Rating.Hard;
}

/**
 * Listening-quiz outcome → FSRS rating (T14):
 *
 *   wrong answer                       → Again
 *   correct, slow-replay was used      → Hard  (the 0.7× crutch is a hint —
 *                                               caps the rating, same spirit
 *                                               as cloze's hint ladder)
 *   pick-from-4 correct, fast          → Good
 *   pick-from-4 correct, slow          → Hard
 *   typed correct (no slow-replay)     → Good
 *
 * Normal-speed replays are free — relistening is what listening practice
 * IS, and punishing it would teach answering on half-heard audio. The
 * pick-4 threshold is 10 s: wider than MC's 7 s because the clock starts
 * when the item renders and the clip itself takes ~1–3 s to play. Typed has
 * no speed gate (typing Cyrillic on glass is slow for honest reasons).
 * Easy is never emitted (T06 reasoning: recognition can't prove effortless
 * recall).
 */
export const LISTENING_FAST_THRESHOLD_MS = 10_000;

export interface ListeningOutcome {
  variant: 'pick4' | 'typed';
  correct: boolean;
  /** Normal-speed replays taken (analytics only — never affects the rating). */
  replays: number;
  /** Slow (0.7×) replays taken — any use caps the rating at Hard. */
  slowReplays: number;
  durationMs: number;
}

export function listeningOutcomeToRating(outcome: ListeningOutcome): Grade {
  if (!outcome.correct) return Rating.Again;
  if (outcome.slowReplays > 0) return Rating.Hard;
  if (outcome.variant === 'typed') return Rating.Good;
  return outcome.durationMs <= LISTENING_FAST_THRESHOLD_MS ? Rating.Good : Rating.Hard;
}
