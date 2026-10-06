import type { Exam, WritingItem } from '@sumrak/schema';

import type { ExamSummaryLike } from '../hub-model';

/**
 * Writing practice catalog (T72, TORFL §8.3 practice mode) — PURE: every
 * writing item of every installed exam (drill sets first, then mocks — a
 * mock's letter task is as good a practice prompt as any once it has been
 * sat, and before that it is still the exact exam format), with the pack /
 * exam it lives in. The hub «Тренировки → Письмо» tab lists these.
 */
export interface WritingPracticeEntry {
  packId: string;
  examId: string;
  examTitleRu: string;
  mode: 'drill' | 'mock';
  subtestId: string;
  item: WritingItem;
}

export function writingPracticeEntries(
  summaries: readonly ExamSummaryLike[],
): WritingPracticeEntry[] {
  const out: WritingPracticeEntry[] = [];
  const push = (s: ExamSummaryLike, exam: Exam) => {
    for (const subtest of exam.subtests) {
      if (subtest.kind !== 'writing') continue;
      for (const item of subtest.parts.flatMap((p) => p.items)) {
        if (item.kind !== 'writing') continue;
        out.push({
          packId: s.packId,
          examId: s.examId,
          examTitleRu: s.titleRu,
          mode: s.mode,
          subtestId: subtest.id,
          item,
        });
      }
    }
  };
  for (const s of summaries) if (s.exam && s.mode === 'drill') push(s, s.exam);
  for (const s of summaries) if (s.exam && s.mode === 'mock') push(s, s.exam);
  return out;
}

/** The practice route params (`app/torfl/writing.tsx`). */
export function writingPracticeHref(e: Pick<WritingPracticeEntry, 'packId' | 'examId' | 'item'>): {
  pathname: '/torfl/writing';
  params: Record<string, string>;
} {
  return {
    pathname: '/torfl/writing',
    params: { packId: e.packId, examId: e.examId, itemId: e.item.id },
  };
}
