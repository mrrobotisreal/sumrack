import { answersMatch } from '@/lib/text';

/**
 * Exercise-runner outcomes and scoring (T17). The runner serves authored
 * `ExerciseSpec`s (checkpoints) and generated ones (unit quizzes) the same
 * way; scoring is plain correct/total — tests are assessments, so no FSRS
 * grading happens here (recorded T17 decision: mixing test answers into the
 * review scheduler would double-schedule what reviews already cover).
 */
export interface SpecOutcome {
  specId: string;
  kind: string;
  correct: boolean;
  /**
   * Excluded from the denominator: pronunciation items when the ASR model
   * isn't installed / mic is denied (the test must stay passable offline on
   * a fresh device — recorded T17 decision).
   */
  skipped: boolean;
  durationMs: number;
}

export interface ExerciseScore {
  correct: number;
  /** Scorable items (skipped excluded). */
  scored: number;
  skipped: number;
  /** 0–100, rounded to one decimal; 0 when nothing was scorable. */
  scorePercent: number;
}

export function scoreOutcomes(outcomes: readonly SpecOutcome[]): ExerciseScore {
  const scorable = outcomes.filter((o) => !o.skipped);
  const correct = scorable.filter((o) => o.correct).length;
  const scorePercent =
    scorable.length === 0 ? 0 : Math.round((correct / scorable.length) * 1000) / 10;
  return {
    correct,
    scored: scorable.length,
    skipped: outcomes.length - scorable.length,
    scorePercent,
  };
}

export function passes(score: ExerciseScore, threshold: number): boolean {
  return score.scored > 0 && score.scorePercent >= threshold * 100;
}

/**
 * Typed-answer equality for full phrases/sentences (listening typed
 * variant): punctuation-insensitive on both sides, then the shared tolerant
 * matcher (NFC/case/ё→е/stress). NO edit-distance — that leniency is
 * reserved for the noisy ASR channel (T13 decision).
 */
export function typedTextMatches(expected: string, typed: string): boolean {
  return answersMatch(stripPunct(expected), stripPunct(typed));
}

function stripPunct(text: string): string {
  // Keep in-word hyphens («кто-то»); drop every other punctuation mark.
  return text
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/(^|\s)-+|-+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
