import type { ExamSubtest } from '@sumrak/schema';

import type { TorflPrefs } from '../settings-core';

/**
 * Small pure rules the mock screens share (T71) — kept out of the components
 * so each has a unit test.
 */

/**
 * The dictionary rule (TORFL §1.3 decision 8): tap lookup is on only where the
 * official paper dictionary is allowed (`subtest.dictionary`) AND the learner
 * keeps the «lookup in mock reading» preference on (default on).
 */
export function dictionaryAllowed(
  subtest: Pick<ExamSubtest, 'dictionary'>,
  prefs: Pick<TorflPrefs, 'allowLookupInMockReading'>,
): boolean {
  return subtest.dictionary && prefs.allowLookupInMockReading;
}

/**
 * The `?devDurationSec=` override: honoured ONLY when `dev` is true (the
 * route passes `__DEV__`). In a release build it is always `undefined`.
 * Accepts whole seconds in [5, 7200].
 */
export function devDurationOverrideSec(raw: string | undefined, dev: boolean): number | undefined {
  if (!dev || raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 5 && n <= 7_200 ? n : undefined;
}

/** mm:ss for the top-bar timer (never negative). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export type TimerTone = 'normal' | 'amber' | 'red';

/** Timer colour: amber at ≤ 5:00 remaining, red at ≤ 1:00 (§8.2). */
export function timerTone(ms: number): TimerTone {
  if (ms <= 60_000) return 'red';
  if (ms <= 300_000) return 'amber';
  return 'normal';
}
