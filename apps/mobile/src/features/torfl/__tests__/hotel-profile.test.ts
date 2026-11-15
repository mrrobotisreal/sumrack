import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HOTEL_LEVEL,
  HOTEL_LADDER,
  HOTEL_LEVELS,
  HOTEL_PROFILES,
  hotelLevelOf,
  hotelLevelOfGatePack,
  hotelProfileFor,
  isHotelLevel,
  parseHotelBuilding,
} from '../hotel-profile';
import { TOPICS, TOPIC_ORDER } from '../topics';

/** The pre-T116 A1 constants (hotel-model PANEL_A1, gate-model GATE_PACK_ID / TOPIC_FLOOR, room-13). */
const PRE_T116_A1 = {
  panel: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15],
  gatePackId: 'a1-torfl-mock-004',
  gateExamId: 'a1-mock-04',
  roomTitle: 'Вариант 4 · полный экзамен ТРКИ-А1',
  roomDuration: '~2,5 часа',
  passedLabel: 'A1 пройден',
  achievementId: 'hotel-a1-complete',
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
};

describe('hotel profile table (T116, HOTEL_PATH_A2 §1 H1/H5)', () => {
  it('has the two buildings, A1 first and the default', () => {
    expect(HOTEL_LEVELS).toEqual(['A1', 'A2']);
    expect(DEFAULT_HOTEL_LEVEL).toBe('A1');
    expect(HOTEL_LADDER).toEqual(['A1', 'A2', 'B1', 'B2', 'C1']);
    for (const l of HOTEL_LEVELS) expect(HOTEL_PROFILES[l].level).toBe(l);
  });

  it('A1 is exactly the pre-T116 constants', () => {
    const a1 = HOTEL_PROFILES.A1;
    expect([...a1.panel]).toEqual(PRE_T116_A1.panel);
    expect(a1.gatePackId).toBe(PRE_T116_A1.gatePackId);
    expect(a1.gateExamId).toBe(PRE_T116_A1.gateExamId);
    expect(a1.chipLabel).toBe('ТРКИ-А1');
    expect(a1.shortLabel).toBe('А1');
    expect(a1.roomTitle).toBe(PRE_T116_A1.roomTitle);
    expect(a1.roomDuration).toBe(PRE_T116_A1.roomDuration);
    expect(a1.passedLabel).toBe(PRE_T116_A1.passedLabel);
    expect(a1.achievementId).toBe(PRE_T116_A1.achievementId);
    expect(a1.topicFloor).toEqual(PRE_T116_A1.topicFloor);
    expect(a1.topicPrefixFloor).toEqual([['lex-', 11]]);
  });

  it('A2 mirrors the A1 panel (H1) with its own gate, copy and achievement (H5)', () => {
    const a2 = HOTEL_PROFILES.A2;
    expect([...a2.panel]).toEqual(PRE_T116_A1.panel);
    expect(a2.panel).not.toContain(13);
    expect(a2.gatePackId).toBe('a2-torfl-mock-004');
    expect(a2.gateExamId).toBe('a2-mock-04');
    expect(a2.chipLabel).toBe('ТРКИ-А2');
    expect(a2.shortLabel).toBe('А2');
    expect(a2.roomTitle).toBe('Вариант 4 · полный экзамен ТРКИ-А2');
    expect(a2.passedLabel).toBe('A2 пройден');
    expect(a2.achievementId).toBe('hotel-a2-complete');
  });

  it('A2 topic → floor is the design §4.2 map', () => {
    expect(HOTEL_PROFILES.A2.topicFloor).toEqual({
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
    });
    expect(HOTEL_PROFILES.A2.topicPrefixFloor).toEqual([
      ['lex-', 11],
      ['write-', 12],
      ['read-', 14],
      ['listen-', 14],
      ['speak-', 15],
    ]);
  });

  it('every A2 topic slug of topics.ts lands on a panel floor (exact or prefix)', () => {
    const a2 = HOTEL_PROFILES.A2;
    for (const slug of TOPIC_ORDER) {
      const exact = a2.topicFloor[slug];
      const prefixed = a2.topicPrefixFloor.find(([p]) => slug.startsWith(p))?.[1];
      const floor = exact ?? prefixed;
      expect(floor, slug).toBeDefined();
      expect(a2.panel, slug).toContain(floor);
      // A lexgram topic never lands on a skill floor; a skill topic always does.
      const kind = TOPICS[slug].subtestKind;
      if (kind === 'lexgram') expect(floor! <= 11, slug).toBe(true);
      if (kind === 'writing') expect(floor, slug).toBe(12);
      if (kind === 'reading' || kind === 'listening') expect(floor, slug).toBe(14);
      if (kind === 'speaking') expect(floor, slug).toBe(15);
    }
  });

  it('no two buildings share a gate pack, gate exam or achievement', () => {
    const rows = HOTEL_LEVELS.map((l) => HOTEL_PROFILES[l]);
    for (const key of ['gatePackId', 'gateExamId', 'achievementId'] as const) {
      expect(new Set(rows.map((r) => r[key])).size).toBe(rows.length);
    }
  });
});

describe('hotel level helpers', () => {
  it('isHotelLevel accepts only the buildings', () => {
    expect(isHotelLevel('A1')).toBe(true);
    expect(isHotelLevel('A2')).toBe(true);
    expect(isHotelLevel('B1')).toBe(false);
    expect(isHotelLevel('a2')).toBe(false);
    expect(isHotelLevel(2)).toBe(false);
    expect(isHotelLevel(null)).toBe(false);
  });

  it('hotelLevelOf / hotelProfileFor fall back to the default building', () => {
    expect(hotelLevelOf('A2')).toBe('A2');
    expect(hotelLevelOf('B1')).toBe('A1');
    expect(hotelLevelOf(undefined)).toBe('A1');
    expect(hotelProfileFor('A2')).toBe(HOTEL_PROFILES.A2);
    expect(hotelProfileFor(null)).toBe(HOTEL_PROFILES.A1);
  });

  it('hotelLevelOfGatePack names the building whose Номер 13 a pack is', () => {
    expect(hotelLevelOfGatePack('a1-torfl-mock-004')).toBe('A1');
    expect(hotelLevelOfGatePack('a2-torfl-mock-004')).toBe('A2');
    expect(hotelLevelOfGatePack('a2-torfl-mock-003')).toBeNull();
    expect(hotelLevelOfGatePack('a2-hotel-f01')).toBeNull();
  });

  it('parseHotelBuilding heals anything that is not a building to A1', () => {
    expect(parseHotelBuilding('A2')).toBe('A2');
    expect(parseHotelBuilding('A1')).toBe('A1');
    expect(parseHotelBuilding('C1')).toBe('A1');
    expect(parseHotelBuilding(7)).toBe('A1');
    expect(parseHotelBuilding(null)).toBe('A1');
    expect(parseHotelBuilding({ level: 'A2' })).toBe('A1');
  });
});
