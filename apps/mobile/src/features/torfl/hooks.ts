import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { repos } from '@/db';
import { useExamAttempts, useExams, usePacks, useStories } from '@/db/hooks';
import { localDateKey } from '@/db/repositories/stats';
import { track } from '@/services/analytics';

import {
  buildExamListItems,
  daysOutProp,
  groupTexts,
  type ExamListItem,
  type TextGroup,
} from './hub-model';
import type { ExamMode } from './model';
import { getExamDate, setExamDate } from './settings';

/**
 * «ТРКИ» screen hooks (T69): composition over the T68 `db/hooks` exam
 * queries — no DB access of their own beyond the settings accessors.
 */

/** Library / hub exam rows: every installed exam with its best finished attempt. */
export function useExamListItems(mode?: ExamMode): {
  items: ExamListItem[];
  isPending: boolean;
} {
  const exams = useExams(mode ? { mode } : {});
  const attempts = useExamAttempts({ limit: 500 });
  const items = React.useMemo(
    () => buildExamListItems(exams.data ?? [], attempts.data ?? []),
    [exams.data, attempts.data],
  );
  return { items, isPending: exams.isPending };
}

const EXAM_DATE_KEY = ['torfl', 'exam-date'] as const;

/**
 * The exam date (`torfl.examDate`) + today's local day key. `setDate`
 * persists (null clears) and fires `torfl_exam_date_set {daysOut}`.
 * `today` is re-read on every render, so a screen kept open over midnight
 * shows the new count on its next render.
 */
export function useExamDate() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: EXAM_DATE_KEY, queryFn: getExamDate });
  const setDate = React.useCallback(
    async (date: string | null) => {
      await setExamDate(date);
      queryClient.setQueryData(EXAM_DATE_KEY, date);
      track('torfl_exam_date_set', { daysOut: daysOutProp(date, localDateKey()) });
    },
    [queryClient],
  );
  return { date: query.data ?? null, today: localDateKey(), setDate, isPending: query.isPending };
}

/**
 * «Тексты» (TORFL §5.3): every story of the installed exam packs, grouped by
 * the subtest that references it, with an audio flag per story.
 */
export function useExamTexts(): { groups: TextGroup[]; total: number; isPending: boolean } {
  const exams = useExams();
  const stories = useStories();
  const packs = usePacks();
  const examPackIds = React.useMemo(
    () => (packs.data ?? []).filter((p) => p.type === 'exam').map((p) => p.id),
    [packs.data],
  );
  const audio = useQuery({
    queryKey: ['exams', 'texts-audio', examPackIds.join(',')],
    queryFn: () => repos.content.listStoryKeysWithAudio(examPackIds),
  });
  const groups = React.useMemo(
    () => groupTexts(exams.data ?? [], stories.data ?? [], audio.data ?? new Set<string>()),
    [exams.data, stories.data, audio.data],
  );
  return {
    groups,
    total: groups.reduce((n, g) => n + g.texts.length, 0),
    isPending: exams.isPending || stories.isPending,
  };
}
