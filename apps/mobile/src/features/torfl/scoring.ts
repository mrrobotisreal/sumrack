import {
  itemPoints,
  type ChoiceItem,
  type ExamItem,
  type ExamSubtest,
  type StoryRef,
  type TypedItem,
} from '@sumrak/schema';

/**
 * The objective scoring core (T70, TORFL_EXAM_PREP §6.1) — PURE (no DB, no
 * React): the drill runner (T70) and the mock engine (T71) both score
 * through here, so a drill answer and a mock answer are worth the same by
 * construction.
 *
 * - `choice`: full `points` iff `index === answer`; a blank (null) is 0.
 * - `typed`: normalize (NFC, lower-case, ё→е, stress marks and punctuation
 *   stripped, spaces collapsed); full if it matches any `accept` (exact or a
 *   trailing-`*` stem glob), half if it matches `half` (demo v1's 2.5 of 5:
 *   right meaning, wrong grammatical form), else 0.
 * - Unanswered = 0; a subtest's % = Σ points / `maxPoints` × 100, one decimal.
 */

/** Combining acute / grave — Russian stress marks a learner may paste. */
const STRESS_MARKS = /[̀́]/g;
/** Everything that is not a letter, digit, space or in-word hyphen. */
const NON_WORD = /[^\p{L}\p{N}\s-]/gu;

/**
 * NFC → lower-case → ё→е → strip stress marks and punctuation → collapse
 * whitespace → trim. Hyphens inside a word survive («кто-то»); a stray
 * leading/trailing hyphen does not. Idempotent.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFC')
    .replace(STRESS_MARKS, '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(NON_WORD, ' ')
    .replace(/(^|\s)-+|-+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `pattern` is normalized like an answer; a trailing `*` makes it a PREFIX
 * match on the (normalized) answer — «рабоч*» accepts «рабочий», «рабочая».
 * Without the star it is an exact match.
 */
export function matchesPattern(pattern: string, normalizedAnswer: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.endsWith('*')) {
    const stem = normalizeAnswer(trimmed.slice(0, -1));
    return stem.length > 0 && normalizedAnswer.startsWith(stem);
  }
  return normalizeAnswer(trimmed) === normalizedAnswer;
}

export type ItemOutcome = 'full' | 'half' | 'wrong' | 'blank';

export interface ItemScore {
  points: number;
  maxPoints: number;
  outcome: ItemOutcome;
}

/** Points a choice/typed item is worth in its subtest (its own `points`, else `pointsPerItem`, else 0). */
export function itemMaxPoints(item: ExamItem, subtest: Pick<ExamSubtest, 'pointsPerItem'>): number {
  return itemPoints(subtest, item);
}

/** Score a choice answer. `index` null = left blank. */
export function scoreChoice(item: ChoiceItem, index: number | null, maxPoints: number): ItemScore {
  if (index === null) return { points: 0, maxPoints, outcome: 'blank' };
  return index === item.answer
    ? { points: maxPoints, maxPoints, outcome: 'full' }
    : { points: 0, maxPoints, outcome: 'wrong' };
}

/** Score a typed answer: full / half (× 0.5) / 0. */
export function scoreTyped(item: TypedItem, text: string, maxPoints: number): ItemScore {
  const answer = normalizeAnswer(text);
  if (answer.length === 0) return { points: 0, maxPoints, outcome: 'blank' };
  if (item.accept.some((p) => matchesPattern(p, answer))) {
    return { points: maxPoints, maxPoints, outcome: 'full' };
  }
  if ((item.half ?? []).some((p) => matchesPattern(p, answer))) {
    return { points: maxPoints / 2, maxPoints, outcome: 'half' };
  }
  return { points: 0, maxPoints, outcome: 'wrong' };
}

/**
 * The form to SHOW as the accepted answer (typed feedback): the first
 * `accept` entry with a trailing glob star dropped — «рабоч*» reads «рабоч…».
 */
export function acceptedDisplay(item: TypedItem): string {
  const first = item.accept[0] ?? '';
  return first.endsWith('*') ? `${first.slice(0, -1)}…` : first;
}

/** Score any objective item (choice / typed); null for kinds scored by rubric (writing/speaking). */
export function scoreItem(
  item: ExamItem,
  answer: { index: number | null } | { text: string },
  subtest: Pick<ExamSubtest, 'pointsPerItem'>,
): ItemScore | null {
  const max = itemMaxPoints(item, subtest);
  if (item.kind === 'choice' && 'index' in answer) return scoreChoice(item, answer.index, max);
  if (item.kind === 'typed' && 'text' in answer) return scoreTyped(item, answer.text, max);
  return null;
}

/** One decimal, half away from zero (the §6.1 rounding). */
export function roundPct(value: number): number {
  return Math.round((value + 1e-9) * 10) / 10;
}

/**
 * A subtest's percent: Σ points / `maxPoints` × 100, one decimal. Items the
 * candidate never answered simply have no response row → they add 0 (the
 * denominator is the SUBTEST's `maxPoints`, not the answered items').
 */
export function subtestPercent(
  responses: readonly { points: number | null }[],
  subtest: Pick<ExamSubtest, 'maxPoints'>,
): number {
  if (subtest.maxPoints <= 0) return 0;
  const sum = responses.reduce((n, r) => n + (r.points ?? 0), 0);
  return Math.min(100, Math.max(0, roundPct((sum / subtest.maxPoints) * 100)));
}

// --- stem + story-ref helpers (pure parts) ------------------------------------

const GAP_RE = /…|\.\.\.|_{3,}/;

/** A choice stem split around its single gap: `gap` null when the stem has none. */
export function splitStemAtGap(stem: string): {
  before: string;
  gap: string | null;
  after: string;
} {
  const m = GAP_RE.exec(stem);
  if (!m) return { before: stem, gap: null, after: '' };
  return {
    before: stem.slice(0, m.index),
    gap: m[0],
    after: stem.slice(m.index + m[0].length),
  };
}

/** The option letters of a choice item (А–Г): the official A, B, V, G in Cyrillic. */
export const OPTION_LETTERS = ['А', 'Б', 'В', 'Г'] as const;

/**
 * The sentences a ref covers, in story order. `sentenceIds` absent = the
 * whole story; ids no longer in the story (a pack update) are dropped; an
 * empty result means the ref no longer resolves.
 */
export function refSentenceIds(ref: StoryRef, storySentenceIds: readonly string[]): string[] {
  if (!ref.sentenceIds) return [...storySentenceIds];
  const wanted = new Set(ref.sentenceIds);
  return storySentenceIds.filter((id) => wanted.has(id));
}

/** Lead-in / lead-out around a stamped span (the T14 listening precedent, 150 / 250 ms). */
export const SPAN_LEAD_IN_MS = 150;
export const SPAN_LEAD_OUT_MS = 250;

export interface WordStampLike {
  sentenceId: string;
  startMs: number;
  endMs: number;
}

export interface AudioSpan {
  startMs: number;
  endMs: number;
}

/**
 * The audio span of a ref on a track: from the first stamped token of the
 * first covered sentence (− 150 ms) to the last stamped token of the last
 * covered sentence (+ 250 ms), clamped to [0, durationMs]. Whole track when
 * the ref names no sentences. `null` = the covered sentences carry no stamps
 * (callers fall back to the whole track or TTS).
 */
export function resolveAudioSpan(
  ref: Pick<StoryRef, 'sentenceIds'>,
  stamps: readonly WordStampLike[],
  durationMs: number,
): AudioSpan | null {
  if (!ref.sentenceIds || ref.sentenceIds.length === 0) {
    return { startMs: 0, endMs: durationMs };
  }
  const wanted = new Set(ref.sentenceIds);
  const covered = stamps.filter((s) => wanted.has(s.sentenceId) && s.endMs > s.startMs);
  if (covered.length === 0) return null;
  let first = Infinity;
  let last = 0;
  for (const s of covered) {
    first = Math.min(first, s.startMs);
    last = Math.max(last, s.endMs);
  }
  return {
    startMs: Math.max(0, first - SPAN_LEAD_IN_MS),
    endMs: Math.min(durationMs > 0 ? durationMs : Infinity, last + SPAN_LEAD_OUT_MS),
  };
}
