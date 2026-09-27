import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, SectionList, Text as RNText, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useScenarioRuns, useScenarios } from '@/db/hooks';
import type { ScenarioRunRow } from '@/db/repositories/scenarios';
import { groupByDay } from '@/features/word-forms/lesson-core';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * The runs list (T63 §10.2, route `app/scenarios/runs.tsx`): every run of
 * one scenario (`?scenarioId=`) or of all, newest first, grouped by local
 * day (the Lessons screen's grouping), each row → its debrief. Unfinished
 * runs show as «in progress»; pinned / archived / deleted states ride the
 * caption so the list itself tells the media story.
 */
export function RunsListScreen() {
  const { scenarioId } = useLocalSearchParams<{ scenarioId?: string }>();
  const router = useRouter();
  const { tokens } = useAppTheme();
  const runsQ = useScenarioRuns(scenarioId || undefined, { limit: 200 });
  const families = useScenarios();

  const titles = React.useMemo(() => {
    const m = new Map<string, { ru: string; en: string; level: string }>();
    for (const f of families.data ?? [])
      for (const r of f.rungs) m.set(r.id, { ru: r.titleRu, en: r.titleEn, level: r.level });
    return m;
  }, [families.data]);

  const rows = React.useMemo(
    () => (runsQ.data ?? []).map((r) => ({ ...r, createdAt: r.finishedAt ?? r.startedAt })),
    [runsQ.data],
  );
  const groups = React.useMemo(() => groupByDay(rows), [rows]);

  const open = React.useCallback(
    (run: ScenarioRunRow) => {
      if (run.finishedAt === null) {
        // An unfinished run resumes in place (T62); the debrief is for finished ones.
        router.push(`/scenario/${run.packId}/${run.scenarioId}`);
        return;
      }
      router.push(`/scenario/debrief/${run.id}`);
    },
    [router],
  );

  if (runsQ.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (runsQ.isError) {
    return (
      <View className="flex-1 bg-bg px-4 pt-4">
        <QueryError onRetry={() => void runsQ.refetch()} />
      </View>
    );
  }

  return (
    <SectionList
      className="bg-bg"
      sections={groups.map((g) => ({ title: g.label, key: g.day, data: g.rows }))}
      keyExtractor={(row) => row.id}
      stickySectionHeadersEnabled={false}
      contentContainerClassName="px-4 pb-16"
      renderSectionHeader={({ section }) => (
        <Text variant="caption" className="mb-2 mt-5 uppercase tracking-wider">
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <RunRow run={item} title={titles.get(item.scenarioId)} onPress={() => open(item)} />
      )}
      ItemSeparatorComponent={() => <View className="h-2" />}
      ListEmptyComponent={
        <View className="mt-10 items-center gap-2 rounded-xl border border-border bg-surface px-6 py-10">
          <Ionicons name="mic-outline" size={26} color={tokens.textMuted} />
          <Text className="font-ui-medium text-lg">No runs yet</Text>
          <Text variant="caption" className="text-center">
            Finish a scenario and every attempt — word by word, with your recording — lands here.
          </Text>
        </View>
      }
    />
  );
}

function RunRow({
  run,
  title,
  onPress,
}: {
  run: ScenarioRunRow;
  title: { ru: string; en: string; level: string } | undefined;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  const stats = repos.scenarios.parseRunStats(run);
  const when = new Date(run.finishedAt ?? run.startedAt);
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const media =
    run.finishedAt === null
      ? 'in progress'
      : run.mediaLocal
        ? run.mediaBundleState === 'uploaded'
          ? 'backed up'
          : run.mediaBundleState === 'pending'
            ? 'backup pending'
            : run.mediaBundleState === 'failed'
              ? 'backup failed'
              : 'on device'
        : run.mediaBundleState === 'uploaded'
          ? 'archived'
          : 'audio deleted';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title?.ru ?? run.scenarioId} ${run.level} run at ${time}`}
      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2"
    >
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <RNText className="flex-1 font-reading text-lg text-text" numberOfLines={1}>
            {title?.ru ?? run.scenarioId}
          </RNText>
          {run.pinned && <Ionicons name="pin" size={13} color={tokens.accent} />}
        </View>
        <Text variant="caption" numberOfLines={1}>
          {run.level} · {time}
          {stats
            ? ` · ${stats.cleanTurns}/${stats.turns} clean · ${stats.misses} miss${stats.misses === 1 ? '' : 'es'}`
            : ''}
          {` · ${media}`}
        </Text>
      </View>
      <Ionicons
        name={run.finishedAt === null ? 'play-outline' : 'chevron-forward'}
        size={16}
        color={tokens.textMuted}
      />
    </Pressable>
  );
}
