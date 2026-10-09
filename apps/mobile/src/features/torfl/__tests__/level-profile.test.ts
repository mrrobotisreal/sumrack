import { describe, expect, it } from 'vitest';

import {
  TORFL_LEVELS,
  TORFL_PROFILES,
  hubCardTitle,
  hubSubtitle,
  isTorflCategory,
  isTorflLevel,
  levelForCategory,
  levelFromParam,
  lightningCaption,
  lightningPaceNote,
  profileFor,
  ruleLine,
  torflLevelOf,
} from '../level-profile';
import { SPBU_RULE_LINE } from '../hub-model';
import { PACE_SEC, LIGHTNING_PACE_SEC, paceFor, lightningPaceSec } from '../pace';
import { BORDERLINE_PCT, PASS_PCT } from '../verdict';
import { WPM_BANDS } from '../grading/speaking';
import { SPEAKING_CAP_MS } from '../engine/exam-machine';

describe('A1 profile ≡ the pre-T75 constants', () => {
  const a1 = TORFL_PROFILES.A1;

  it('pass thresholds, pace and the lexgram exam', () => {
    expect(a1.passPct).toBe(66);
    expect(a1.borderlinePct).toBe(60);
    expect(a1.pace).toEqual({ lexgram: 34, reading: 96, listening: 90 });
    expect(a1.lexgramExam).toEqual({ minutes: 40, items: 70 });
  });

  it('speaking, monologue and fluency numbers', () => {
    expect(a1.speakingCapMs).toEqual(SPEAKING_CAP_MS);
    expect(a1.speakingCapMs).toEqual({ 1: 30_000, 2: 40_000 });
    expect(a1.monologueDefaults).toEqual({ prepSec: 480, answerSec: 120 });
    expect(a1.monologueSentences).toEqual({ min: 10, max: 12 });
    expect(a1.fluencyBands).toEqual(WPM_BANDS);
    expect(a1.aiStandard).toBe('HONEST A1 (ТЭУ)');
  });

  it('identity, keys and achievement ids', () => {
    expect(a1.examDateKey).toBe('torfl.examDate');
    expect(a1.category).toBe('torfl');
    expect(a1.chipLabel).toBe('ТРКИ-А1');
    expect(a1.code).toBe('ТЭУ');
    expect(a1.nameRu).toBe('Элементарный уровень');
    expect(a1.achievements).toEqual({
      firstMock: 'torfl-first-mock',
      wouldPass: 'torfl-would-pass',
      margin: 'torfl-margin',
      lexgram90: 'torfl-lexgram-90',
    });
  });

  it('the old named exports still read the same values', () => {
    expect(PASS_PCT).toBe(66);
    expect(BORDERLINE_PCT).toBe(60);
    expect(PACE_SEC).toEqual({ lexgram: 34, reading: 96, listening: 90 });
    expect(LIGHTNING_PACE_SEC).toBe(34);
    expect(SPBU_RULE_LINE).toBe('Сдал: ≥ 66 % в каждом субтесте; один субтест — ≥ 60 %');
  });
});

describe('A2 profile = TORFL_A2 §5.1', () => {
  const a2 = TORFL_PROFILES.A2;

  it('identity and copy', () => {
    expect(a2.code).toBe('ТБУ');
    expect(a2.nameRu).toBe('Базовый уровень');
    expect(a2.nameEn).toBe('Basic');
    expect(a2.chipLabel).toBe('ТРКИ-А2');
    expect(a2.aiStandard).toBe('HONEST A2 (ТБУ, базовый уровень)');
    expect(a2.examDateKey).toBe('torfl.examDateA2');
    expect(a2.category).toBe('torfl-a2');
  });

  it('thresholds, pace, exam, speaking, monologue and fluency', () => {
    expect(a2.passPct).toBe(66);
    expect(a2.borderlinePct).toBe(60);
    expect(a2.pace).toEqual({ lexgram: 30, reading: 100, listening: 72 });
    expect(a2.lexgramExam).toEqual({ minutes: 50, items: 100 });
    expect(a2.speakingCapMs).toEqual({ 1: 45_000, 2: 60_000 });
    expect(a2.monologueDefaults).toEqual({ prepSec: 600, answerSec: 300 });
    expect(a2.monologueSentences).toEqual({ min: 12, max: 15 });
    expect(a2.fluencyBands).toEqual({ full: 80, good: 55, weak: 30 });
  });

  it('achievement ids', () => {
    expect(a2.achievements).toEqual({
      firstMock: 'torfl-a2-first-mock',
      wouldPass: 'torfl-a2-would-pass',
      margin: 'torfl-a2-margin',
      lexgram90: 'torfl-a2-lexgram-90',
    });
  });
});

describe('pace = minutes × 60 ÷ items', () => {
  it('A2 lexgram 50·60/100, reading 50·60/30, listening 30·60/25', () => {
    expect((50 * 60) / 100).toBe(30);
    expect(Math.round((50 * 60) / 30)).toBe(100);
    expect(Math.round((30 * 60) / 25)).toBe(72);
    expect(paceFor('A2')).toEqual({ lexgram: 30, reading: 100, listening: 72 });
  });

  it('A1 lexgram round(40·60/70), reading 40·60/25, listening 30·60/20', () => {
    expect(Math.round((40 * 60) / 70)).toBe(34);
    expect((40 * 60) / 25).toBe(96);
    expect((30 * 60) / 20).toBe(90);
    expect(paceFor('A1')).toEqual({ lexgram: 34, reading: 96, listening: 90 });
  });
});

describe('level resolution', () => {
  it('profileFor: A1 / A2 map to themselves; everything else → A1', () => {
    expect(profileFor('A1')).toBe(TORFL_PROFILES.A1);
    expect(profileFor('A2')).toBe(TORFL_PROFILES.A2);
    expect(profileFor('B1')).toBe(TORFL_PROFILES.A1);
    expect(profileFor('')).toBe(TORFL_PROFILES.A1);
    expect(profileFor(undefined)).toBe(TORFL_PROFILES.A1);
    expect(profileFor(null)).toBe(TORFL_PROFILES.A1);
  });

  it('torflLevelOf mirrors profileFor', () => {
    expect(torflLevelOf('A2')).toBe('A2');
    expect(torflLevelOf('A1')).toBe('A1');
    expect(torflLevelOf('B1')).toBe('A1');
    expect(torflLevelOf(undefined)).toBe('A1');
    expect(torflLevelOf(null)).toBe('A1');
  });

  it('isTorflLevel is case-sensitive', () => {
    expect(isTorflLevel('A2')).toBe(true);
    expect(isTorflLevel('a2')).toBe(false);
    expect(isTorflLevel('B1')).toBe(false);
  });

  it('TORFL_LEVELS and each profile.level match its key', () => {
    expect(TORFL_LEVELS).toEqual(['A1', 'A2']);
    for (const level of TORFL_LEVELS) {
      expect(TORFL_PROFILES[level].level).toBe(level);
    }
  });

  it('levelFromParam tolerates arrays, case, spaces and Cyrillic А', () => {
    expect(levelFromParam(undefined)).toBe('A1');
    expect(levelFromParam('A2')).toBe('A2');
    expect(levelFromParam('a2')).toBe('A2');
    expect(levelFromParam(' A2 ')).toBe('A2');
    expect(levelFromParam('А2')).toBe('A2');
    expect(levelFromParam(['A2', 'A1'])).toBe('A2');
    expect(levelFromParam([])).toBe('A1');
    expect(levelFromParam('B1')).toBe('A1');
    expect(levelFromParam('')).toBe('A1');
    expect(levelFromParam('A1')).toBe('A1');
  });

  it('levelForCategory and isTorflCategory cover both shelves only', () => {
    expect(levelForCategory('torfl')).toBe('A1');
    expect(levelForCategory('torfl-a2')).toBe('A2');
    expect(levelForCategory('stories')).toBeNull();
    expect(levelForCategory(null)).toBeNull();
    expect(levelForCategory(undefined)).toBeNull();
    expect(isTorflCategory('torfl')).toBe(true);
    expect(isTorflCategory('torfl-a2')).toBe(true);
    expect(isTorflCategory('education')).toBe(false);
  });
});

describe('copy builders', () => {
  it('ruleLine is the same SPbU rule for both levels', () => {
    const rule = 'Сдал: ≥ 66 % в каждом субтесте; один субтест — ≥ 60 %';
    expect(ruleLine('A1')).toBe(rule);
    expect(ruleLine('A2')).toBe(rule);
  });

  it('hubSubtitle and hubCardTitle', () => {
    expect(hubSubtitle('A1')).toBe('Элементарный уровень · онлайн-экзамен СПбГУ');
    expect(hubSubtitle('A2')).toBe('Базовый уровень · онлайн-экзамен СПбГУ');
    expect(hubCardTitle('A1')).toBe('ТРКИ-А1 · Элементарный уровень');
    expect(hubCardTitle('A2')).toBe('ТРКИ-А2 · Базовый уровень');
  });

  it('lightningCaption', () => {
    expect(lightningCaption('A1')).toBe('20 заданий в темпе экзамена — 34 секунды на задание');
    expect(lightningCaption('A2')).toBe('20 заданий в темпе экзамена — 30 секунд на задание');
  });

  it('lightningPaceNote', () => {
    expect(lightningPaceNote('A1')).toBe('Темп экзамена — 34 с (40 минут на 70 заданий).');
    expect(lightningPaceNote('A2')).toBe('Темп экзамена — 30 с (50 минут на 100 заданий).');
  });

  it('lightningPaceSec defaults to A1', () => {
    expect(lightningPaceSec()).toBe(34);
    expect(lightningPaceSec('A1')).toBe(34);
    expect(lightningPaceSec('A2')).toBe(30);
  });
});
