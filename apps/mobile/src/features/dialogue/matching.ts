import {
  scoreAttempt,
  scoringTokens,
  type PronunciationScore,
} from '@/features/pronunciation/scoring';

/**
 * Spoken-choice matching (T27, design V2 §3.3): score one ASR transcript
 * against every choice's sentence + its `asrAlternates` through the existing
 * T12 scorer (normalize → token-Levenshtein → lenient 0–100), then decide
 * whether the best candidate wins the branch.
 *
 * THE TUNABLES (T27 recorded decision — see SUMRAK_TICKETS.md):
 *
 * - `CHOICE_SELECTION_THRESHOLD = 60`. The T12 rating mapping (≥80 Good /
 *   ≥50 Hard) grades *pronunciation quality*; selection answers a different
 *   question — "which answer did Mitch mean". 80 rejected honest partial
 *   phrasings («можно ещё немного» for «Да, можно ещё немного» = 75); 50 let
 *   two-word noise through on four-word choices. 60 = a clear majority of
 *   the target's words heard.
 * - `CHOICE_AMBIGUITY_MARGIN = 15`. Near-identical choices are the designed
 *   content shape («да, спасибо» vs «нет, спасибо» differ by one token —
 *   50 points apart when spoken clearly). A best-vs-second gap under 15
 *   means the transcript genuinely fits both (e.g. only the shared words
 *   were heard) → retry instead of guessing a branch.
 * - `TAP_UNLOCK_AFTER_ATTEMPTS = 2` failed spoken attempts unlock
 *   tap-to-choose (voice-first, never voice-locked).
 *
 * The FSRS `production` rating for a matched choice reuses the T12 mapping
 * unchanged (≥80 Good / 50–79 Hard / <50 Again — a sub-50 *match* can't
 * happen since selection requires ≥60, so Again is unreachable by
 * construction for spoken choices; recorded).
 */

export const CHOICE_SELECTION_THRESHOLD = 60;
export const CHOICE_AMBIGUITY_MARGIN = 15;
export const TAP_UNLOCK_AFTER_ATTEMPTS = 2;

export interface MatchableChoice {
  id: string;
  /** The choice sentence's Russian text. */
  ru: string;
  /** Acceptable alternate phrasings (normalized-ish authored text). */
  asrAlternates?: string[] | null;
}

export interface ChoiceCandidate {
  choiceId: string;
  /** Best score across the choice's targets (sentence + alternates). */
  score: number;
  /** The target text that produced the best score. */
  target: string;
  /** Per-word ✓/✗ detail for that target (drives retry feedback). */
  detail: PronunciationScore;
}

export type MatchOutcome = 'matched' | 'ambiguous' | 'below-threshold' | 'no-speech';

export interface ChoiceMatchResult {
  outcome: MatchOutcome;
  /** Best candidate (also the retry-feedback target); null on no-speech. */
  best: ChoiceCandidate | null;
  /** best.score − runner-up score (best.score when there is no runner-up). */
  margin: number;
  /** All candidates, best first. */
  candidates: ChoiceCandidate[];
}

function scoreChoice(transcript: string, choice: MatchableChoice): ChoiceCandidate {
  const targets = [choice.ru, ...(choice.asrAlternates ?? [])];
  let best: ChoiceCandidate | null = null;
  for (const target of targets) {
    const detail = scoreAttempt(target, transcript);
    if (!best || detail.score > best.score) {
      best = { choiceId: choice.id, score: detail.score, target, detail };
    }
  }
  // targets is never empty (ru is required), so best is always set.
  return best!;
}

/** Match one transcript against a node's choices and pick the branch. */
export function matchTranscriptToChoices(
  transcript: string,
  choices: MatchableChoice[],
): ChoiceMatchResult {
  if (scoringTokens(transcript).length === 0) {
    return { outcome: 'no-speech', best: null, margin: 0, candidates: [] };
  }

  const candidates = choices
    .map((c) => scoreChoice(transcript, c))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0] ?? null;
  if (!best) return { outcome: 'no-speech', best: null, margin: 0, candidates: [] };

  const second = candidates[1];
  const margin = best.score - (second?.score ?? 0);

  if (best.score < CHOICE_SELECTION_THRESHOLD) {
    return { outcome: 'below-threshold', best, margin, candidates };
  }
  if (second && margin < CHOICE_AMBIGUITY_MARGIN) {
    return { outcome: 'ambiguous', best, margin, candidates };
  }
  return { outcome: 'matched', best, margin, candidates };
}
