/**
 * The TORFL level profile (T75, TORFL_A2_EXAM_PREP §5.1, ADR-0021 decision 3)
 * — PURE. One row per TORFL level holds every level-specific number and
 * label, so no screen hard-codes an A1 constant. A1's values are exactly the
 * pre-T75 constants (pinned by `__tests__/level-profile.test.ts`).
 *
 * THE LEVEL RULE: every TORFL surface takes a `TorflLevel` and filters by
 * it — an exam's level is `exams.level`; attempts / responses / deck cards
 * inherit it by join on `(pack_id, exam_id)`; prompts packs use
 * `packs.level`. Unknown or missing levels fall back to A1 (back-compat for
 * `/torfl` with no `?level=`, old deep links, old rows).
 *
 * T75 consumes: names, chip label, pass thresholds, pace, the exam-date key,
 * the category and the achievement ids. T76 wires the speaking caps, the
 * monologue defaults / sentence range, the fluency bands and `aiStandard`.
 */

export const TORFL_LEVELS = ['A1', 'A2'] as const;
export type TorflLevel = (typeof TORFL_LEVELS)[number];

/** The four level-scoped verdict achievements (A2-11). `torfl-deck-100` is cross-level and not here. */
export interface TorflAchievementIds {
  firstMock: string;
  wouldPass: string;
  margin: string;
  lexgram90: string;
}

export interface TorflLevelProfile {
  level: TorflLevel;
  /** ТЭУ / ТБУ — the official test name abbreviation. */
  code: string;
  /** «Элементарный уровень» / «Базовый уровень». */
  nameRu: string;
  nameEn: string;
  /** The Library chip / hub title / Today label: «ТРКИ-А1» / «ТРКИ-А2» (Cyrillic «А»). */
  chipLabel: string;
  /** The SPbU rule (A2-6): every subtest ≥ passPct, at most one in [borderlinePct, passPct). */
  passPct: number;
  borderlinePct: number;
  /** Real-exam pace, seconds per item (= subtest minutes × 60 ÷ items). */
  pace: { lexgram: number; reading: number; listening: number };
  /** The lexgram subtest the pace comes from (the «Молния» end-screen note «40 минут на 70 заданий»). */
  lexgramExam: { minutes: number; items: number };
  /** Говорение task 1 / task 2 answer caps (T76 wires). */
  speakingCapMs: { 1: number; 2: number };
  /** Monologue windows when the item carries none (T76 wires). */
  monologueDefaults: { prepSec: number; answerSec: number };
  /** Monologue length the task asks for (T76 wires). */
  monologueSentences: { min: number; max: number };
  /** Offline fluency bands, words per minute (T76 wires; A2 provisional until CT041 calibrates). */
  fluencyBands: { full: number; good: number; weak: number };
  /** The «HONEST …» standard line of both AI grading prompts (T76 wires). */
  aiStandard: string;
  /** The settings key holding this level's exam date. */
  examDateKey: 'torfl.examDate' | 'torfl.examDateA2';
  /** The Library category slug of this level's shelf. */
  category: 'torfl' | 'torfl-a2';
  achievements: TorflAchievementIds;
}

export const TORFL_PROFILES: Readonly<Record<TorflLevel, TorflLevelProfile>> = {
  A1: {
    level: 'A1',
    code: 'ТЭУ',
    nameRu: 'Элементарный уровень',
    nameEn: 'Elementary',
    chipLabel: 'ТРКИ-А1',
    passPct: 66,
    borderlinePct: 60,
    pace: { lexgram: 34, reading: 96, listening: 90 },
    lexgramExam: { minutes: 40, items: 70 },
    speakingCapMs: { 1: 30_000, 2: 40_000 },
    monologueDefaults: { prepSec: 480, answerSec: 120 },
    monologueSentences: { min: 10, max: 12 },
    fluencyBands: { full: 70, good: 45, weak: 25 },
    aiStandard: 'HONEST A1 (ТЭУ)',
    examDateKey: 'torfl.examDate',
    category: 'torfl',
    achievements: {
      firstMock: 'torfl-first-mock',
      wouldPass: 'torfl-would-pass',
      margin: 'torfl-margin',
      lexgram90: 'torfl-lexgram-90',
    },
  },
  A2: {
    level: 'A2',
    code: 'ТБУ',
    nameRu: 'Базовый уровень',
    nameEn: 'Basic',
    chipLabel: 'ТРКИ-А2',
    passPct: 66,
    borderlinePct: 60,
    pace: { lexgram: 30, reading: 100, listening: 72 },
    lexgramExam: { minutes: 50, items: 100 },
    speakingCapMs: { 1: 45_000, 2: 60_000 },
    monologueDefaults: { prepSec: 600, answerSec: 300 },
    monologueSentences: { min: 12, max: 15 },
    fluencyBands: { full: 80, good: 55, weak: 30 },
    aiStandard: 'HONEST A2 (ТБУ, базовый уровень)',
    examDateKey: 'torfl.examDateA2',
    category: 'torfl-a2',
    achievements: {
      firstMock: 'torfl-a2-first-mock',
      wouldPass: 'torfl-a2-would-pass',
      margin: 'torfl-a2-margin',
      lexgram90: 'torfl-a2-lexgram-90',
    },
  },
};

export function isTorflLevel(value: unknown): value is TorflLevel {
  return value === 'A1' || value === 'A2';
}

/** A level string (an exam's / pack's `level`, a route param) → its TORFL level; unknown → A1. */
export function torflLevelOf(level: string | null | undefined): TorflLevel {
  return isTorflLevel(level) ? level : 'A1';
}

/** The profile row for a level; unknown / missing → A1. */
export function profileFor(level: string | null | undefined): TorflLevelProfile {
  return TORFL_PROFILES[torflLevelOf(level)];
}

/**
 * The `?level=` route param → a level. Expo Router hands a string, an array
 * (repeated param) or undefined; the first value counts, case-insensitive,
 * Cyrillic «А» tolerated. Missing / unknown → A1.
 */
export function levelFromParam(param: string | readonly string[] | undefined): TorflLevel {
  const raw = Array.isArray(param) ? param[0] : param;
  if (typeof raw !== 'string') return 'A1';
  const norm = raw.trim().toUpperCase().replace('А', 'A');
  return torflLevelOf(norm);
}

/** Library category slug → its TORFL level (`torfl` → A1, `torfl-a2` → A2); other categories → null. */
export function levelForCategory(category: string | null | undefined): TorflLevel | null {
  for (const level of TORFL_LEVELS) {
    if (TORFL_PROFILES[level].category === category) return level;
  }
  return null;
}

/** True for both TORFL shelves. */
export function isTorflCategory(category: string | null | undefined): boolean {
  return levelForCategory(category) !== null;
}

// --- copy (one place builds every level-specific line) ------------------------------

function ruForm(n: number, forms: readonly [string, string, string]): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** The SPbU rule line (hub header): «Сдал: ≥ 66 % в каждом субтесте; один субтест — ≥ 60 %». */
export function ruleLine(level: TorflLevel): string {
  const p = TORFL_PROFILES[level];
  return `Сдал: ≥ ${p.passPct} % в каждом субтесте; один субтест — ≥ ${p.borderlinePct} %`;
}

/** Hub header subtitle: «Элементарный уровень · онлайн-экзамен СПбГУ». */
export function hubSubtitle(level: TorflLevel): string {
  return `${TORFL_PROFILES[level].nameRu} · онлайн-экзамен СПбГУ`;
}

/** Library hub-card title: «ТРКИ-А1 · Элементарный уровень». */
export function hubCardTitle(level: TorflLevel): string {
  const p = TORFL_PROFILES[level];
  return `${p.chipLabel} · ${p.nameRu}`;
}

/** The hub's «Молния» row caption: «20 заданий в темпе экзамена — 34 секунды на задание». */
export function lightningCaption(level: TorflLevel, items = 20): string {
  const s = TORFL_PROFILES[level].pace.lexgram;
  return `${items} заданий в темпе экзамена — ${s} ${ruForm(s, ['секунда', 'секунды', 'секунд'])} на задание`;
}

/** The «Молния» end-screen pace note: «Темп экзамена — 34 с (40 минут на 70 заданий).». */
export function lightningPaceNote(level: TorflLevel): string {
  const p = TORFL_PROFILES[level];
  const { minutes, items } = p.lexgramExam;
  return `Темп экзамена — ${p.pace.lexgram} с (${minutes} ${ruForm(minutes, ['минута', 'минуты', 'минут'])} на ${items} ${ruForm(items, ['задание', 'задания', 'заданий'])}).`;
}
