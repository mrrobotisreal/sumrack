import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { repos } from '@/db';
import { getApiKey } from '@/features/ai/config';
import { isOnline } from '@/features/ai/connectivity';
import type { CefrLevel } from '@/components/level-chip';
import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
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
  useCoreCoverage,
  useDueForecast,
  useGrammarCoverage,
  useLeechInbox,
  usePronunciationTrend,
  useStoredAssessments,
  useVocabByLevel,
  useWeakestLemmas,
  useWeakestPronunciation,
  useYearHeatmap,
} from './hooks';
import { CoreCoverageSection, ForecastSection, YearHeatmapSection } from './science-sections';
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
  // T38 progress science
  const coverage = useCoreCoverage();
  const forecast = useDueForecast();
  const heatmap = useYearHeatmap();
  const leeches = useLeechInbox();

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
    coverage,
    forecast,
    heatmap,
    leeches,
  ];
  const loading = coreQueries.some((q) => q.isPending);
  const anyError = coreQueries.some((q) => q.isError);

  // T38 analytics: one «viewed» event per dashboard visit once the data is in
  // (counts / percentages only).
  const viewedFor = React.useRef<unknown>(null);
  React.useEffect(() => {
    if (loading || anyError || viewedFor.current === coverage.data) return;
    viewedFor.current = coverage.data;
    const pct = (lvl: string) => {
      const row = coverage.data?.find((c) => c.level === lvl);
      return row ? Math.round((100 * row.encountered) / Math.max(1, row.total)) : undefined;
    };
    const a1 = pct('A1');
    const a2 = pct('A2');
    track('core_coverage_viewed', {
      levels: coverage.data?.length ?? 0,
      ...(a1 != null ? { a1Pct: a1 } : {}),
      ...(a2 != null ? { a2Pct: a2 } : {}),
    });
    const f = forecast.data;
    if (f) {
      track('forecast_viewed', {
        today: f.days[0]?.total ?? 0,
        overdue: f.overdue,
        next30: f.days.reduce((n, d) => n + d.total, 0),
      });
    }
    track('heatmap_viewed', { activeDays: heatmap.data?.activeDays ?? 0 });
  }, [loading, anyError, coverage.data, forecast.data, heatmap.data]);

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
      <CoreCoverageSection
        data={coverage.data ?? []}
        onOpenGaps={(level) => router.push({ pathname: '/dashboard/core-gaps', params: { level } })}
      />
      <LeechesRow
        count={leeches.data?.length ?? 0}
        onOpen={() => router.push('/dashboard/leeches')}
      />
      <NeedsWorkSection
        weakLemmas={weakLemmas.data ?? []}
        grammar={grammar.data ?? []}
        weakPronunciation={weakPronunciation.data ?? []}
        onPracticeLemmas={practiceLemmas}
        onPracticeTopic={practiceTopic}
        onPracticePronunciation={practicePronunciation}
      />
      {forecast.data && (
        <ForecastSection
          forecast={forecast.data}
          onSelectDay={(offset) =>
            track('forecast_day_selected', {
              offset,
              total: forecast.data?.days[offset]?.total ?? 0,
            })
          }
        />
      )}
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
      {heatmap.data && <YearHeatmapSection layout={heatmap.data} />}
      <AssessmentCard
        latest={storedAssessments?.[storedAssessments.length - 1] ?? null}
        online={online}
        autoRunning={autoRunning}
      />
    </ScrollView>
  );
}

/** T38: the «what's stuck» entry — the leech inbox with its count badge. */
function LeechesRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Leeches, ${count}`}
      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2"
    >
      <Ionicons name="bug-outline" size={18} color={count > 0 ? tokens.accent : tokens.textMuted} />
      <View className="flex-1">
        <Text className="font-ui-medium">Leeches</Text>
        <Text variant="caption">
          {count > 0
            ? 'Cards that keep failing — explain, note, drill or dismiss'
            : 'Nothing keeps failing right now'}
        </Text>
      </View>
      {count > 0 && (
        <View className="min-w-6 items-center rounded-full bg-accent px-2 py-0.5">
          <Text className="text-xs text-white" style={{ fontVariant: ['tabular-nums'] }}>
            {count}
          </Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={tokens.textMuted} />
    </Pressable>
  );
}
