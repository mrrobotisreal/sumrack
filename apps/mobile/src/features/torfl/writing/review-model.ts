import type { ExamResponse } from '@/db/repositories/exams';

import { WRITING_CRITERIA } from '../grading/writing';
import type { ExamCriterion } from '../model';

/**
 * Pure review derivations (T72): the five criterion rows of a writing
 * response — AI rows when scored, self rows when self-graded, else the
 * offline rows plus the two AI-only criteria as pending.
 */
export interface MergedCriterion extends ExamCriterion {
  source: 'ai' | 'self' | 'offline';
  pending: boolean;
}

export function mergedCriteria(
  response: Pick<ExamResponse, 'grading' | 'gradingStatus'>,
): MergedCriterion[] {
  const g = response.grading;
  const pick = (list: ExamCriterion[] | undefined, source: MergedCriterion['source']) =>
    new Map((list ?? []).map((c) => [c.id, { ...c, source, pending: false }]));
  const ai = response.gradingStatus === 'scored' ? pick(g?.ai?.criteria, 'ai') : new Map();
  const self =
    response.gradingStatus === 'self-graded' ? pick(g?.self?.criteria, 'self') : new Map();
  const offline = pick(g?.offline?.criteria, 'offline');
  return WRITING_CRITERIA.map((def) => {
    const hit = ai.get(def.id) ?? self.get(def.id) ?? offline.get(def.id);
    if (hit) return hit as MergedCriterion;
    return { id: def.id, score: 0, max: def.max, source: 'offline', pending: true };
  });
}
