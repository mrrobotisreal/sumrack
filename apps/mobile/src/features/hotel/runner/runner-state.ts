import type { CourseItem } from '@sumrak/schema';

import type { ResponseEntry } from '@/db/repositories/course';
import { scoreAttempt } from '../hotel-model';

import { type RunMode, servableItems } from './runner-model';

/**
 * The runner's in-memory sitting (T90): the drawn items, the responses so far,
 * the cursor and the phase. Pure transitions; the screen persists the
 * responses through `repos.course.saveResponses` so a kill can resume.
 */
export interface RunnerState {
  mode: RunMode;
  /** The drawn item ids, in order. Deferred (writing/speaking) ids are excluded from scoring. */
  itemIds: string[];
  /** Items the runner skipped (T92 grades them); reported, never scored. */
  deferred: string[];
  responses: Record<string, ResponseEntry>;
  cursor: number;
  phase: 'run' | 'review';
}

export function startRun(
  mode: RunMode,
  items: readonly CourseItem[],
  drawn: readonly string[],
): RunnerState {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = drawn.map((id) => byId.get(id)).filter((i): i is CourseItem => i !== undefined);
  const { served, deferred } = servableItems(ordered);
  return {
    mode,
    itemIds: served.map((i) => i.id),
    deferred,
    responses: {},
    cursor: 0,
    phase: 'run',
  };
}

/** Record an answer; `correct` comes from the T89 scorer. A later answer to the same item replaces it (exam modes allow changing). */
export function answer(state: RunnerState, item: CourseItem, value: number | string): RunnerState {
  if (state.phase !== 'run') return state;
  const score = scoreAttempt([item], { [item.id]: { answer: value } });
  const entry: ResponseEntry = {
    answer: value,
    correct: score.items[0]?.correct ?? false,
    half: score.items[0]?.points === 0.5 ? true : undefined,
  };
  return { ...state, responses: { ...state.responses, [item.id]: entry } };
}

/** Move the cursor, clamped. Unit mode moves by the feedback «Далее»; exam modes move freely. */
export function moveTo(state: RunnerState, index: number): RunnerState {
  const last = Math.max(0, state.itemIds.length - 1);
  return { ...state, cursor: Math.min(Math.max(0, index), last) };
}

/** Ids the learner has not answered yet (the «Сдать» confirm counts these). */
export function unanswered(state: RunnerState): string[] {
  return state.itemIds.filter((id) => state.responses[id] === undefined);
}

/** The percent over the served items (blank counts as wrong), via the T89 scorer. */
export function percentOf(
  state: RunnerState,
  items: readonly CourseItem[],
): { percent: number; points: Record<string, number> } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const scored = state.itemIds
    .map((id) => byId.get(id))
    .filter((i): i is CourseItem => i !== undefined);
  const responses: Record<string, { answer: unknown } | undefined> = {};
  for (const id of state.itemIds) responses[id] = state.responses[id];
  const score = scoreAttempt(scored, responses);
  const points: Record<string, number> = {};
  for (const s of score.items) points[s.itemId] = s.points;
  return { percent: score.percent, points };
}

/** Enter the review after a floor/экстерн submit. */
export function submit(state: RunnerState): RunnerState {
  return { ...state, phase: 'review' };
}
