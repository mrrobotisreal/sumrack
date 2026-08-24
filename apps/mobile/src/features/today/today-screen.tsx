import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import {
  useDueCardCount,
  useProductionDueCount,
  useStories,
  useStoryProgressList,
} from '@/db/hooks';
import { GoalRingCard } from '@/features/motivation/goal-ring-card';
import { NotificationPromptCard } from '@/features/motivation/notification-prompt-card';
import type { PathNode } from '@/features/path/path-model';
import { isUnit, nextStepInfo, usePathState } from '@/features/path/use-path';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Сегодня (design §10, UI_DESIGN §4): one viewport answering, top to
 * bottom — goal/streak state (the real T19 ring over daily_activity +
 * the motivation snapshot), what's due (session CTA), where I left off
 * (continue-reading card).
 */
export function TodayScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();

  const due = useDueCardCount();
  const productionDue = useProductionDueCount();
  const progressList = useStoryProgressList();
  const stories = useStories();
  const path = usePathState();

  // Counts change while this tab is unfocused (sessions, reading) — refresh on return.
  useFocusEffect(
    React.useCallback(() => {
      track('tab_viewed', { tab: 'Сегодня' });
      void queryClient.invalidateQueries({ queryKey: ['due-count'] });
      void queryClient.invalidateQueries({ queryKey: ['daily-activity'] });
      void queryClient.invalidateQueries({ queryKey: ['motivation'] });
      void queryClient.invalidateQueries({ queryKey: ['story-progress'] });
      void queryClient.invalidateQueries({ queryKey: ['path'] });
    }, [queryClient]),
  );

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

  const coreQueries = [due, productionDue, progressList, stories, path];
  const loading = coreQueries.some((q) => q.isPending);
  const anyError = coreQueries.some((q) => q.isError);

  if (loading) {
    // NativeWind has no `animate-pulse` (no CSS animation engine on native) —
    // static bg-surface blocks stand in for the real cards' shapes so the
    // first frame never flashes a false "0 due".
    return (
      <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-4 px-4 pb-16 pt-4">
        <View className="h-28 rounded-xl bg-surface opacity-60" />
        <View className="h-32 rounded-xl bg-surface opacity-60" />
        <View className="h-20 rounded-xl bg-surface opacity-60" />
      </ScrollView>
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
      {/* the real goal ring + streak flame + freezes + XP (T19) */}
      <GoalRingCard />

      {/* one-time reminders opt-in, once there's a streak to protect (T19) */}
      <NotificationPromptCard />

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
