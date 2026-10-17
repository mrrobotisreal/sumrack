import type { CourseItem } from '@sumrak/schema';

import { passes, weakestUnit, type PassKind } from '../hotel-model';

/**
 * The exercise runner's pure rules (T90, decisions 2–5, 7–9). One engine,
 * three modes:
 *
 * - `unit`  — the unit pool; feedback after every answer; a fail offers an
 *   immediate retry with a different draw (D13).
 * - `floor` — the floor-exam pool; exam conditions: no feedback, no
 *   translation, free navigation, a review after submit, a cooldown on fail.
 * - `extern` — the floor-exam pool, cold, ≥ 90 % (D12).
 *
 * This module decides; the screens render it and `repos.course` writes it.
 * The runner never writes SQL.
 */

export type RunMode = 'unit' | 'floor' | 'extern';

/**
 * Item kinds the runner serves and scores: the drill views plus writing (T92d,
 * the offline-graded letter). Speaking is still deferred: it needs the live mic
 * recorder and the AI judge, which T93 verifies on the device.
 */
const SERVED_KINDS = new Set(['choice', 'typed', 'trigger', 'transform', 'writing']);

/** True when the runner must skip an item (speaking, until its recorder is wired). */
export function isDeferredItem(item: Pick<CourseItem, 'kind'>): boolean {
  return !SERVED_KINDS.has(item.kind);
}

/** The items of a drawn set the runner serves, in order, plus the ids it skipped. */
export function servableItems(items: readonly CourseItem[]): {
  served: CourseItem[];
  deferred: string[];
} {
  const served: CourseItem[] = [];
  const deferred: string[] = [];
  for (const item of items) {
    if (isDeferredItem(item)) deferred.push(item.id);
    else served.push(item);
  }
  return { served, deferred };
}

/** Feedback after every answer in unit mode only (decision 4). */
export function showsFeedback(mode: RunMode): boolean {
  return mode === 'unit';
}

/** The translation toggle: unit mode only (decision 3). */
export function allowsTranslation(mode: RunMode): boolean {
  return mode === 'unit';
}

/** «Объясни ещё»: in unit feedback and in a review; never mid-exam (decision 6). */
export function allowsExplainMore(mode: RunMode, phase: 'run' | 'review'): boolean {
  return mode === 'unit' || phase === 'review';
}

/** Feedback verdict from an item's points: full, half («Почти») or wrong. */
export type Verdict = 'full' | 'half' | 'wrong';

export function verdictOf(points: number): Verdict {
  if (points >= 1) return 'full';
  if (points > 0) return 'half';
  return 'wrong';
}

/** A retry must never repeat the same set (D13). True when the two draws hold the same ids. */
export function isIdenticalDraw(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** A finished unit run. `firstPass` drives the one-time +10 XP (decision 8). */
export interface UnitOutcome {
  percent: number;
  passed: boolean;
  /** Ids of drawn items the learner did not get fully right, in draw order. */
  missed: string[];
  firstPass: boolean;
}

export function unitOutcome(input: {
  percent: number;
  drawn: readonly string[];
  points: Readonly<Record<string, number>>;
  alreadyPassed: boolean;
}): UnitOutcome {
  const passed = passes('unit', input.percent);
  const missed = input.drawn.filter((id) => (input.points[id] ?? 0) < 1);
  return { percent: input.percent, passed, missed, firstPass: passed && !input.alreadyPassed };
}

/** A finished floor or экстерн run: the verdict, the cooldown a fail starts, the weakest unit (decision 5). */
export interface ExamOutcome {
  percent: number;
  passed: boolean;
  kind: Exclude<PassKind, 'unit'>;
  /** Minutes of cooldown after a fail (floor 20, экстерн 60); 0 on a pass. */
  cooldownMinutes: number;
  /** The unit to send the learner back to after a floor fail; null otherwise. */
  weakestUnitId: string | null;
  missed: string[];
}

export function examOutcome(input: {
  kind: Exclude<PassKind, 'unit'>;
  percent: number;
  drawn: readonly string[];
  points: Readonly<Record<string, number>>;
  units: readonly { id: string; items: readonly string[] }[];
}): ExamOutcome {
  const passed = passes(input.kind, input.percent);
  const missed = input.drawn.filter((id) => (input.points[id] ?? 0) < 1);
  return {
    percent: input.percent,
    passed,
    kind: input.kind,
    cooldownMinutes: passed ? 0 : input.kind === 'extern' ? 60 : 20,
    weakestUnitId: input.kind === 'floor' && !passed ? weakestUnit(input.units, missed) : null,
    missed,
  };
}
