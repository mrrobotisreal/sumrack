/**
 * T30.2 — where should the reader open?
 *
 * Pure decision so both entry paths (Library card, Today continue card —
 * neither passes initialSentenceIdx) and the T24 deep links (search,
 * bookmarks) share one verified contract:
 *  - a deep link wins outright, even when it points at the top;
 *  - otherwise an unfinished story with a saved position restores to it;
 *  - fresh and finished stories open at the top.
 */
export interface RestoreInput {
  /** T24 deep link (search/bookmarks); undefined for Library/Today opens. */
  initialSentenceIdx?: number;
  /** story_progress.current_sentence_idx, or null when no row exists. */
  savedIdx: number | null;
  finished: boolean;
  sentenceCount: number;
}

export interface RestoreTarget {
  /** Sentence orderIdx to scroll to, or null = open at the top. */
  targetIdx: number | null;
  /** What decided the target ('saved' is the only one that logs a restore). */
  source: 'deep-link' | 'saved' | 'top';
}

export function resolveRestoreTarget(input: RestoreInput): RestoreTarget {
  const { initialSentenceIdx, savedIdx, finished, sentenceCount } = input;
  if (initialSentenceIdx != null && initialSentenceIdx >= 0) {
    const inRange = initialSentenceIdx > 0 && initialSentenceIdx < sentenceCount;
    return { targetIdx: inRange ? initialSentenceIdx : null, source: 'deep-link' };
  }
  if (!finished && savedIdx != null && savedIdx > 0 && savedIdx < sentenceCount) {
    return { targetIdx: savedIdx, source: 'saved' };
  }
  return { targetIdx: null, source: 'top' };
}
