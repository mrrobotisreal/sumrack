import { describe, expect, it } from 'vitest';

import type { ScenarioFamily, ScenarioRung, ScenarioRunStats } from '@/db/repositories/scenarios';

import {
  cleanRatio,
  isClean,
  isResumable,
  nextRung,
  pickTodayScenario,
  rungChipState,
} from '../hub-selection';

function stats(turns: number, cleanTurns: number): ScenarioRunStats {
  return {
    turns,
    cleanTurns,
    misses: turns - cleanTurns,
    lifelines: 0,
    skips: 0,
    metaAsks: 0,
    rescues: 0,
    avgScore: 80,
  };
}

function rung(
  familyId: string,
  level: ScenarioRung['level'],
  bestStats: ScenarioRunStats | null,
  extra: Partial<ScenarioRung> = {},
): ScenarioRung {
  return {
    packId: `${familyId}-${level.toLowerCase()}`,
    id: `${familyId}-${level.toLowerCase()}`,
    familyId,
    titleRu: familyId,
    titleEn: familyId,
    level,
    language: 'ru',
    briefRu: '',
    briefEn: '',
    packTitleRu: '',
    packTitleEn: '',
    turnCount: 6,
    glossaryCount: 15,
    audioReady: true,
    runCount: bestStats ? 1 : 0,
    lastRun: null,
    bestStats,
    cast: [],
    scene: null,
    assets: [],
    ...extra,
  };
}

function families(...rungs: ScenarioRung[]): ScenarioFamily[] {
  const map = new Map<string, ScenarioRung[]>();
  for (const r of rungs) map.set(r.familyId, [...(map.get(r.familyId) ?? []), r]);
  return [...map.entries()].map(([familyId, rs]) => ({ familyId, rungs: rs }));
}

describe('Today card selection (§9.1)', () => {
  it('is null with no scenario pack installed', () => {
    expect(pickTodayScenario([])).toBeNull();
  });

  it('offers the first unplayed rung in hub order (families, then A1 → C1)', () => {
    const fams = families(
      rung('radio', 'A1', stats(4, 4)),
      rung('radio', 'A2', null),
      rung('doctor', 'A1', null),
    );
    expect(pickTodayScenario(fams)?.id).toBe('radio-a2');
  });

  it('falls back to the lowest clean ratio once every rung is finished; ties keep the earlier', () => {
    const fams = families(
      rung('radio', 'A1', stats(4, 2)), // 0.5
      rung('radio', 'A2', stats(5, 1)), // 0.2 ← lowest
      rung('doctor', 'A1', stats(5, 1)), // 0.2 tie → radio-a2 stays
    );
    expect(pickTodayScenario(fams)?.id).toBe('radio-a2');
  });

  it('a zero-turn best run counts as ratio 0 (never divides by zero)', () => {
    expect(cleanRatio(stats(0, 0))).toBe(0);
    expect(cleanRatio(null)).toBe(0);
    expect(cleanRatio(stats(4, 3))).toBe(0.75);
  });
});

describe('rung chips + resume + next level', () => {
  it('chip states: new / finished / clean', () => {
    expect(rungChipState(rung('r', 'A1', null))).toBe('new');
    expect(rungChipState(rung('r', 'A1', stats(4, 3)))).toBe('finished');
    expect(rungChipState(rung('r', 'A1', stats(4, 4)))).toBe('clean');
    expect(isClean(stats(0, 0))).toBe(false); // an empty run is not "clean"
  });

  it('resumable = an unfinished last run', () => {
    const open = { id: 'x', finishedAt: null } as unknown as ScenarioRung['lastRun'];
    const done = { id: 'x', finishedAt: 1 } as unknown as ScenarioRung['lastRun'];
    expect(isResumable(rung('r', 'A1', null, { lastRun: open }))).toBe(true);
    expect(isResumable(rung('r', 'A1', stats(1, 1), { lastRun: done }))).toBe(false);
    expect(isResumable(rung('r', 'A1', null))).toBe(false);
  });

  it('«Следующий уровень» = the next higher installed rung of the same family, else null', () => {
    const fams = families(
      rung('radio', 'A1', stats(4, 4)),
      rung('radio', 'B1', null),
      rung('doctor', 'A2', null),
    );
    expect(nextRung(fams, { familyId: 'radio', level: 'A1' })?.id).toBe('radio-b1');
    expect(nextRung(fams, { familyId: 'radio', level: 'B1' })).toBeNull();
    expect(nextRung(fams, { familyId: 'doctor', level: 'A2' })).toBeNull();
    expect(nextRung(fams, { familyId: 'bank', level: 'A1' })).toBeNull();
  });
});
