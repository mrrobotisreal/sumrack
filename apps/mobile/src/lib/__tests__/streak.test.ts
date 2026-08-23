import { describe, expect, it } from 'vitest';

import { addDaysToKey, diffDayKeys, isDayKey } from '../dates';
import { computeStreak, gapNeedingFreezes, type StreakDays } from '../streak';

function days(met: string[] = [], frozen: string[] = []): StreakDays {
  return { met: new Set(met), frozen: new Set(frozen) };
}

describe('day-key arithmetic (T19)', () => {
  it('adds across month/year boundaries', () => {
    expect(addDaysToKey('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysToKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysToKey('2026-02-28', 1)).toBe('2026-03-01'); // not a leap year
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });

  it('is DST-immune (UTC-noon pinning): US spring-forward day counts as one day', () => {
    expect(addDaysToKey('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDaysToKey('2026-03-08', 1)).toBe('2026-03-09');
    expect(diffDayKeys('2026-03-09', '2026-03-07')).toBe(2);
  });

  it('validates key shape', () => {
    expect(isDayKey('2026-08-22')).toBe(true);
    expect(isDayKey('2026-8-22')).toBe(false);
  });
});

describe('computeStreak (T19 §7.7)', () => {
  it('is 0 with no history', () => {
    expect(computeStreak('2026-08-22', days())).toEqual({ current: 0, todayCounted: false });
  });

  it('anchors at yesterday while today is still unmet (no premature break)', () => {
    const d = days(['2026-08-20', '2026-08-21']);
    expect(computeStreak('2026-08-22', d)).toEqual({ current: 2, todayCounted: false });
  });

  it('counts today once met', () => {
    const d = days(['2026-08-21', '2026-08-22']);
    expect(computeStreak('2026-08-22', d)).toEqual({ current: 2, todayCounted: true });
  });

  it('a 2-day-old gap means the streak is broken', () => {
    const d = days(['2026-08-18', '2026-08-19']);
    expect(computeStreak('2026-08-22', d).current).toBe(0);
  });

  it('frozen days extend the walk exactly like met days', () => {
    const d = days(['2026-08-19', '2026-08-22'], ['2026-08-20', '2026-08-21']);
    expect(computeStreak('2026-08-22', d)).toEqual({ current: 4, todayCounted: true });
  });
});

describe('gapNeedingFreezes (T19 freeze consumption)', () => {
  it('null when yesterday already counts', () => {
    expect(gapNeedingFreezes('2026-08-22', days(['2026-08-21']), 2)).toBeNull();
  });

  it('covers a single missed day when affordable', () => {
    const d = days(['2026-08-20']);
    expect(gapNeedingFreezes('2026-08-22', d, 1)).toEqual(['2026-08-21']);
  });

  it('covers two missed days with two freezes (oldest last)', () => {
    const d = days(['2026-08-19']);
    expect(gapNeedingFreezes('2026-08-22', d, 2)).toEqual(['2026-08-21', '2026-08-20']);
  });

  it('null (and no waste) when the gap exceeds the wallet', () => {
    const d = days(['2026-08-19']);
    expect(gapNeedingFreezes('2026-08-22', d, 1)).toBeNull();
  });

  it('null when there is no prior streak to save', () => {
    expect(gapNeedingFreezes('2026-08-22', days(), 2)).toBeNull();
  });

  it('null with an empty wallet', () => {
    expect(gapNeedingFreezes('2026-08-22', days(['2026-08-20']), 0)).toBeNull();
  });

  it('already-frozen days block the gap like met days', () => {
    const d = days(['2026-08-20'], ['2026-08-21']);
    expect(gapNeedingFreezes('2026-08-22', d, 2)).toBeNull();
  });
});

/**
 * The ticket's travel case: America/Denver ↔ Europe/Vienna (Salzburg zone).
 * Day identity = the local calendar date AT EVENT TIME in whatever timezone
 * the device is in. We derive keys via Intl for real instants and feed them
 * to the engine — exactly what localDateKey does on the device.
 */
describe('timezone travel case (Denver ↔ Vienna)', () => {
  function keyInTz(utcIso: string, timeZone: string): string {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(utcIso));
  }

  it('flying east never falsely breaks or double-counts', () => {
    // Goal met Thu Aug 20, 7pm in Denver (UTC Aug 21 01:00).
    const k1 = keyInTz('2026-08-21T01:00:00Z', 'America/Denver');
    expect(k1).toBe('2026-08-20');
    // Landed; goal met Fri Aug 21, 9pm in Vienna (UTC 19:00) — only ~18h
    // of real time later, but a distinct local calendar day.
    const k2 = keyInTz('2026-08-21T19:00:00Z', 'Europe/Vienna');
    expect(k2).toBe('2026-08-21');

    const met = days([k1, k2]);
    // Sat morning in Vienna: streak is 2, nothing broken, nothing doubled.
    const today = keyInTz('2026-08-22T07:00:00Z', 'Europe/Vienna');
    expect(computeStreak(today, met)).toEqual({ current: 2, todayCounted: false });
    expect(gapNeedingFreezes(today, met, 2)).toBeNull();
  });

  it('flying west revisits a calendar day without double-counting it', () => {
    // Goal met Sat Aug 22, 10am in Vienna (UTC 08:00).
    const k1 = keyInTz('2026-08-22T08:00:00Z', 'Europe/Vienna');
    // Landed in Denver the same real day, 3pm local (UTC 21:00) — the wall
    // calendar says Aug 22 AGAIN; more activity lands on the same key.
    const k2 = keyInTz('2026-08-22T21:00:00Z', 'America/Denver');
    expect(k1).toBe('2026-08-22');
    expect(k2).toBe('2026-08-22');

    // Set semantics merge the revisited day — it can only count once.
    const met = days(['2026-08-21', k1, k2]);
    expect(met.met.size).toBe(2);
    expect(computeStreak('2026-08-22', met)).toEqual({ current: 2, todayCounted: true });
  });
});
