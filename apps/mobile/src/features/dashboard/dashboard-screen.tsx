import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { addDatabaseChangeListener } from 'expo-sqlite';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { repos } from '@/db';
import { getApiKey } from '@/features/ai/config';
import { isOnline } from '@/features/ai/connectivity';
import type { CefrLevel } from '@/components/level-chip';
import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useReduceMotion } from '@/store/motion-prefs';
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
import {
  consumeDashboardTap,
  createLoadTracker,
  foldStatus,
  shouldRefreshOnFocus,
  type DashboardSection,
  type LoadEvent,
  type SectionStatus,
} from './load-state';
import { CoreCoverageSection, ForecastSection, YearHeatmapSection } from './science-sections';
import { NeedsWorkSection } from './needs-work-section';
import { SectionCard } from './section-card';
import { VocabSection } from './vocab-section';

/** One auto-assessment attempt per app process — a failed weekly run never
 *  turns into a retry loop on every dashboard visit. */
let autoAssessAttempted = false;

/**
 * T99 refocus rule, part 2: a user-data write since the last dashboard read
 * forces a refresh even inside the 30 s window. Fed by the main
 * connection's change listener (client.ts enables it); analytics rows don't
 * count — the dashboard writes those itself on every visit.
 */
let wroteSinceRefresh = false;
let changeListenerInstalled = false;
function installWriteWatcher() {
  if (changeListenerInstalled) return;
  changeListenerInstalled = true;
  addDatabaseChangeListener((e) => {
    if (e.tableName !== 'analytics_events') wroteSinceRefresh = true;
  });
}

/** Refresh cached cards on focus per the T99 rule; never on the first load. */
function refreshOnFocus(queryClient: QueryClient, now: number) {
  const cached = queryClient
    .getQueryCache()
    .findAll({ queryKey: dashboardKeys.all })
    .map((q) => q.state.dataUpdatedAt)
    .filter((t) => t > 0);
  if (cached.length === 0) {
    // First visit (or cache collected): the mounting queries fetch on their own.
    wroteSinceRefresh = false;
    return;
  }
  if (!wroteSinceRefresh && !shouldRefreshOnFocus(Math.min(...cached), now)) return;
  wroteSinceRefresh = false;
  // cancelRefetch: false — never restart a read that's already in flight.
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.all }, { cancelRefetch: false });
}

/**
 * Skeleton heights (dp) ≈ each card's loaded height on the S25 with typical
 * data, so cards don't shove each other around as they land (T99).
 */
const SKELETON_MIN_HEIGHT: Record<Exclude<DashboardSection, 'leeches'>, number> = {
  vocab: 210,
  coreCoverage: 150,
  needsWork: 190,
  forecast: 170,
  grammar: 240,
  activity: 250,
  heatmap: 190,
  assessment: 100,
};

/**
 * The progress dashboard (T18, design §7.6): vocabulary mastery, grammar
 * coverage, activity, what-needs-work, AI assessment — everything except
 * the assessment fully offline. Reached from the Today header.
 *
 * T99: renders on the first frame. Every card owns its queries and shows its
 * own spinner skeleton / inline error until its data lands — reads run one
 * at a time on the background connection, cheapest first (load-state.ts),
 * so the cards fill in one by one instead of behind one full-screen spinner.
 */
export function DashboardScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

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
  const [ready, setReady] = React.useState(false);

  // One load tracker per visit (focus): loaded/failed/ready analytics.
  const tracker = React.useRef(createLoadTracker(Date.now()));

  useFocusEffect(
    React.useCallback(() => {
      installWriteWatcher();
      const now = Date.now();
      track('dashboard_opened');
      tracker.current = createLoadTracker(now);
      refreshOnFocus(queryClient, now);
      void isOnline().then(setOnline);
    }, [queryClient]),
  );

  // Tap → first frame (the Today header stamps the tap).
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ms = consumeDashboardTap();
      if (ms != null) track('dashboard_first_paint', { ms });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const statuses: Record<DashboardSection, SectionStatus> = {
    vocab: vocab.status,
    coreCoverage: coverage.status,
    leeches: leeches.status,
    // Weak grammar topics fill in later inside the card (grammar is the
    // slowest read); the card itself waits only on its own two lists.
    needsWork: foldStatus([weakLemmas, weakPronunciation]),
    forecast: forecast.status,
    grammar: grammar.status,
    activity: foldStatus([activity, pronunciation, checkpoints]),
    heatmap: heatmap.status,
    assessment: assessments.status,
  };
  const statusKey = Object.values(statuses).join('|');

  React.useEffect(() => {
    for (const e of tracker.current.observe(statuses, Date.now())) emitLoadEvent(e);
    if (tracker.current.isReady) setReady(true);
    // statusKey captures every input of `statuses`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  function emitLoadEvent(e: LoadEvent) {
    if (e.kind === 'ready') {
      track('dashboard_ready', { ms: e.ms, sections: e.sections });
      return;
    }
    if (e.kind === 'failed') {
      track('dashboard_section_failed', { section: e.section });
      return;
    }
    track('dashboard_section_loaded', { section: e.section, ms: e.ms, cached: e.cached });
    // T38 «viewed» events (counts / percentages only), now per card.
    if (e.section === 'coreCoverage') {
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
    } else if (e.section === 'forecast' && forecast.data) {
      const f = forecast.data;
      track('forecast_viewed', {
        today: f.days[0]?.total ?? 0,
        overdue: f.overdue,
        next30: f.days.reduce((n, d) => n + d.total, 0),
      });
    } else if (e.section === 'heatmap') {
      track('heatmap_viewed', { activeDays: heatmap.data?.activeDays ?? 0 });
    }
  }

  // Auto cadence (T18 decision): weekly, silent, only online + keyed +
  // with real evidence. One attempt per process; failures stay quiet —
  // the manual button on the detail screen surfaces errors. T99: never
  // during the first load — its bundle reads would compete with the cards.
  const storedAssessments = assessments.data;
  React.useEffect(() => {
    if (!ready || autoAssessAttempted || storedAssessments == null) return;
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
  }, [ready, storedAssessments, queryClient]);

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

  const retry =
    (...queries: { isError: boolean; refetch: () => unknown }[]) =>
    () => {
      for (const q of queries) if (q.isError) void q.refetch();
    };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-4 px-4 pb-16 pt-4">
      <SectionSlot
        title="Vocabulary"
        status={statuses.vocab}
        minHeight={SKELETON_MIN_HEIGHT.vocab}
        onRetry={retry(vocab)}
      >
        {() => <VocabSection data={vocab.data ?? []} />}
      </SectionSlot>
      <SectionSlot
        title="Core vocabulary"
        status={statuses.coreCoverage}
        minHeight={SKELETON_MIN_HEIGHT.coreCoverage}
        onRetry={retry(coverage)}
      >
        {() => (
          <CoreCoverageSection
            data={coverage.data ?? []}
            onOpenGaps={(level) =>
              router.push({ pathname: '/dashboard/core-gaps', params: { level } })
            }
          />
        )}
      </SectionSlot>
      <LeechesRow
        count={leeches.data?.length ?? null}
        onOpen={() => router.push('/dashboard/leeches')}
      />
      <SectionSlot
        title="What needs work"
        status={statuses.needsWork}
        minHeight={SKELETON_MIN_HEIGHT.needsWork}
        onRetry={retry(weakLemmas, weakPronunciation)}
      >
        {() => (
          <NeedsWorkSection
            weakLemmas={weakLemmas.data ?? []}
            grammar={grammar.isError ? [] : (grammar.data ?? null)}
            weakPronunciation={weakPronunciation.data ?? []}
            onPracticeLemmas={practiceLemmas}
            onPracticeTopic={practiceTopic}
            onPracticePronunciation={practicePronunciation}
          />
        )}
      </SectionSlot>
      <SectionSlot
        title="Coming up · 30 days"
        status={statuses.forecast}
        minHeight={SKELETON_MIN_HEIGHT.forecast}
        onRetry={retry(forecast)}
      >
        {() =>
          forecast.data && (
            <ForecastSection
              forecast={forecast.data}
              onSelectDay={(offset) =>
                track('forecast_day_selected', {
                  offset,
                  total: forecast.data?.days[offset]?.total ?? 0,
                })
              }
            />
          )
        }
      </SectionSlot>
      <SectionSlot
        title="Grammar coverage"
        status={statuses.grammar}
        minHeight={SKELETON_MIN_HEIGHT.grammar}
        onRetry={retry(grammar)}
      >
        {() => <GrammarSection data={grammar.data ?? []} onPracticeTopic={practiceTopic} />}
      </SectionSlot>
      <SectionSlot
        title="Activity"
        status={statuses.activity}
        minHeight={SKELETON_MIN_HEIGHT.activity}
        onRetry={retry(activity, pronunciation, checkpoints)}
      >
        {() => (
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
        )}
      </SectionSlot>
      <SectionSlot
        title="Year of activity"
        status={statuses.heatmap}
        minHeight={SKELETON_MIN_HEIGHT.heatmap}
        onRetry={retry(heatmap)}
      >
        {() => heatmap.data && <YearHeatmapSection layout={heatmap.data} />}
      </SectionSlot>
      <SectionSlot
        title="AI assessment"
        status={statuses.assessment}
        minHeight={SKELETON_MIN_HEIGHT.assessment}
        onRetry={retry(assessments)}
      >
        {() => (
          <AssessmentCard
            latest={storedAssessments?.[storedAssessments.length - 1] ?? null}
            online={online}
            autoRunning={autoRunning}
          />
        )}
      </SectionSlot>
    </ScrollView>
  );
}

/**
 * One dashboard card's three states (T99): a titled skeleton with a spinner
 * at the card's usual height while its reads are pending, an inline retry
 * on error (a failed read must never look empty), and the real card —
 * faded in unless reduce-motion is on — once its data is in.
 */
function SectionSlot({
  title,
  status,
  minHeight,
  onRetry,
  children,
}: {
  title: string;
  status: SectionStatus;
  minHeight: number;
  onRetry: () => void;
  children: () => React.ReactNode;
}) {
  const { tokens } = useAppTheme();
  const reduceMotion = useReduceMotion();

  if (status === 'pending') {
    return (
      <View accessibilityLabel={`${title}, loading`} accessibilityState={{ busy: true }}>
        <SectionCard title={title}>
          <View style={{ minHeight: minHeight - 48 }} className="items-center justify-center">
            <ActivityIndicator color={tokens.accent} />
          </View>
        </SectionCard>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <SectionCard title={title}>
        <QueryError onRetry={onRetry} />
      </SectionCard>
    );
  }
  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
      {children()}
    </Animated.View>
  );
}

/** T38: the «what's stuck» entry — the leech inbox with its count badge. */
function LeechesRow({ count, onOpen }: { count: number | null; onOpen: () => void }) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={count == null ? 'Leeches, loading' : `Leeches, ${count}`}
      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2"
    >
      <Ionicons
        name="bug-outline"
        size={18}
        color={count != null && count > 0 ? tokens.accent : tokens.textMuted}
      />
      <View className="flex-1">
        <Text className="font-ui-medium">Leeches</Text>
        <Text variant="caption">
          {count == null
            ? 'Checking for cards that keep failing…'
            : count > 0
              ? 'Cards that keep failing — explain, note, drill or dismiss'
              : 'Nothing keeps failing right now'}
        </Text>
      </View>
      {count == null && <ActivityIndicator size="small" color={tokens.accent} />}
      {count != null && count > 0 && (
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
