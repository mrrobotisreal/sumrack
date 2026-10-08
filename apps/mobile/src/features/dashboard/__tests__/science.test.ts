import { describe, expect, it } from 'vitest';

import { clearLeechesProgress, isClearLeechesAvailable } from '../science/clear-leeches-quest';
import { computeForecast, localDateKey } from '../science/forecast';
import { buildHeatmap, dayIntensity, heatLevel } from '../science/heatmap';
import { isLeech, isVisibleLeech, leechStat } from '../science/leeches';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('computeForecast', () => {
  const now = new Date(2026, 9, 9, 1, 30); // 2026-10-09 01:30 local

  it('buckets by local day; overdue lands in day 0; beyond-window → later', () => {
    const f = computeForecast(
      [
        { dueAt: at(2026, 9, 1), direction: 'ru-en' }, // overdue
        { dueAt: at(2026, 10, 9, 0), direction: 'ru-en' }, // overdue (00:00 today)
        { dueAt: at(2026, 10, 9, 23), direction: 'en-ru' }, // later today
        { dueAt: new Date(2026, 9, 10, 0, 0).getTime(), direction: 'ru-en' }, // midnight → day 1
        { dueAt: at(2026, 10, 12), direction: 'listening' },
        { dueAt: at(2026, 10, 12), direction: 'listening' },
        { dueAt: at(2026, 11, 7, 23), direction: 'ru-en' }, // offset 29, last in window
        { dueAt: at(2026, 11, 8, 0), direction: 'ru-en' }, // offset 30 → later
      ],
      now,
    );
    expect(f.days).toHaveLength(30);
    expect(f.days[0]).toMatchObject({ date: '2026-10-09', total: 3 });
    expect(f.days[0]!.byDirection).toEqual({ 'ru-en': 2, 'en-ru': 1 });
    expect(f.overdue).toBe(2);
    expect(f.days[1]).toMatchObject({ date: '2026-10-10', total: 1 });
    expect(f.days[3]).toMatchObject({ date: '2026-10-12', total: 2 });
    expect(f.days[29]).toMatchObject({ date: '2026-11-07', total: 1 });
    expect(f.later).toBe(1);
    expect(f.peak).toBe(3);
    expect(f.days.reduce((n, d) => n + d.total, 0) + f.later).toBe(8);
  });

  it('empty deck → zero days', () => {
    const f = computeForecast([], now);
    expect(f.peak).toBe(0);
    expect(f.days.every((d) => d.total === 0)).toBe(true);
  });

  it('survives a DST change (US fall-back inside the window keeps day keys contiguous)', () => {
    const f = computeForecast([], new Date(2026, 10, 1, 12));
    const keys = f.days.map((d) => d.date);
    expect(new Set(keys).size).toBe(30);
    expect(keys[0]).toBe('2026-11-01');
    expect(keys[1]).toBe('2026-11-02');
  });
});

describe('heatmap', () => {
  it('intensity = XP, falling back to the XP-table weights for xp-less rows', () => {
    expect(dayIntensity({ xp: 42, reviewsDone: 1, readingMs: 0, storiesFinished: 0 })).toBe(42);
    expect(dayIntensity({ xp: 0, reviewsDone: 5, readingMs: 180_000, storiesFinished: 1 })).toBe(
      5 + 3 + 15,
    );
  });

  it('fixed thresholds 1 / 20 / 50 / 100', () => {
    expect([0, 1, 19, 20, 49, 50, 99, 100, 400].map(heatLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it('53 Monday-first weeks ending in the current week; future cells flagged; month labels', () => {
    const now = new Date(2026, 9, 9, 10); // Friday
    const h = buildHeatmap(
      [
        { date: '2026-10-09', xp: 120, reviewsDone: 0, readingMs: 0, storiesFinished: 0 },
        { date: '2026-10-05', xp: 25, reviewsDone: 0, readingMs: 0, storiesFinished: 0 },
        { date: '2020-01-01', xp: 999, reviewsDone: 0, readingMs: 0, storiesFinished: 0 },
      ],
      now,
    );
    expect(h.weeks).toHaveLength(53);
    const last = h.weeks[52]!;
    expect(last[0]!.date).toBe('2026-10-05'); // Monday
    expect(last[0]!.level).toBe(2);
    expect(last[4]!).toMatchObject({ date: '2026-10-09', level: 4, future: false });
    expect(last[5]!.future).toBe(true);
    expect(last[6]!.future).toBe(true);
    expect(h.activeDays).toBe(2);
    expect(h.totalXp).toBe(145);
    expect(h.max).toEqual({ date: '2026-10-09', value: 120 });
    const [y, m, d] = h.weeks[0]![0]!.date.split('-').map(Number);
    expect(new Date(y!, m! - 1, d!).getDay()).toBe(1);
    // a month label sits on the first column whose MONDAY is in that month (Oct 5)
    expect(h.monthLabels.at(-1)).toEqual({ col: 52, label: 'окт' });
    expect(h.monthLabels.at(-2)).toEqual({ col: 48, label: 'сен' });
    expect(localDateKey(now)).toBe('2026-10-09');
  });
});

describe('leeches (pure)', () => {
  const hist = (ratings: number[]) => ratings.map((rating, i) => ({ rating, reviewedAt: i + 1 }));

  it('≥ 4 Agains among the newest 10', () => {
    expect(isLeech(leechStat(hist([1, 1, 1, 1])))).toBe(true);
    expect(isLeech(leechStat(hist([1, 1, 1])))).toBe(false);
    // 4 old Agains then 7 Goods: only 3 Agains remain in the newest 10
    expect(isLeech(leechStat(hist([1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3])))).toBe(false);
    expect(leechStat([])).toBeNull();
  });

  it('a dismissal hides it until a newer Again', () => {
    const s = leechStat(hist([1, 1, 1, 1, 3]))!; // last Again at 4
    expect(isVisibleLeech(s, null)).toBe(true);
    expect(isVisibleLeech(s, 4)).toBe(false);
    expect(isVisibleLeech(s, 3)).toBe(true);
  });
});

describe('clear-leeches quest kind', () => {
  it('available only with a non-empty inbox; completes when the snapshot is gone', () => {
    expect(isClearLeechesAvailable(0)).toBe(false);
    expect(isClearLeechesAvailable(2)).toBe(true);
    expect(clearLeechesProgress(['a', 'b'], new Set(['a', 'c']))).toEqual({
      cleared: 1,
      target: 2,
      complete: false,
    });
    expect(clearLeechesProgress(['a', 'b'], new Set(['c']))).toEqual({
      cleared: 2,
      target: 2,
      complete: true,
    });
    expect(clearLeechesProgress([], new Set()).complete).toBe(false);
  });
});
