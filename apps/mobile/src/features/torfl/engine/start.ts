import type { Exam } from '@sumrak/schema';

import type { Repositories } from '@/db/repositories';

import type { ExamAttempt } from '@/db/repositories/exams';
import type { ExamStartScope } from '../exam-intro-screen';
import { initialRunState, toPersisted } from './exam-machine';

/**
 * Creating a mock attempt (T71): the subtests of the chosen scope in the
 * exam's own order (the SPbU order for a full mock), the engine's initial
 * state, `startAttempt` with the single-active rule (`replace` abandons the
 * old attempt first). Pure planning + one repo call.
 */

export function mockSubtestIds(
  exam: Pick<Exam, 'subtests'>,
  scope: Exclude<ExamStartScope, { scope: 'drill' }>,
): string[] {
  if (scope.scope === 'full') return exam.subtests.map((s) => s.id);
  return exam.subtests.filter((s) => s.id === scope.subtestId).map((s) => s.id);
}

export async function startMockAttempt(
  exams: Pick<Repositories['exams'], 'startAttempt'>,
  exam: Exam,
  packId: string,
  scope: Exclude<ExamStartScope, { scope: 'drill' }>,
  opts: { replace?: boolean; now?: number } = {},
): Promise<ExamAttempt> {
  const subtestIds = mockSubtestIds(exam, scope);
  if (subtestIds.length === 0) throw new Error(`no subtest in scope for exam "${exam.id}"`);
  return exams.startAttempt(
    {
      packId,
      examId: exam.id,
      scope: scope.scope,
      subtestIds,
      mode: 'mock',
      state: toPersisted(initialRunState(exam, subtestIds)),
      now: opts.now,
    },
    { replace: opts.replace },
  );
}
