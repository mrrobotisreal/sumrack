import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import {
  useDailyActivity,
  useDueCardCount,
  useProductionDueCount,
  useStories,
  useStoryProgressList,
} from '@/db/hooks';
import type { PathNode } from '@/features/path/path-model';
import { isUnit, nextStepInfo, usePathState } from '@/features/path/use-path';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Goal-ring PLACEHOLDER targets (design §7.7 defaults). T06 scope is
 * counters only — T19 brings configurable goals, streaks, and the real
 * ring; these constants exist purely so the bars have a denominator.
 */
const PLACEHOLDER_GOAL_REVIEWS = 20;
const PLACEHOLDER_GOAL_READING_MIN = 10;

/**
 * Сегодня v1 (design §10, UI_DESIGN §4): one viewport answering, top to
 * bottom — goal state (placeholder bars over real daily_activity counters),
 * what's due (session CTA), where I left off (continue-reading card).
 */
export function TodayScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();

  const due = useDueCardCount();
  const productionDue = useProductionDueCount();
  const activity = useDailyActivity();
  const progressList = useStoryProgressList();
  const stories = useStories();
  const path = usePathState();

  // Counts change while this tab is unfocused (sessions, reading) — refresh on return.
  useFocusEffect(
    React.useCallback(() => {
      track('tab_viewed', { tab: 'Сегодня' });
      void queryClient.invalidateQueries({ queryKey: ['due-count'] });
      void queryClient.invalidateQueries({ queryKey: ['daily-activity'] });
      void queryClient.invalidateQueries({ queryKey: ['story-progress'] });
      void queryClient.invalidateQueries({ queryKey: ['path'] });
    }, [queryClient]),
  );

  const reviewsDone = activity.data?.reviewsDone ?? 0;
  const readingMin = Math.floor((activity.data?.readingMs ?? 0) / 60_000);
  const dueCount = due.data ?? 0;
  const pronDueCount = productionDue.data ?? 0;

  const continueTarget = React.useMemo(() => {
    const inProgress = (progressList.data ?? [])
      .filter((p) => p.finishedAt == null)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!inProgress) return null;
    const story = (stories.data ?? []).find(
      (s) => s.packId === inProgress.packId && s.id === inProgress.storyId,
    );
    return story ? { progress: inProgress, story } : null;
  }, [progressList.data, stories.data]);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-4 px-4 pb-16 pt-4">
      {/* goal placeholder — real counters, T19 owns the actual goal/streak logic */}
      <View className="rounded-xl border border-border bg-surface p-4">
        <Text variant="caption" className="uppercase tracking-wider">
          Today
        </Text>
        <View className="mt-3 gap-3">
          <GoalBar
            icon="albums-outline"
            label="Reviews"
            value={reviewsDone}
            target={PLACEHOLDER_GOAL_REVIEWS}
            unit=""
          />
          <GoalBar
            icon="book-outline"
            label="Reading"
            value={readingMin}
            target={PLACEHOLDER_GOAL_READING_MIN}
            unit=" min"
          />
        </View>
      </View>

      {/* what's due */}
      <View className="rounded-xl border border-border bg-surface p-4">
        <View className="flex-row items-baseline gap-2">
          <RNText className="font-ui-bold text-4xl text-text">{dueCount}</RNText>
          <Text variant="muted">{dueCount === 1 ? 'card due' : 'cards due'}</Text>
        </View>
        {dueCount > 0 ? (
          <Pressable
            // T14: the default action is the unified daily session (mixed modes).
            onPress={() => router.push('/review/daily')}
            accessibilityRole="button"
            accessibilityLabel="Start review session"
            className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3.5 active:opacity-80"
          >
            <Ionicons name="play" size={16} color={tokens.bg} />
            <Text className="font-ui-medium text-bg">Start session</Text>
          </Pressable>
        ) : (
          <Text variant="muted" className="mt-3">
            Всё повторено — nothing due. Reading adds new words to review.
          </Text>
        )}
      </View>

      {/* speaking practice (T12) — production cards are due only to this session */}
      {pronDueCount > 0 && (
        <Pressable
          onPress={() => router.push('/review/pronunciation')}
          accessibilityRole="button"
          accessibilityLabel="Start pronunciation practice"
          className="rounded-xl border border-border bg-surface p-4 active:bg-surface-2"
        >
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 gap-0.5">
              <Text variant="caption" className="uppercase tracking-wider">
                Speaking
              </Text>
              <Text className="font-ui-medium">
                {pronDueCount === 1 ? '1 phrase' : `${pronDueCount} phrases`} to pronounce
              </Text>
            </View>
            <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-2">
              <Ionicons name="mic-outline" size={18} color={tokens.accent} />
            </View>
          </View>
        </Pressable>
      )}

      {/* continue on the path (T17) — current node's next uncompleted step */}
      {path.data?.current && <PathContinueCard node={path.data.current} />}

      {/* where I left off */}
      {continueTarget && (
        <Pressable
          onPress={() =>
            router.push(
              `/reader/${continueTarget.progress.packId}/${continueTarget.progress.storyId}`,
            )
          }
          accessibilityRole="button"
          accessibilityLabel={`Continue reading ${continueTarget.story.titleRu}`}
          className="rounded-xl border border-border bg-surface p-4 active:bg-surface-2"
        >
          <Text variant="caption" className="uppercase tracking-wider">
            Continue reading
          </Text>
          <View className="mt-2 flex-row items-center justify-between gap-3">
            <RNText className="flex-1 font-reading text-xl text-text" numberOfLines={1}>
              {continueTarget.story.titleRu}
            </RNText>
            <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
          </View>
        </Pressable>
      )}
    </ScrollView>
  );
}

function PathContinueCard({ node }: { node: PathNode }) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const step = nextStepInfo(node);
  const subtitle = isUnit(node)
    ? `${node.pack.titleRu} · ${node.stepsDone}/${node.stepsTotal}`
    : node.pack.titleRu;
  return (
    <Pressable
      onPress={() => {
        track('path_continue_tapped', { packId: node.pack.id, kind: node.kind });
        router.push(step.route as never);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Continue the path: ${step.label}`}
      className="rounded-xl border border-border bg-surface p-4 active:bg-surface-2"
    >
      <Text variant="caption" className="uppercase tracking-wider">
        Путь
      </Text>
      <View className="mt-2 flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <RNText className="font-ui-medium text-base text-text" numberOfLines={1}>
            {step.label}
          </RNText>
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-2">
          <Ionicons
            name={node.kind === 'checkpoint' ? 'flag-outline' : 'trail-sign-outline'}
            size={18}
            color={tokens.accent}
          />
        </View>
      </View>
    </Pressable>
  );
}

function GoalBar({
  icon,
  label,
  value,
  target,
  unit,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: number;
  target: number;
  unit: string;
}) {
  const { tokens } = useAppTheme();
  const fraction = Math.min(1, target > 0 ? value / target : 0);
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <Ionicons name={icon} size={14} color={tokens.textMuted} />
          <Text variant="caption">{label}</Text>
        </View>
        <Text variant="caption">
          {value}
          {unit} / {target}
          {unit}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-surface-2">
        <View className="h-full rounded-full bg-accent" style={{ width: `${fraction * 100}%` }} />
      </View>
    </View>
  );
}
