import type { Href } from 'expo-router';

import {
  clearLeechesProgress,
  isClearLeechesAvailable,
} from '@/features/dashboard/science/clear-leeches-quest';

/**
 * The daily quest slot — the kind REGISTRY and the ROTATION (T34, V2 §7.10).
 * Pure: no `@/db` import, no React; the orchestration that reads counters
 * and writes the day's row is `quest-service.ts`.
 *
 * REGISTRY SHAPE (recorded): a quest kind is
 *   { id, title, subtitle, icon, target(ctx), isAvailable(ctx), snapshot?(ctx),
 *     progress(ctx, row) → count, launch: Href }
 * where `ctx` is a small read-only facts bag the service gathers once
 * (availability inputs + today's counters). `isComplete` is derived:
 * progress ≥ target. A new kind is one new entry in QUEST_KINDS plus, if it
 * needs a fact the bag lacks, one new field on QuestContext — nothing else.
 *
 * Kinds (T34 + T38's clear-leeches):
 * - finish-a-story — finish ≥ 1 story today (first finish; story_progress)
 *   · available when an installed story is unfinished.
 * - pronunciation-5 — grade 5 pronunciation items today (review_log source
 *   'pronunciation') · available when the ASR model is installed and a
 *   production card exists.
 * - journal-1 — write 1 journal entry today · always available.
 * - dictation-set — finish 1 dictation session today (game_sessions mode
 *   'dictation') · available only once T33 ships dictation — the registry
 *   carries the kind, `QuestContext.dictationAvailable` stays false until
 *   then (recorded: T33 is ⬜ at T34's ship; flipping the flag + T33's mode
 *   string is the whole wiring).
 * - match-blitz — finish 1 full 60 s «Молния» sprint today (any score —
 *   recorded: "any run", not a threshold, so the quest never punishes a
 *   small bank) · available when the blitz pool can fill a board.
 * - numbers-round — finish 1 full numbers-drill round today (the ticket's
 *   "numbers drill also quest-launchable") · always available.
 * - clear-leeches (T38) — clear the leeches flagged at assignment ·
 *   available when the leech inbox is non-empty; the flagged card ids are
 *   snapshotted into the row; progress = cleared count.
 */

export type QuestKindId =
  | 'finish-a-story'
  | 'pronunciation-5'
  | 'journal-1'
  | 'dictation-set'
  | 'match-blitz'
  | 'numbers-round'
  | 'clear-leeches';

/** The facts every kind decides on — gathered once per evaluation by the service. */
export interface QuestContext {
  unfinishedStories: number;
  asrInstalled: boolean;
  productionCards: number;
  /** T33 dictation shipped (false until T33 lands). */
  dictationAvailable: boolean;
  blitzPoolSize: number;
  /** Leech inbox card ids visible right now (T38 rule + dismissals). */
  visibleLeechIds: readonly string[];
  today: {
    storiesFinished: number;
    pronunciationGrades: number;
    journalEntries: number;
    dictationSessions: number;
    blitzSprints: number;
    numbersRounds: number;
  };
}

/** The persisted day row, as the kinds see it. */
export interface QuestRowView {
  target: number;
  snapshot: readonly string[] | null;
}

export interface QuestKind {
  id: QuestKindId;
  title: string;
  subtitle: string;
  /** Ionicons name. */
  icon: string;
  isAvailable(ctx: QuestContext): boolean;
  target(ctx: QuestContext): number;
  /** Kind-owned state frozen at assignment (clear-leeches only). */
  snapshot?(ctx: QuestContext): string[];
  /** Count toward the row's target, from today's facts. */
  progress(ctx: QuestContext, row: QuestRowView): number;
  launch: Href;
}

/** The blitz pool needs this many words to run (mirrors blitz/engine MIN_BLITZ_POOL). */
export const QUEST_BLITZ_MIN_POOL = 6;
export const PRONUNCIATION_QUEST_TARGET = 5;

export const QUEST_KINDS: readonly QuestKind[] = [
  {
    id: 'finish-a-story',
    title: 'Finish a story',
    subtitle: 'Read one story to the end',
    icon: 'book-outline',
    isAvailable: (c) => c.unfinishedStories > 0,
    target: () => 1,
    progress: (c) => c.today.storiesFinished,
    launch: '/library',
  },
  {
    id: 'pronunciation-5',
    title: 'Say 5 phrases',
    subtitle: 'Five pronunciation items, out loud',
    icon: 'mic-outline',
    isAvailable: (c) => c.asrInstalled && c.productionCards > 0,
    target: () => PRONUNCIATION_QUEST_TARGET,
    progress: (c) => c.today.pronunciationGrades,
    launch: '/review/pronunciation',
  },
  {
    id: 'journal-1',
    title: 'Write in your journal',
    subtitle: 'One entry, any length',
    icon: 'create-outline',
    isAvailable: () => true,
    target: () => 1,
    progress: (c) => c.today.journalEntries,
    launch: { pathname: '/journal/[id]', params: { id: 'new' } },
  },
  {
    id: 'dictation-set',
    title: 'Dictation set',
    subtitle: 'Hear it, type it — one session',
    icon: 'ear-outline',
    isAvailable: (c) => c.dictationAvailable,
    target: () => 1,
    progress: (c) => c.today.dictationSessions,
    // T33 owns the route; the kind is never assigned until it exists.
    launch: '/games',
  },
  {
    id: 'match-blitz',
    title: 'Молния',
    subtitle: 'Run one 60-second match sprint',
    icon: 'flash-outline',
    isAvailable: (c) => c.blitzPoolSize >= QUEST_BLITZ_MIN_POOL,
    target: () => 1,
    progress: (c) => c.today.blitzSprints,
    launch: '/games/blitz',
  },
  {
    id: 'numbers-round',
    title: 'Числа',
    subtitle: 'One full round of the numbers drill',
    icon: 'calculator-outline',
    isAvailable: () => true,
    target: () => 1,
    progress: (c) => c.today.numbersRounds,
    launch: { pathname: '/games/numbers', params: { from: 'quest' } },
  },
  {
    id: 'clear-leeches',
    title: 'Clear your leeches',
    subtitle: 'Drill or dismiss every word flagged this morning',
    icon: 'bandage-outline',
    isAvailable: (c) => isClearLeechesAvailable(c.visibleLeechIds.length),
    target: (c) => c.visibleLeechIds.length,
    snapshot: (c) => [...c.visibleLeechIds],
    progress: (c, row) =>
      clearLeechesProgress(row.snapshot ?? [], new Set(c.visibleLeechIds)).cleared,
    launch: '/dashboard/leeches',
  },
];

export const QUEST_KINDS_BY_ID: ReadonlyMap<string, QuestKind> = new Map(
  QUEST_KINDS.map((k) => [k.id, k]),
);

/**
 * FNV-1a 32-bit over the day key — the deterministic hash behind the pick.
 * No Math.random: the same day always hashes the same, every render.
 */
export function hashDayKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * THE ROTATION RULE (recorded):
 * 1. candidates = available kinds, in registry order;
 * 2. none → no quest today (the ring stays two-segment);
 * 3. when MORE THAN 2 are available, yesterday's kind is removed (no
 *    repeat); with 1–2 available a repeat is allowed (never leave the day
 *    empty because of the rule);
 * 4. pick = candidates[hashDayKey(today) mod candidates.length].
 */
export function pickQuestKind(
  todayKey: string,
  available: readonly QuestKindId[],
  yesterdayKind: string | null,
): QuestKindId | null {
  const ordered = QUEST_KINDS.map((k) => k.id).filter((id) => available.includes(id));
  if (ordered.length === 0) return null;
  const candidates =
    ordered.length > 2 && yesterdayKind != null
      ? ordered.filter((id) => id !== yesterdayKind)
      : ordered;
  return candidates[hashDayKey(todayKey) % candidates.length]!;
}

/** Available kinds for a context, in registry order. */
export function availableKinds(ctx: QuestContext): QuestKindId[] {
  return QUEST_KINDS.filter((k) => k.isAvailable(ctx)).map((k) => k.id);
}

/** Clamp a kind's raw progress into [0, target]. */
export function questProgress(kind: QuestKind, ctx: QuestContext, row: QuestRowView): number {
  return Math.max(0, Math.min(row.target, kind.progress(ctx, row)));
}
