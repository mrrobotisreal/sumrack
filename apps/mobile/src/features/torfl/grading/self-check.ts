import { repos } from '@/db';
import { invalidateExams } from '@/db/hooks';
import { track } from '@/services/analytics';

import type { ExamResponse } from '@/db/repositories/exams';

import type { ExamGrading } from '../model';
import { recomputeAttemptResults } from './queue';
import {
  criteriaPercent,
  selfCheckCriteria,
  type SelfCheckId,
  type SelfCheckValue,
} from './writing';

/**
 * «Самопроверка» write path (T72, TORFL §6.2): fold the four answers with
 * the response's offline criteria into a full five-criterion set, store it
 * as `grading.self`, mark the row `self-graded` with the new points, then
 * recompute the attempt (gradedBy 'self', final). Returns the pct.
 */
export async function applySelfCheck(
  response: ExamResponse,
  answers: Record<SelfCheckId, SelfCheckValue>,
): Promise<number> {
  const prev: ExamGrading = response.grading ?? { v: 1 };
  const criteria = selfCheckCriteria(prev.offline?.criteria ?? [], answers);
  const pct = criteriaPercent(criteria);
  const { error: _error, ...kept } = prev;
  void _error;
  await repos.exams.setGrading(response.id, {
    points: Math.round((pct / 100) * response.maxPoints * 10) / 10,
    gradingStatus: 'self-graded',
    grading: { ...kept, self: { criteria } },
  });
  const d = prev.offline?.details as
    { sentences?: number; questions?: number; pointsCovered?: number } | undefined;
  track('exam_writing_scored', {
    source: 'self',
    pct,
    sentences: d?.sentences ?? -1,
    questions: d?.questions ?? -1,
    pointsCovered: d?.pointsCovered ?? -1,
  });
  await recomputeAttemptResults(response.attemptId);
  void invalidateExams();
  return pct;
}
