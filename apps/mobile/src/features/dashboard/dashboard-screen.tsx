import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { repos } from '@/db';
import { getApiKey } from '@/features/ai/config';
import { isOnline } from '@/features/ai/connectivity';
import type { CefrLevel } from '@/components/level-chip';
import { QueryError } from '@/components/query-error';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  bundleHasEvidence,
  buildAssessmentBundle,
  runAssessment,
  shouldAutoAssess,
} from './assessment';
import { ActivitySection } from './activity-section';
import { AssessmentCard } from './assessment-card';
import { GrammarSection } from './grammar-section';
import {
  dashboardKeys,
  useActivityTotals,
  useCheckpointHistory,
  useGrammarCoverage,
  usePronunciationTrend,
  useStoredAssessments,
  useVocabByLevel,
  useWeakestLemmas,
  useWeakestPronunciation,
} from './hooks';
import { NeedsWorkSection } from './needs-work-section';
import { VocabSection } from './vocab-section';

/** One auto-assessment attempt per app process — a failed weekly run never
 *  turns into a retry loop on every dashboard visit. */
let autoAssessAttempted = false;

/**
 * The progress dashboard (T18, design §7.6): vocabulary mastery, grammar
 * coverage, activity, what-needs-work, AI assessment — everything except
 * the assessment fully offline. Reached from the Today header.
 */
export function DashboardScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();

  const vocab = useVocabByLevel();
  const grammar = useGrammarCoverage();
  const activity = useActivityTotals();
  const pronunciation = usePronunciationTrend();
  const weakLemmas = useWeakestLemmas();
  const weakPronunciation = useWeakestPronunciation();
  const assessments = useStoredAssessments();
  const checkpoints = useCheckpointHistory();

  const [online, setOnline] = React.useState(false);
  const [autoRunning, setAutoRunning] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      track('dashboard_opened');
      // Data changes while unfocused (sessions, reading) — refresh on return.
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      void isOnline().then(setOnline);
    }, [queryClient]),
  );

  // Auto cadence (T18 decision): weekly, silent, only online + keyed +
  // with real evidence. One attempt per process; failures stay quiet —
  // the manual button on the detail screen surfaces errors.
  const storedAssessments = assessments.data;
  React.useEffect(() => {
    if (autoAssessAttempted || storedAssessments == null) return;
    if (!shouldAutoAssess(storedAssessments)) return;
    let cancelled = false;
    void (async () => {
      if (!(await isOnline()) || !(await getApiKey())) return;
      const bundle = await buildAssessmentBundle(repos);
      if (!bundleHasEvidence(bundle) || autoAssessAttempted || cancelled) return;
      autoAssessAttempted = true;
      setAutoRunning(true);
      try {
        await runAssessment(repos, 'auto');
        void queryClient.invalidateQueries({ queryKey: dashboardKeys.assessments });
      } catch {
        // tracked inside runAssessment; silent by design for auto runs
      } finally {
        if (!cancelled) setAutoRunning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedAssessments, queryClient]);

  const practiceLemmas = React.useCallback(
    (ids: string[]) => {
      track('dashboard_practice_now', { kind: 'lemmas', count: ids.length });
      router.push(`/review/daily?focus=${ids.join(',')}`);
    },
    [router],
  );

  const practiceTopic = React.useCallback(
    (level: CefrLevel, topic: string) => {
      void (async () => {
        const ids = await repos.dashboard.getTopicPracticeItemIds(level, topic);
        track('dashboard_practice_now', { kind: 'topic', topic, count: ids.length });
        if (ids.length > 0) router.push(`/review/daily?focus=${ids.join(',')}`);
      })();
    },
    [router],
  );

  const practicePronunciation = React.useCallback(
    (ids: string[]) => {
      track('dashboard_practice_now', { kind: 'pronunciation', count: ids.length });
      router.push(`/review/pronunciation?focus=${ids.join(',')}`);
    },
    [router],
  );

  const coreQueries = [
    vocab,
    grammar,
    activity,
    pronunciation,
    weakLemmas,
    weakPronunciation,
    assessments,
    checkpoints,
  ];
  const loading = coreQueries.some((q) => q.isPending);
  const anyError = coreQueries.some((q) => q.isError);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (anyError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => coreQueries.forEach((q) => void q.refetch())} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-4 px-4 pb-16 pt-4">
      <VocabSection data={vocab.data ?? []} />
      <NeedsWorkSection
        weakLemmas={weakLemmas.data ?? []}
        grammar={grammar.data ?? []}
        weakPronunciation={weakPronunciation.data ?? []}
        onPracticeLemmas={practiceLemmas}
        onPracticeTopic={practiceTopic}
        onPracticePronunciation={practicePronunciation}
      />
      <GrammarSection data={grammar.data ?? []} onPracticeTopic={practiceTopic} />
      <ActivitySection
        activity={
          activity.data ?? {
            reviewsDone: 0,
            readingMs: 0,
            storiesFinished: 0,
            activityStreak: 0,
            recentDays: [],
          }
        }
        pronunciation={pronunciation.data ?? { days: [], overallAvg: null }}
        checkpoints={checkpoints.data ?? []}
      />
      <AssessmentCard
        latest={storedAssessments?.[storedAssessments.length - 1] ?? null}
        online={online}
        autoRunning={autoRunning}
      />
    </ScrollView>
  );
}
