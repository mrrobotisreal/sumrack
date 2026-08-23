import { useQuery } from '@tanstack/react-query';

import { repos } from '@/db';

import { listStoredAssessments } from './assessment';

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
