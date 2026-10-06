import type { Grade } from '@/db/repositories/reviews';

/**
 * The XP table (T19, §7.7) — every tunable number lives HERE, as data, so
 * rebalancing never needs a schema change or code hunt. Recorded in the
 * ticket session log; keep the two in sync if tuned.
 *
 * Consistency rule (ticket): every game mode funnels through an FSRS rating
 * (T06/T12/T13/T14 mapping decisions), so awarding XP *per rating* makes a
 * "Good" flashcard, MC answer, cloze fill, sentence build, listening pick,
 * and pronunciation attempt worth exactly the same by construction.
 */
export const XP_TABLE = {
  /** Per graded review, by ts-fsrs Rating (1 Again · 2 Hard · 3 Good · 4 Easy). */
  review: { 1: 1, 2: 2, 3: 3, 4: 4 } as Record<number, number>,
  /** Per full minute of reading (awarded when a reading session ends). */
  readingPerMin: 1,
  /** Finishing a story for the first time. */
  storyFinished: 15,
  /** Creating a journal entry (first save of a new entry). */
  journalEntry: 10,
  /** Creating a study note. */
  noteCreated: 5,
  /** Reading a unit lesson to the end (first time). */
  lessonCompleted: 10,
  /** First pass of a unit quiz. */
  unitQuizPassed: 25,
  /** First pass of a level checkpoint. */
  checkpointPassed: 50,
  /** Finishing a dialogue run (T27, V2 §3.3). */
  dialogueFinished: 20,
  /** First time a dialogue ending is collected (T27). */
  dialogueNewEnding: 10,
  /** Finishing a scenario run (M17/T62, SPEAKING_SCENARIOS §9.4). */
  scenarioFinished: 25,
  /** A clean scenario run: zero misses, lifelines, skips and rescues (T62). */
  scenarioCleanBonus: 15,
  /** Per clean turn inside a scenario run (T62). */
  scenarioCleanTurn: 2,
  /** Finishing a TORFL drill set or «Молния» round (M18/T70, TORFL §7.5) — once per session. */
  examDrillFinished: 10,
  /** Finishing a «Работа над ошибками» deck session, or the daily-session torfl segment (T70) — once per session. */
  examDeckSession: 5,
  /** A TORFL mock subtest scored (M18/T71, TORFL §7.5) — once per scored subtest, credited when the attempt finishes. */
  examSubtestFinished: 15,
  /** A full TORFL mock finished (T71). */
  examFullFinished: 60,
  /** The first pass / pass-borderline verdict ever (T71). */
  examFirstPass: 100,
  /** Bonus for unlocking any achievement. */
  achievementUnlocked: 20,
} as const;

export function xpForRating(rating: Grade): number {
  return XP_TABLE.review[rating] ?? 0;
}

export function xpForReading(ms: number): number {
  return Math.floor(ms / 60_000) * XP_TABLE.readingPerMin;
}

/**
 * Level curve: the climb from level n to n+1 costs 100 + 50·(n−1) XP —
 * L1→L2 100, L2→L3 150, L3→L4 200… Gentle early levels, slowly stretching,
 * never punishing (§7.7 spirit).
 */
export function xpToNextLevel(level: number): number {
  return 100 + 50 * (level - 1);
}

export interface LevelInfo {
  level: number;
  /** XP accumulated inside the current level. */
  intoLevel: number;
  /** XP needed to go from this level to the next. */
  levelSpan: number;
}

export function levelForXp(totalXp: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, totalXp);
  for (;;) {
    const span = xpToNextLevel(level);
    if (remaining < span) return { level, intoLevel: remaining, levelSpan: span };
    remaining -= span;
    level += 1;
    // Absurdity guard — nobody outgrinds this, but never loop unbounded.
    if (level >= 999) return { level, intoLevel: remaining, levelSpan: xpToNextLevel(level) };
  }
}

/**
 * XP for a finished scenario run (T62 §9.4): 25 for finishing, +15 when the
 * run was clean (zero lifelines/skips/rescues/misses), +2 per clean turn —
 * so a 4-turn clean run = 25 + 15 + 8 = 48, a dirty run with 2 clean turns
 * = 25 + 4 = 29.
 */
export function xpForScenarioRun(stats: { turns: number; cleanTurns: number }): number {
  const clean = stats.turns > 0 && stats.cleanTurns === stats.turns;
  return (
    XP_TABLE.scenarioFinished +
    (clean ? XP_TABLE.scenarioCleanBonus : 0) +
    XP_TABLE.scenarioCleanTurn * Math.max(0, stats.cleanTurns)
  );
}
