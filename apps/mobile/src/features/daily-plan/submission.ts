import { newId } from '@/db/ids';
import type { CompletedLearningSession } from '@/db/repositories/learning-sessions';
import { localDay } from '@/features/learning-evidence/model';
import { PLAN_MODE, type PlanOptions, type PlanTask } from './model';

/** Capture once at the Save action; retries reuse this same complete immutable value. */
export function capturePlanSubmission(
  options: PlanOptions,
  tasks: readonly PlanTask[],
): CompletedLearningSession {
  const at = Date.now();
  return {
    id: newId(),
    mode: PLAN_MODE,
    startedAt: at,
    endedAt: at,
    itemCount: 0,
    correctCount: 0,
    detail: {
      v: 1,
      day: localDay(at),
      options: { ...options },
      tasks: tasks.map((task) => ({ ...task })),
    },
  };
}
