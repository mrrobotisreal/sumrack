import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ActivityTotals, PronunciationDay } from '@/db/repositories/dashboard';
import type { createStatsRepo } from '@/db/repositories/stats';
import { useAppTheme } from '@/theme/use-app-theme';

import { MiniColumns, mixHex } from './charts';
import { EmptyHint, SectionCard } from './section-card';

type CheckpointRow = Awaited<
  ReturnType<ReturnType<typeof createStatsRepo>['listCheckpointResults']>
>[number];

/**
 * Activity stats (design §7.6): the real goal-met streak (T19 — same walk
 * as the Today ring), lifetime totals, a 14-day reviews chart, the
 * pronunciation score trend, and read-only checkpoint history.
 */
export function ActivitySection({
  activity,
  pronunciation,
  checkpoints,
}: {
  activity: ActivityTotals;
  pronunciation: { days: PronunciationDay[]; overallAvg: number | null };
  checkpoints: CheckpointRow[];
}) {
  const { tokens } = useAppTheme();
  const minutes = Math.round(activity.readingMs / 60_000);

  const hasAnything =
    activity.reviewsDone > 0 || activity.readingMs > 0 || activity.storiesFinished > 0;

  const reviewPoints = activity.recentDays.map((d, i) => ({
    value: d.reviewsDone,
    label:
      i === 0 || i === activity.recentDays.length - 1
        ? d.date.slice(5).replace('-', '/')
        : undefined,
  }));

  // Pronunciation: last 14 active days, score scale pinned to 100.
  const pronPoints = pronunciation.days.slice(-14).map((d, i, arr) => ({
    value: d.avgScore,
    label: i === 0 || i === arr.length - 1 ? d.date.slice(5).replace('-', '/') : undefined,
  }));

  return (
    <SectionCard title="Activity">
      {!hasAnything ? (
        <EmptyHint>Нечего показывать — reading and reviewing will light this up.</EmptyHint>
      ) : (
        <>
          <View className="flex-row items-center gap-2">
            <Ionicons name="flame" size={18} color={tokens.accent} />
            <Text className="font-ui-medium">{activity.activityStreak}-day streak</Text>
            <Text variant="caption">(goal-met days)</Text>
          </View>

          <View className="mt-3 flex-row gap-3">
            <StatTile value={minutes} label="min read" />
            <StatTile value={activity.storiesFinished} label="stories" />
            <StatTile value={activity.reviewsDone} label="reviews" />
          </View>

          <Text variant="caption" className="mb-1 mt-4">
            Reviews · last 14 days
          </Text>
          <MiniColumns points={reviewPoints} color={tokens.accent} />

          {pronPoints.length > 0 && (
            <>
              <Text variant="caption" className="mb-1 mt-4">
                Pronunciation score · by practice day{' '}
                {pronunciation.overallAvg != null ? `(avg ${pronunciation.overallAvg})` : ''}
              </Text>
              <MiniColumns
                points={pronPoints}
                max={100}
                color={mixHex(tokens.accent, tokens.surface, 0.75)}
              />
            </>
          )}

          {checkpoints.length > 0 && (
            <View className="mt-4 gap-1">
              <Text variant="caption">Checkpoints</Text>
              {checkpoints.map((cp) => (
                <View key={cp.id} className="flex-row items-center gap-2">
                  <Ionicons
                    name={cp.passed ? 'flag' : 'flag-outline'}
                    size={14}
                    color={cp.passed ? tokens.accent : tokens.textMuted}
                  />
                  <Text className="flex-1 text-sm" numberOfLines={1}>
                    {cp.checkpointPackId}
                  </Text>
                  <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
                    {Math.round(cp.scorePercent)}% {cp.passed ? '· passed' : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </SectionCard>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1 rounded-lg bg-surface-2 px-3 py-2.5">
      <Text className="font-ui-bold text-xl" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}
