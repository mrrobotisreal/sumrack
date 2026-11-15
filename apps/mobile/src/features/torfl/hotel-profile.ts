import { isTorflLevel, TORFL_PROFILES, type TorflLevel } from './level-profile';

/**
 * The hotel's per-building table (T116, HOTEL_PATH_A2 §1 H1/H5, §2) — PURE.
 * One row per TORFL building of «Отель «Сумрак»» holds every fact that
 * differs between buildings: the panel, Номер 13's gate pack + exam, the
 * room copy, the passed line, the achievement and the debrief topic → floor
 * map. No other file names a gate id or a building literal; everything reads
 * `hotelProfileFor(level)`.
 *
 * A1's values are exactly the pre-T116 constants (PANEL_A1, GATE_PACK_ID,
 * room-13's GATE_EXAM_ID + copy, TOPIC_FLOOR), pinned by
 * `__tests__/hotel-profile.test.ts`.
 */

/** The hotel's buildings, bottom to top. The first one is the default building. */
export const HOTEL_LEVELS = ['A1', 'A2'] as const satisfies readonly TorflLevel[];
export type HotelLevel = (typeof HOTEL_LEVELS)[number];

/** The building the hotel opens in when nothing is saved (`hotel.building` default). */
export const DEFAULT_HOTEL_LEVEL: HotelLevel = HOTEL_LEVELS[0];

/** The whole ladder the header shows (`A1 ● — A2 ● — B1 ○ — B2 ○ — C1 ○`); only HOTEL_LEVELS can be lit. */
export const HOTEL_LADDER = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type LadderRung = (typeof HOTEL_LADDER)[number];

export type HotelAchievementId = 'hotel-a1-complete' | 'hotel-a2-complete';

export interface HotelProfile {
  level: HotelLevel;
  /** D5 / H1: the panel floors in order — 0 (Вестибюль), 1–12, 14, 15; there is no 13. */
  panel: readonly number[];
  /** Номер 13 = the building's unseen full mock (tag `torfl:gate`). */
  gatePackId: string;
  /** The gate mock's exam id inside `gatePackId` (the mock intro route). */
  gateExamId: string;
  /** «ТРКИ-А1» / «ТРКИ-А2» (Cyrillic «А»): the hotel header. */
  chipLabel: string;
  /** «А1» / «А2» (Cyrillic «А»): the lift indicator during a building switch and the Today prefix. */
  shortLabel: string;
  /** The room's exam line: «Вариант 4 · полный экзамен ТРКИ-А1». */
  roomTitle: string;
  /** The room's duration line (Σ subtest minutes of the gate mock). */
  roomDuration: string;
  /** «A1 пройден» / «A2 пройден» (the room's pass state; Today adds « ✓»). */
  passedLabel: string;
  achievementId: HotelAchievementId;
  /** The Номер 13 debrief: an exact topic slug → the floor to revisit. */
  topicFloor: Readonly<Record<string, number>>;
  /** Topic-prefix fallbacks, tried in order after `topicFloor` (`lex-*` → 11 …). */
  topicPrefixFloor: readonly (readonly [prefix: string, floor: number])[];
}

const PANEL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15] as const;

export const HOTEL_PROFILES: Readonly<Record<HotelLevel, HotelProfile>> = {
  A1: {
    level: 'A1',
    panel: PANEL,
    gatePackId: 'a1-torfl-mock-004',
    gateExamId: 'a1-mock-04',
    chipLabel: TORFL_PROFILES.A1.chipLabel,
    shortLabel: 'А1',
    roomTitle: `Вариант 4 · полный экзамен ${TORFL_PROFILES.A1.chipLabel}`,
    roomDuration: '~2,5 часа',
    passedLabel: 'A1 пройден',
    achievementId: 'hotel-a1-complete',
    // HOTEL_PATH D6 (T92), unchanged.
    topicFloor: {
      'case-prep': 3,
      'case-acc': 4,
      'verb-aspect': 5,
      'case-gen': 6,
      'case-dat': 7,
      'case-instr': 8,
      'verb-motion': 9,
      conj: 10,
      'lex-verbs': 11,
      'lex-family': 11,
      'lex-negation': 11,
      agr: 1,
      pron: 1,
      'verb-forms': 2,
      writing: 12,
      reading: 14,
      listening: 14,
      speaking: 15,
    },
    topicPrefixFloor: [['lex-', 11]],
  },
  A2: {
    level: 'A2',
    panel: PANEL,
    gatePackId: 'a2-torfl-mock-004',
    gateExamId: 'a2-mock-04',
    chipLabel: TORFL_PROFILES.A2.chipLabel,
    shortLabel: 'А2',
    roomTitle: `Вариант 4 · полный экзамен ${TORFL_PROFILES.A2.chipLabel}`,
    roomDuration: '~3,5 часа',
    passedLabel: 'A2 пройден',
    achievementId: 'hotel-a2-complete',
    // HOTEL_PATH_A2 §4.2 (the slug spellings of features/torfl/topics.ts).
    topicFloor: {
      agr: 1,
      'case-plural': 1,
      numerals: 2,
      'case-time': 2,
      'case-gen': 3,
      'case-acc': 3,
      'case-dat': 4,
      'case-instr': 4,
      'case-prep': 4,
      pron: 5,
      comparative: 5,
      'lex-negation': 5,
      'verb-aspect': 6,
      'verb-forms': 7,
      'verb-motion': 8,
      'verb-motion-prefix': 9,
      conj: 10,
      clauses: 10,
      'lex-verbs': 11,
      'lex-family': 11,
      'lex-phrases': 11,
      writing: 12,
      reading: 14,
      listening: 14,
      speaking: 15,
    },
    topicPrefixFloor: [
      ['lex-', 11],
      ['write-', 12],
      ['read-', 14],
      ['listen-', 14],
      ['speak-', 15],
    ],
  },
};

export function isHotelLevel(value: unknown): value is HotelLevel {
  return isTorflLevel(value) && (HOTEL_LEVELS as readonly string[]).includes(value);
}

/** The building of a level string; unknown / missing → the default building. */
export function hotelLevelOf(level: string | null | undefined): HotelLevel {
  return isHotelLevel(level) ? level : DEFAULT_HOTEL_LEVEL;
}

/** The profile row of a building; unknown / missing → the default building. */
export function hotelProfileFor(level: string | null | undefined): HotelProfile {
  return HOTEL_PROFILES[hotelLevelOf(level)];
}

/** The building whose Номер 13 is this pack, or null (every other pack). */
export function hotelLevelOfGatePack(packId: string): HotelLevel | null {
  return HOTEL_LEVELS.find((l) => HOTEL_PROFILES[l].gatePackId === packId) ?? null;
}

/** `hotel.building` as stored: a building id; anything else heals to the default. */
export function parseHotelBuilding(raw: unknown): HotelLevel {
  return typeof raw === 'string' ? hotelLevelOf(raw) : DEFAULT_HOTEL_LEVEL;
}
