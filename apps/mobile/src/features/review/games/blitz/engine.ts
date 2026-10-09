import { XP_TABLE } from '@/features/motivation/xp';

/**
 * Match blitz «Молния» — the pure engine (T34, V2 §7.9). A 60-second sprint:
 * two columns (Russian lemmas left, English glosses right), tap one on each
 * side to match; matched pairs leave and refill from the pool. No DB, no
 * React, no FSRS. `rng` injectable for tests.
 *
 * Recorded decisions:
 * - VISIBLE_PAIRS = 5 (5 rows × 2 columns fits a phone without scrolling).
 * - Wrong match = shake + WRONG_PENALTY_MS (2 s) off the clock — the constant
 *   lives here, tunable.
 * - Score = pairs matched. Mistakes are counted (detail) but never subtract.
 * - Refill: a matched pair's two slots are refilled IN PLACE by the next
 *   pool pair, the Russian into the left slot it vacated and the gloss into
 *   the right slot it vacated — so the other tiles never move (T13's
 *   rapid-tap reflow lesson: nothing slides under a finger).
 *   (When the two vacated slots share a row, the new pair lands on one row —
 *   the same trait as every tile-matching game; accepted.)
 * - The pool cycles: when exhausted it reshuffles (excluding pairs still on
 *   the board), so a 30-word bank can still run a 60 s sprint.
 * - Glosses are deduped on the board: two visible pairs never share the same
 *   gloss or lemma text (an ambiguous match would be unfair).
 */

export const BLITZ_DURATION_MS = 60_000;
export const WRONG_PENALTY_MS = 2_000;
export const VISIBLE_PAIRS = 5;
/** A bank this small can't fill a board with distinct pairs. */
export const MIN_BLITZ_POOL = VISIBLE_PAIRS + 1;

export interface BlitzPair {
  /** bank item id. */
  id: string;
  ru: string;
  en: string;
}

export interface BlitzBoard {
  /** Left column, slot index → pair id (null = momentarily empty). */
  left: (string | null)[];
  /** Right column, slot index → pair id. */
  right: (string | null)[];
  /** Pool order for refills; `cursor` is the next index to draw. */
  queue: string[];
  cursor: number;
}

type Rng = () => number;

function shuffle<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function norm(text: string): string {
  return text.normalize('NFC').trim().toLocaleLowerCase('ru');
}

/**
 * Dedupe the pool so no two pairs share a lemma or a gloss (first wins).
 * Keeps the board unambiguous.
 */
export function dedupePool(pairs: readonly BlitzPair[]): BlitzPair[] {
  const ru = new Set<string>();
  const en = new Set<string>();
  const out: BlitzPair[] = [];
  for (const p of pairs) {
    const r = norm(p.ru);
    const e = norm(p.en);
    if (!r || !e || ru.has(r) || en.has(e)) continue;
    ru.add(r);
    en.add(e);
    out.push(p);
  }
  return out;
}

/** Next pair id from the queue that is not on the board; reshuffles when exhausted. */
function draw(
  board: BlitzBoard,
  onBoard: ReadonlySet<string>,
  allIds: readonly string[],
  rng: Rng,
): BlitzBoard & { id: string | null } {
  let { queue, cursor } = board;
  for (let attempts = 0; attempts < 2; attempts++) {
    while (cursor < queue.length) {
      const id = queue[cursor]!;
      cursor += 1;
      if (!onBoard.has(id)) return { ...board, queue, cursor, id };
    }
    queue = shuffle(allIds, rng);
    cursor = 0;
  }
  return { ...board, queue, cursor, id: null };
}

/** A fresh board: VISIBLE_PAIRS pairs, right column independently shuffled. */
export function createBoard(pool: readonly BlitzPair[], rng: Rng = Math.random): BlitzBoard {
  const ids = pool.map((p) => p.id);
  const queue = shuffle(ids, rng);
  const first = queue.slice(0, VISIBLE_PAIRS);
  return {
    left: [...first],
    right: shuffle(first, rng),
    queue,
    cursor: first.length,
  };
}

export type MatchOutcome =
  { kind: 'match'; board: BlitzBoard; leftSlot: number; rightSlot: number } | { kind: 'miss' };

/**
 * Try a left-slot × right-slot match. A match refills both vacated slots
 * in place from the queue; a miss leaves the board unchanged.
 */
export function tryMatch(
  board: BlitzBoard,
  leftSlot: number,
  rightSlot: number,
  allIds: readonly string[],
  rng: Rng = Math.random,
): MatchOutcome {
  const l = board.left[leftSlot];
  const r = board.right[rightSlot];
  if (l == null || r == null || l !== r) return { kind: 'miss' };
  // The matched pair counts as on-board for the draw, so it can never be
  // redrawn straight back into its own slots (pool ≥ MIN_BLITZ_POOL keeps a
  // spare available).
  const onBoard = new Set([...board.left, ...board.right].filter((x): x is string => x != null));
  const drawn = draw(board, onBoard, allIds, rng);
  const left = [...board.left];
  const right = [...board.right];
  left[leftSlot] = drawn.id;
  right[rightSlot] = drawn.id;
  return {
    kind: 'match',
    board: { left, right, queue: drawn.queue, cursor: drawn.cursor },
    leftSlot,
    rightSlot,
  };
}

/** Remaining ms given elapsed time and accumulated penalties. */
export function remainingMs(elapsedMs: number, penaltyMs: number): number {
  return Math.max(0, BLITZ_DURATION_MS - elapsedMs - penaltyMs);
}

/** XP by score bracket (data table XP_TABLE.blitzRound; 0 pairs → 0). */
export function xpForBlitz(pairs: number): number {
  let xp = 0;
  for (const b of XP_TABLE.blitzRound) {
    if (pairs >= b.minPairs) xp = b.xp;
  }
  return xp;
}

/**
 * The tile text for a gloss: the first sense only (before «;»), so a long
 * bank translation doesn't blow up a tile. The full gloss is never needed
 * mid-sprint.
 */
export function shortGloss(translation: string): string {
  return translation.split(';')[0]!.trim();
}
