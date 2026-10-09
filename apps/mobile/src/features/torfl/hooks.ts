import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { repos } from '@/db';
import {
  useExamAttempts,
  useExamDeckCounts,
  useExamTopicStats,
  useExams,
  usePacks,
  useStories,
} from '@/db/hooks';
import { localDateKey } from '@/db/repositories/stats';
import { trackTorfl } from '@/services/analytics';

import {
  buildExamListItems,
  buildTopicTiles,
  daysOutProp,
  groupTexts,
  type ExamListItem,
  type TextGroup,
  type TopicTile,
} from './hub-model';
import {
  computeReadiness,
  latestMockPcts,
  predictedLine,
  recommendToday,
  type PredictedLine,
  type ReadinessRow,
  type TodayStep,
} from './readiness';
import { stepAction, type TodayAction, type TopicTarget } from './today';
import { SUBTEST_ORDER } from './topics';
import type { ExamSubtestKind } from '@sumrak/schema';
import type { TorflLevel } from './level-profile';
import type { ExamMode } from './model';
import { getExamDate, setExamDate } from './settings';

/**
 * «ТРКИ» screen hooks (T69): composition over the T68 `db/hooks` exam
 * queries — no DB access of their own beyond the settings accessors.
 */

/**
 * Library / hub exam rows: every installed exam with its best finished attempt.
 * `level` (T75) narrows both to one TORFL level; absent = every level (the Library shelves by pack).
 */
export function useExamListItems(
  mode?: ExamMode,
  level?: TorflLevel,
): {
  items: ExamListItem[];
  isPending: boolean;
} {
  const exams = useExams({ mode, level });
  const attempts = useExamAttempts({ limit: 500, level });
  const items = React.useMemo(
    () => buildExamListItems(exams.data ?? [], attempts.data ?? []),
    [exams.data, attempts.data],
  );
  return { items, isPending: exams.isPending };
}

/** The exam-date query key of one level (T75): `['torfl', 'exam-date', level]`. */
function examDateKey(level: TorflLevel) {
  return ['torfl', 'exam-date', level] as const;
}

/**
 * One level's exam date (`torfl.examDate` for A1, `torfl.examDateA2` for A2)
 * + today's local day key. `setDate` persists (null clears) and fires
 * `torfl_exam_date_set {daysOut, level}`.
 * `today` is re-read on every render, so a screen kept open over midnight
 * shows the new count on its next render.
 */
export function useExamDate(level: TorflLevel = 'A1') {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: examDateKey(level),
    queryFn: () => getExamDate(level),
  });
  const setDate = React.useCallback(
    async (date: string | null) => {
      await setExamDate(date, level);
      queryClient.setQueryData(examDateKey(level), date);
      trackTorfl('torfl_exam_date_set', { daysOut: daysOutProp(date, localDateKey()), level });
    },
    [queryClient, level],
  );
  return { date: query.data ?? null, today: localDateKey(), setDate, isPending: query.isPending };
}

/** Both levels' exam dates side by side (T75). */
export function useExamDates(): {
  A1: ReturnType<typeof useExamDate>;
  A2: ReturnType<typeof useExamDate>;
} {
  return { A1: useExamDate('A1'), A2: useExamDate('A2') };
}

/**
 * «Тексты» (TORFL §5.3): every story of the installed exam packs, grouped by
 * the subtest that references it, with an audio flag per story. `level`
 * (T75) limits the texts to packs that have exams of that level.
 */
export function useExamTexts(level: TorflLevel = 'A1'): {
  groups: TextGroup[];
  total: number;
  isPending: boolean;
} {
  const exams = useExams({ level });
  const stories = useStories();
  const packs = usePacks();
  const examPackIds = React.useMemo(
    () => (packs.data ?? []).filter((p) => p.type === 'exam').map((p) => p.id),
    [packs.data],
  );
  const audio = useQuery({
    queryKey: ['exams', 'texts-audio', level, examPackIds.join(',')],
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

// --- T70: readiness, deck and «Сегодня» ----------------------------------------------

/** Per-kind accuracy over the last 200 objective responses (the readiness drill estimate). */
export function useExamRecentAccuracy(level: TorflLevel = 'A1') {
  return useQuery({
    queryKey: ['exams', 'recent-accuracy', level],
    queryFn: () => repos.exams.recentAccuracy({ level }),
  });
}

export interface TorflToday {
  /** The level this «Сегодня» / hub view is for (T75). */
  level: TorflLevel;
  isPending: boolean;
  /** Five readiness rows in official order (also the hub card's mini-bars). */
  readiness: ReadinessRow[];
  predicted: PredictedLine;
  deckDue: number;
  deckTotal: number;
  step: TodayStep | null;
  action: TodayAction | null;
  /** Topic tiles per subtest (drill exams). */
  tiles: Record<ExamSubtestKind, TopicTile[]>;
  /** topic slug → accuracy % over every scored answer (null = never answered). */
  accuracyByTopic: Map<string, number>;
  hasLightning: boolean;
  mockInstalled: boolean;
}

/**
 * Everything the hub, its Library card and the Today «ТРКИ» card show,
 * computed once from the T68 queries through the pure `readiness.ts` /
 * `today.ts` (no screen re-derives any of it).
 */
export function useTorflToday(level: TorflLevel = 'A1'): TorflToday {
  const exams = useExams({ level });
  const attempts = useExamAttempts({ limit: 500, level });
  const recent = useExamRecentAccuracy(level);
  const topicStats = useExamTopicStats({ level });
  const deck = useExamDeckCounts(level);
  // Render-pure «now»: readiness windows are days wide, so "as of the newest fetch" is exact
  // enough (and refetches on every hub focus / session end).
  const asOf = Math.max(
    attempts.dataUpdatedAt,
    recent.dataUpdatedAt,
    topicStats.dataUpdatedAt,
    deck.dataUpdatedAt,
  );

  return React.useMemo(() => {
    const now = asOf > 0 ? asOf : 0;
    const readiness = computeReadiness({
      now,
      mocks: latestMockPcts(attempts.data ?? []),
      drills: recent.data ?? {},
    });
    const tiles = buildTopicTiles(exams.data ?? []);
    const topicsByKind: Partial<Record<ExamSubtestKind, ReadonlySet<string>>> = {};
    const firstTopicOfKind: Partial<Record<ExamSubtestKind, string>> = {};
    const byTopic = new Map<string, TopicTarget>();
    for (const kind of SUBTEST_ORDER) {
      topicsByKind[kind] = new Set(tiles[kind].map((t) => t.topic));
      const first = tiles[kind][0];
      if (first) firstTopicOfKind[kind] = first.topic;
      for (const t of tiles[kind]) byTopic.set(t.topic, { packId: t.packId, examId: t.examId });
    }
    const stats = topicStats.data ?? [];
    const finished = (attempts.data ?? []).filter(
      (a) => a.status === 'finished' && a.mode === 'mock' && a.finishedAt !== null,
    );
    const lastMockAt = finished.reduce<number | null>(
      (m, a) => (m === null || a.finishedAt! > m ? a.finishedAt : m),
      null,
    );
    const deckDue = deck.data?.due ?? 0;
    const step = recommendToday({
      rows: readiness,
      topicsByKind,
      topicStats: stats,
      deckDue,
      lastMockAt,
      now,
      mockInstalled: (exams.data ?? []).some((e) => e.mode === 'mock'),
    });
    const accuracyByTopic = new Map(
      stats
        .filter((s) => s.answered > 0)
        .map((s) => [s.topic, Math.round((s.correct / s.answered) * 100)]),
    );
    return {
      level,
      isPending: exams.isPending || attempts.isPending,
      readiness,
      predicted: predictedLine(readiness, level),
      deckDue,
      deckTotal: deck.data?.total ?? 0,
      step,
      action: step ? stepAction(step, byTopic, firstTopicOfKind) : null,
      tiles,
      accuracyByTopic,
      hasLightning: tiles.lexgram.length > 0,
      mockInstalled: (exams.data ?? []).some((e) => e.mode === 'mock'),
    };
  }, [
    level,
    exams.data,
    exams.isPending,
    attempts.data,
    attempts.isPending,
    recent.data,
    topicStats.data,
    deck.data,
    asOf,
  ]);
}

/**
 * Both levels' «Сегодня» side by side (T75). Fixed call order, so the hook
 * rules hold: A1's hooks always run before A2's.
 */
export function useTorflLevelsToday(): { A1: TorflToday; A2: TorflToday } {
  return { A1: useTorflToday('A1'), A2: useTorflToday('A2') };
}
