import { describe, expect, it } from 'vitest';

import { inQuietHours, DEFAULT_NOTIFICATION_PREFS } from '../notification-prefs';
import { planNewContent, planReminders } from '../notification-plan';

/**
 * Planner tests build local Dates directly (whatever TZ vitest runs in) —
 * the planner only compares wall-clock hours and instants, mirroring how
 * the device schedules against its own local clock.
 */
const PREFS = { ...DEFAULT_NOTIFICATION_PREFS, enabled: true };

function at(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 7, day, hour, minute); // August 2026, local time
}

function baseInput(now: Date) {
  return {
    now,
    prefs: PREFS,
    mornings: [
      { date: at(23, 9), dueCount: 12 },
      { date: at(24, 9), dueCount: 0 },
      { date: at(25, 9), dueCount: 3 },
    ],
    evenings: [at(22, 20), at(23, 20)],
    streakDays: 4,
    goalMetToday: false,
  };
}

describe('planReminders (T19)', () => {
  it('master toggle off ⇒ empty plan', () => {
    expect(planReminders({ ...baseInput(at(22, 12)), prefs: DEFAULT_NOTIFICATION_PREFS })).toEqual(
      [],
    );
  });

  it('mornings only fire when cards are due; due counts land in the body', () => {
    const plan = planReminders(baseInput(at(22, 12)));
    const mornings = plan.filter((p) => p.id.startsWith('t19-morning'));
    expect(mornings.map((m) => m.id)).toEqual(['t19-morning-2026-08-23', 't19-morning-2026-08-25']);
    expect(mornings[0]!.body).toContain('12 cards');
    expect(mornings[0]!.screen).toBe('today');
  });

  it('evening streak-at-risk fires today when goal unmet and streak live', () => {
    const plan = planReminders(baseInput(at(22, 12)));
    const evenings = plan.filter((p) => p.id.startsWith('t19-evening'));
    expect(evenings).toHaveLength(1);
    expect(evenings[0]!.id).toBe('t19-evening-2026-08-22');
    expect(evenings[0]!.body).toContain('4-day streak');
  });

  it('goal met today ⇒ tonight is silent, tomorrow pre-armed', () => {
    const plan = planReminders({ ...baseInput(at(22, 12)), goalMetToday: true });
    const evenings = plan.filter((p) => p.id.startsWith('t19-evening'));
    expect(evenings.map((e) => e.id)).toEqual(['t19-evening-2026-08-23']);
  });

  it('no streak ⇒ no streak-at-risk at all', () => {
    const plan = planReminders({ ...baseInput(at(22, 12)), streakDays: 0 });
    expect(plan.filter((p) => p.id.startsWith('t19-evening'))).toHaveLength(0);
  });

  it('past fire times are dropped (evening already gone)', () => {
    const plan = planReminders(baseInput(at(22, 21)));
    expect(plan.filter((p) => p.id.startsWith('t19-evening'))).toHaveLength(0);
  });

  it('quiet hours push a morning reminder to the quiet end', () => {
    const prefs = { ...PREFS, morningHour: 7, quietStartHour: 22, quietEndHour: 8 };
    const plan = planReminders({
      ...baseInput(at(22, 12)),
      prefs,
      mornings: [{ date: at(23, 7), dueCount: 5 }],
    });
    const morning = plan.find((p) => p.id.startsWith('t19-morning'))!;
    expect(morning.date.getHours()).toBe(8);
    expect(morning.date.getDate()).toBe(23);
  });

  it('quiet hours pull an evening reminder before the quiet start', () => {
    const prefs = { ...PREFS, eveningHour: 23, quietStartHour: 22, quietEndHour: 8 };
    const plan = planReminders({
      ...baseInput(at(22, 12)),
      prefs,
      evenings: [at(22, 23), at(23, 23)],
    });
    const evening = plan.find((p) => p.id.startsWith('t19-evening'))!;
    expect(evening.date.getHours()).toBe(21);
    expect(evening.date.getMinutes()).toBe(45);
  });
});

describe('planNewContent (T19)', () => {
  it('fires outside quiet hours with a count', () => {
    const item = planNewContent({ now: at(22, 12), prefs: PREFS, installedCount: 2 });
    expect(item?.screen).toBe('library');
    expect(item?.body).toContain('2 new content packs');
  });

  it('suppressed in quiet hours, when disabled, and when nothing installed', () => {
    expect(planNewContent({ now: at(22, 23), prefs: PREFS, installedCount: 2 })).toBeNull();
    expect(
      planNewContent({ now: at(22, 12), prefs: DEFAULT_NOTIFICATION_PREFS, installedCount: 2 }),
    ).toBeNull();
    expect(planNewContent({ now: at(22, 12), prefs: PREFS, installedCount: 0 })).toBeNull();
  });
});

describe('inQuietHours', () => {
  const prefs = { ...PREFS, quietStartHour: 22, quietEndHour: 8 };
  it('handles a window spanning midnight', () => {
    expect(inQuietHours(prefs, at(22, 23))).toBe(true);
    expect(inQuietHours(prefs, at(23, 3))).toBe(true);
    expect(inQuietHours(prefs, at(23, 8))).toBe(false);
    expect(inQuietHours(prefs, at(23, 12))).toBe(false);
  });
  it('same start/end disables the window', () => {
    expect(inQuietHours({ ...prefs, quietStartHour: 8, quietEndHour: 8 }, at(23, 3))).toBe(false);
  });
  it('handles a same-day window', () => {
    const day = { ...prefs, quietStartHour: 13, quietEndHour: 15 };
    expect(inQuietHours(day, at(23, 14))).toBe(true);
    expect(inQuietHours(day, at(23, 15))).toBe(false);
  });
});
