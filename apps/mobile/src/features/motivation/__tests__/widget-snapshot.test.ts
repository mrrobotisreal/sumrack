import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  WIDGET_PREFS_NAME,
  WIDGET_SNAPSHOT_KEY,
  WIDGET_SNAPSHOT_VERSION,
  WIDGET_STALE_MS,
} from '../widget-contract';
import {
  buildWidgetSnapshot,
  goalFraction,
  isStale,
  WidgetSnapshotSchema,
  type WidgetSnapshot,
} from '../widget-snapshot';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KOTLIN_DIR = path.resolve(
  HERE,
  '../../../../modules/sumrak-widget/android/src/main/java/expo/modules/sumrakwidget',
);

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

function base(overrides: Partial<Parameters<typeof buildWidgetSnapshot>[0]> = {}) {
  return buildWidgetSnapshot({
    streak: 3,
    dueCount: 12,
    reviewsDone: 10,
    readingMs: 4 * 60_000 + 30_000,
    goal: { reviews: 20, readingMin: 10 },
    goalMet: false,
    continueReading: { packId: 'a1-pack', storyId: 'story-1', title: 'Тестовая история' },
    now: NOW,
    ...overrides,
  });
}

/** A snapshot literal with explicit goal fields, for goalFraction math. */
function withGoal(goal: Partial<WidgetSnapshot['goal']>): WidgetSnapshot {
  return {
    ...base(),
    goal: {
      reviewsDone: 0,
      reviewsTarget: 0,
      readingMinDone: 0,
      readingMinTarget: 0,
      met: false,
      ...goal,
    },
  };
}

describe('buildWidgetSnapshot', () => {
  it('builds the v1 shape with floored reading minutes and the given counters', () => {
    const s = base();
    expect(s).toEqual({
      v: WIDGET_SNAPSHOT_VERSION,
      streak: 3,
      dueCount: 12,
      goal: {
        reviewsDone: 10,
        reviewsTarget: 20,
        readingMinDone: 4,
        readingMinTarget: 10,
        met: false,
      },
      continueReading: { packId: 'a1-pack', storyId: 'story-1', title: 'Тестовая история' },
      updatedAtMs: NOW,
    });
    expect(s.goal).not.toHaveProperty('questProgress');
  });

  it('floors reading milliseconds to whole minutes (59.9 s = 0 min)', () => {
    expect(base({ readingMs: 59_999 }).goal.readingMinDone).toBe(0);
    expect(base({ readingMs: 60_000 }).goal.readingMinDone).toBe(1);
  });

  it('passes goalMet and a null continueReading through', () => {
    const s = base({ goalMet: true, continueReading: null });
    expect(s.goal.met).toBe(true);
    expect(s.continueReading).toBeNull();
  });

  it('clamps negative counters to zero rather than emitting an invalid snapshot', () => {
    const s = base({ streak: -1, dueCount: -5, reviewsDone: -2 });
    expect(s.streak).toBe(0);
    expect(s.dueCount).toBe(0);
    expect(s.goal.reviewsDone).toBe(0);
  });
});

describe('WidgetSnapshotSchema', () => {
  const valid = {
    v: 1,
    streak: 0,
    dueCount: 0,
    goal: {
      reviewsDone: 0,
      reviewsTarget: 0,
      readingMinDone: 0,
      readingMinTarget: 0,
      met: false,
    },
    continueReading: null,
    updatedAtMs: NOW,
  };

  it('accepts a well-formed snapshot, including the optional questProgress', () => {
    expect(WidgetSnapshotSchema.safeParse(valid).success).toBe(true);
    expect(
      WidgetSnapshotSchema.safeParse({ ...valid, goal: { ...valid.goal, questProgress: 0.5 } })
        .success,
    ).toBe(true);
  });

  it('rejects a wrong version, a string where a number belongs, and unknown keys', () => {
    expect(WidgetSnapshotSchema.safeParse({ ...valid, v: 2 }).success).toBe(false);
    expect(WidgetSnapshotSchema.safeParse({ ...valid, streak: 'oops' }).success).toBe(false);
    expect(WidgetSnapshotSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it('rejects negative, fractional, and out-of-range values', () => {
    expect(WidgetSnapshotSchema.safeParse({ ...valid, dueCount: -1 }).success).toBe(false);
    expect(WidgetSnapshotSchema.safeParse({ ...valid, streak: 1.5 }).success).toBe(false);
    expect(
      WidgetSnapshotSchema.safeParse({ ...valid, goal: { ...valid.goal, questProgress: 1.2 } })
        .success,
    ).toBe(false);
  });

  it('rejects a malformed continueReading', () => {
    expect(
      WidgetSnapshotSchema.safeParse({ ...valid, continueReading: { packId: 'p' } }).success,
    ).toBe(false);
  });
});

describe('goalFraction', () => {
  it('is the mean of the enabled parts', () => {
    const s = withGoal({
      reviewsDone: 10,
      reviewsTarget: 20,
      readingMinDone: 10,
      readingMinTarget: 10,
    });
    expect(goalFraction(s)).toBeCloseTo(0.75);
  });

  it('uses only the enabled part when one target is zero', () => {
    expect(goalFraction(withGoal({ reviewsDone: 5, reviewsTarget: 20 }))).toBeCloseTo(0.25);
    expect(goalFraction(withGoal({ readingMinDone: 5, readingMinTarget: 10 }))).toBeCloseTo(0.5);
  });

  it('clamps an over-goal part to 1', () => {
    expect(goalFraction(withGoal({ reviewsDone: 50, reviewsTarget: 20 }))).toBe(1);
    expect(
      goalFraction(
        withGoal({ reviewsDone: 50, reviewsTarget: 20, readingMinDone: 0, readingMinTarget: 10 }),
      ),
    ).toBeCloseTo(0.5);
  });

  it('is a half when exactly half of the single enabled target is done', () => {
    expect(goalFraction(withGoal({ reviewsDone: 10, reviewsTarget: 20 }))).toBe(0.5);
  });

  it('with both targets zero, is met → 1 and not met → 0', () => {
    expect(goalFraction(withGoal({ met: true }))).toBe(1);
    expect(goalFraction(withGoal({ met: false }))).toBe(0);
  });
});

describe('isStale', () => {
  it('is fresh exactly at 36 h and stale one millisecond past it', () => {
    const s = base({ now: NOW });
    expect(isStale(s, NOW + WIDGET_STALE_MS)).toBe(false);
    expect(isStale(s, NOW + WIDGET_STALE_MS + 1)).toBe(true);
  });

  it('is fresh for a just-written snapshot', () => {
    expect(isStale(base({ now: NOW }), NOW)).toBe(false);
  });
});

describe('contract drift guard', () => {
  const store = readFileSync(path.join(KOTLIN_DIR, 'WidgetContract.kt'), 'utf8');
  const snapshotStore = readFileSync(path.join(KOTLIN_DIR, 'SnapshotStore.kt'), 'utf8');

  it('the Kotlin prefs name and key equal the TS constants', () => {
    expect(store).toContain(`const val PREFS_NAME = "${WIDGET_PREFS_NAME}"`);
    expect(store).toContain(`const val KEY_SNAPSHOT = "${WIDGET_SNAPSHOT_KEY}"`);
  });

  it('the Kotlin version and stale window equal the TS constants', () => {
    expect(store).toContain(`const val SNAPSHOT_VERSION = ${WIDGET_SNAPSHOT_VERSION}`);
    expect(store).toContain(`const val STALE_MS = 36L * 3600_000L`);
    expect(WIDGET_STALE_MS).toBe(36 * 3600_000);
  });

  it('the Kotlin parser reads every JSON field the TS schema writes', () => {
    for (const field of [
      '"v"',
      '"streak"',
      '"dueCount"',
      '"goal"',
      '"continueReading"',
      '"updatedAtMs"',
      '"reviewsDone"',
      '"reviewsTarget"',
      '"readingMinDone"',
      '"readingMinTarget"',
      '"met"',
    ]) {
      expect(snapshotStore).toContain(field);
    }
  });
});
