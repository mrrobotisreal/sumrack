import { useQuery } from '@tanstack/react-query';

import { repos } from '@/db';

import type { Cefr } from '@/db/repositories/dashboard';

import { listStoredAssessments } from './assessment';
import { computeForecast, localDateKey } from './science/forecast';
import { buildHeatmap, HEATMAP_WEEKS } from './science/heatmap';
import { isVisibleLeech, LEECH_AGAIN_MIN } from './science/leeches';

/**
 * Dashboard read-hooks (T18). All offline aggregations — the AI assessment
 * hook only reads stored rows; requests run through runAssessment.
 * Keys live under the 'dashboard' prefix so one invalidation refreshes the
 * whole screen after a practice session.
 */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  vocab: ['dashboard', 'vocab'] as const,
  grammar: ['dashboard', 'grammar'] as const,
  activity: ['dashboard', 'activity'] as const,
  pronunciation: ['dashboard', 'pronunciation'] as const,
  weakLemmas: ['dashboard', 'weak-lemmas'] as const,
  weakPronunciation: ['dashboard', 'weak-pronunciation'] as const,
  assessments: ['dashboard', 'assessments'] as const,
  checkpoints: ['dashboard', 'checkpoints'] as const,
  // T38 progress science
  coreCoverage: ['dashboard', 'core-coverage'] as const,
  coreGaps: (level: Cefr) => ['dashboard', 'core-gaps', level] as const,
  forecast: ['dashboard', 'forecast'] as const,
  heatmap: ['dashboard', 'heatmap'] as const,
  leeches: ['dashboard', 'leeches'] as const,
};

export function useVocabByLevel() {
  return useQuery({
    queryKey: dashboardKeys.vocab,
    queryFn: () => repos.dashboard.getVocabByLevel(),
  });
}

export function useGrammarCoverage() {
  return useQuery({
    queryKey: dashboardKeys.grammar,
    queryFn: () => repos.dashboard.getGrammarCoverage(),
  });
}

export function useActivityTotals() {
  return useQuery({
    queryKey: dashboardKeys.activity,
    queryFn: () => repos.dashboard.getActivityTotals(),
  });
}

export function usePronunciationTrend() {
  return useQuery({
    queryKey: dashboardKeys.pronunciation,
    queryFn: () => repos.dashboard.getPronunciationTrend(),
  });
}

export function useWeakestLemmas() {
  return useQuery({
    queryKey: dashboardKeys.weakLemmas,
    queryFn: () => repos.dashboard.getWeakestLemmas(),
  });
}

export function useWeakestPronunciation() {
  return useQuery({
    queryKey: dashboardKeys.weakPronunciation,
    queryFn: () => repos.dashboard.getWeakestPronunciation(),
  });
}

export function useStoredAssessments() {
  return useQuery({
    queryKey: dashboardKeys.assessments,
    queryFn: () => listStoredAssessments(repos),
  });
}

export function useCheckpointHistory() {
  return useQuery({
    queryKey: dashboardKeys.checkpoints,
    queryFn: () => repos.stats.listCheckpointResults(),
  });
}

/** T38: core-vocabulary coverage per installed reference level. */
export function useCoreCoverage() {
  return useQuery({
    queryKey: dashboardKeys.coreCoverage,
    queryFn: () => repos.dashboard.getCoreCoverage(),
  });
}

/** T38: un-encountered core lemmas at `level` (the gap list). */
export function useCoreGaps(level: Cefr) {
  return useQuery({
    queryKey: dashboardKeys.coreGaps(level),
    queryFn: () => repos.dashboard.getCoreGaps(level),
  });
}

/** T38: 30-day due forecast — pure math over the active cards. */
export function useDueForecast() {
  return useQuery({
    queryKey: dashboardKeys.forecast,
    queryFn: async () => computeForecast(await repos.dashboard.getForecastCards(), new Date()),
  });
}

/** T38: year heatmap layout from `daily_activity` (one query + pure layout). */
export function useYearHeatmap() {
  return useQuery({
    queryKey: dashboardKeys.heatmap,
    queryFn: async () => {
      const now = new Date();
      const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - HEATMAP_WEEKS * 7);
      return buildHeatmap(await repos.dashboard.getActivitySince(localDateKey(since)), now);
    },
  });
}

/** T38: the visible leech inbox (rule + dismissal applied by the pure module). */
export function useLeechInbox() {
  return useQuery({
    queryKey: dashboardKeys.leeches,
    queryFn: async () =>
      (await repos.dashboard.getLeechCandidates(LEECH_AGAIN_MIN)).filter((c) =>
        isVisibleLeech(
          {
            againCount: c.againCount,
            windowSize: c.windowSize,
            lastReviewedAt: c.lastReviewedAt,
            lastAgainAt: c.lastAgainAt,
          },
          c.dismissedAt,
        ),
      ),
  });
}
