import { Rating, type Grade } from 'ts-fsrs';

import { normalizeRu } from '@/db/normalize';

/**
 * Pronunciation scoring (T12, design §6): normalize → token-align target vs
 * transcript (Levenshtein on the token sequence) → per-word ✓/✗ + a lenient
 * overall score. Deliberately Duolingo-style generous — this judges "did you
 * say that word", never phoneme accuracy (explicitly out of scope).
 *
 * Normalization reuses the app-wide tolerant matcher (`normalizeRu`: NFC,
 * lowercase, ё→е — T03, comparison only, storage never mutated). T13's typed
 * cloze should reuse `scoringTokens`/`wordsMatch` from here rather than
 * building a second tolerant matcher.
 */

/** Tokenize for scoring: normalize, strip punctuation, keep in-word hyphens («кто-то»). */
export function scoringTokens(text: string): string[] {
  return normalizeRu(text)
    .split(/[^\p{L}\p{N}-]+/u)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 0);
}

/** Plain character-level Levenshtein distance. */
export function charDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[n]!;
}

/**
 * Leniency budget: how many character edits still count as "same word".
 * ASR itself mis-spells endings on imperfect-but-recognizable speech; being
 * strict here punishes the model's errors, not Mitch's.
 */
export function allowedEdits(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return 3;
}

/** Tolerant word equality over already-normalized scoring tokens. */
export function wordsMatch(target: string, heard: string): boolean {
  if (target === heard) return true;
  return charDistance(target, heard) <= allowedEdits(Math.max(target.length, heard.length));
}

export interface WordScore {
  /** Target word as displayed (surface casing/ё preserved for the UI). */
  display: string;
  /** Normalized form the match ran on. */
  target: string;
  /** What the ASR heard in this slot (normalized), null = nothing aligned. */
  heard: string | null;
  matched: boolean;
}

export interface PronunciationScore {
  words: WordScore[];
  /** 0–100: matched / total target words. */
  score: number;
  matchedCount: number;
  totalCount: number;
}

/**
 * Align target tokens against transcript tokens with sequence Levenshtein
 * (substitution = tolerant word match) and score each target word. Extra
 * transcript words are ignored (saying more than asked never hurts); missing
 * or wrong words fail their slot.
 */
export function scoreAttempt(targetText: string, transcriptText: string): PronunciationScore {
  // Display tokens keep original casing/ё; scoring tokens are normalized.
  // Both come from the same splitter so they stay index-aligned.
  const displayTokens = targetText
    .normalize('NFC')
    .split(/[^\p{L}\p{N}-]+/u)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 0);
  const target = displayTokens.map((t) => normalizeRu(t));
  const heard = scoringTokens(transcriptText);

  const m = target.length;
  const n = heard.length;

  // DP over token sequences; sub cost 0 for a tolerant match else 1.
  const cost: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) cost[i]![0] = i;
  for (let j = 0; j <= n; j++) cost[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = cost[i - 1]![j - 1]! + (wordsMatch(target[i - 1]!, heard[j - 1]!) ? 0 : 1);
      cost[i]![j] = Math.min(sub, cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
    }
  }

  // Backtrace, preferring diagonal moves so each target word gets the
  // transcript word that best explains it.
  const aligned: (string | null)[] = new Array(m).fill(null);
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sub = cost[i - 1]![j - 1]! + (wordsMatch(target[i - 1]!, heard[j - 1]!) ? 0 : 1);
      if (cost[i]![j] === sub) {
        aligned[i - 1] = heard[j - 1]!;
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      i--; // deletion: target word never spoken
      continue;
    }
    j--; // insertion: extra transcript word, ignored
  }

  const words: WordScore[] = target.map((t, k) => {
    const heardWord = aligned[k] ?? null;
    return {
      display: displayTokens[k]!,
      target: t,
      heard: heardWord,
      matched: heardWord != null && wordsMatch(t, heardWord),
    };
  });
  const matchedCount = words.filter((w) => w.matched).length;
  const totalCount = words.length;
  return {
    words,
    score: totalCount === 0 ? 0 : Math.round((100 * matchedCount) / totalCount),
    matchedCount,
    totalCount,
  };
}

/**
 * Score → FSRS rating for the `production` direction (T12 decision, same
 * shape as T06's MC mapping — record kept in SUMRAK_TICKETS.md):
 *
 *   score ≥ 80 → Good · 50–79 → Hard · < 50 → Again · Easy never emitted
 *
 * Rationale: ≥80 on a short phrase means at most one word slipped — that is
 * recalled-and-produced, FSRS Good. A half-right attempt was effortful
 * production (Hard). Easy stays reserved for self-graded flashcards: a noisy
 * ASR channel can never prove effortless mastery. The session grades the
 * BEST attempt (retry loop is practice, not punishment — design §7.7).
 */
export const PRONUNCIATION_PASS_SCORE = 80;
export const PRONUNCIATION_HARD_SCORE = 50;

export function pronunciationScoreToRating(score: number): Grade {
  if (score >= PRONUNCIATION_PASS_SCORE) return Rating.Good;
  if (score >= PRONUNCIATION_HARD_SCORE) return Rating.Hard;
  return Rating.Again;
}
