import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  View,
} from 'react-native';

import { LevelChip } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { usePacks, useStories, useStoryProgressList } from '@/db/hooks';
import type { PackRow, StoryListItem } from '@/db/repositories/content';
import { readStateOf, type StoryProgressRow } from '@/db/repositories/reading';
import { SyncStatusLine } from '@/features/sync/sync-status-line';
import { runSync } from '@/features/sync/sync-service';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

interface LibrarySection {
  pack: PackRow;
  data: StoryListItem[];
}

/**
 * Библиотека (design §7.2 nav / T04): installed packs with their stories —
 * level chips, tags, and the read-state each story carries (unread /
 * in-progress with % / finished). Tapping a story opens the reader.
 */
export function LibraryScreen() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const packs = usePacks();
  const stories = useStories();
  const progressList = useStoryProgressList();

  useFocusEffect(
    React.useCallback(() => {
      track('tab_viewed', { tab: 'Библиотека' });
    }, []),
  );

  // Pull-to-refresh always forces a sync check, bypassing the throttle
  // (T07 ticket item 6). Content queries invalidate inside runSync.
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    void runSync({ trigger: 'manual' }).finally(() => setRefreshing(false));
  }, []);
  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={tokens.accent}
      colors={[tokens.accent]}
      progressBackgroundColor={tokens.surface}
    />
  );

  const sections = React.useMemo<LibrarySection[]>(() => {
    if (!packs.data || !stories.data) return [];
    return packs.data
      .map((pack) => ({
        pack,
        data: stories.data.filter((s) => s.packId === pack.id),
      }))
      .filter((section) => section.data.length > 0);
  }, [packs.data, stories.data]);

  const progressByStory = React.useMemo(() => {
    const map = new Map<string, StoryProgressRow>();
    for (const row of progressList.data ?? []) {
      map.set(`${row.packId}/${row.storyId}`, row);
    }
    return map;
  }, [progressList.data]);

  if (packs.isPending || stories.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (sections.length === 0) {
    return (
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerClassName="flex-1 items-center justify-center gap-3 px-10"
        refreshControl={refreshControl}
      >
        <Ionicons name="library-outline" size={40} color={tokens.textMuted} />
        <Text className="font-reading-bold text-xl">Библиотека пуста</Text>
        <Text variant="muted" className="text-center">
          Sample packs import on first run; pull to sync new stories from the content repo.
        </Text>
        <SyncStatusLine />
      </ScrollView>
    );
  }

  return (
    <SectionList
      className="flex-1 bg-bg"
      sections={sections}
      keyExtractor={(item) => `${item.packId}/${item.id}`}
      stickySectionHeadersEnabled={false}
      contentContainerClassName="px-4 pb-12 pt-2"
      refreshControl={refreshControl}
      ListHeaderComponent={<SyncStatusLine />}
      renderSectionHeader={({ section }) => <PackHeader pack={section.pack} />}
      renderItem={({ item }) => (
        <StoryRow
          story={item}
          progress={progressByStory.get(`${item.packId}/${item.id}`)}
          onPress={() => router.push(`/reader/${item.packId}/${item.id}`)}
        />
      )}
    />
  );
}

function PackHeader({ pack }: { pack: PackRow }) {
  return (
    <View className="mb-2 mt-6 gap-1.5">
      <View className="flex-row items-center gap-2">
        <LevelChip level={pack.level} />
        <Text className="flex-1 font-ui-medium text-lg" numberOfLines={1}>
          {pack.titleRu}
        </Text>
      </View>
      {pack.tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {pack.tags.map((tag) => (
            <View key={tag} className="rounded-full bg-surface-2 px-2 py-0.5">
              <Text variant="caption" className="text-xs">
                {tag}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function StoryRow({
  story,
  progress,
  onPress,
}: {
  story: StoryListItem;
  progress: StoryProgressRow | undefined;
  onPress: () => void;
}) {
  const state = readStateOf(progress);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Read ${story.titleRu}`}
      className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 active:bg-surface-2"
    >
      <View className="flex-1 gap-0.5">
        <Text
          className={`font-reading text-base ${state === 'finished' ? 'text-text-muted' : ''}`}
          numberOfLines={1}
        >
          {story.titleRu}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {story.titleEn} · {story.sentenceCount} sentences
        </Text>
      </View>
      <ReadStateBadge state={state} progress={progress} sentenceCount={story.sentenceCount} />
    </Pressable>
  );
}

function ReadStateBadge({
  state,
  progress,
  sentenceCount,
}: {
  state: ReturnType<typeof readStateOf>;
  progress: StoryProgressRow | undefined;
  sentenceCount: number;
}) {
  const { tokens } = useAppTheme();
  if (state === 'finished') {
    return (
      <View className="flex-row items-center gap-1" accessibilityLabel="Finished">
        <Ionicons name="checkmark-circle" size={18} color={tokens.accent} />
      </View>
    );
  }
  if (state === 'in-progress') {
    const pct = Math.min(
      99,
      Math.round((((progress?.currentSentenceIdx ?? 0) + 1) / Math.max(1, sentenceCount)) * 100),
    );
    return (
      <Text variant="caption" className="text-accent" accessibilityLabel={`${pct}% read`}>
        {pct}%
      </Text>
    );
  }
  return (
    <Ionicons name="ellipse-outline" size={14} color={tokens.border} accessibilityLabel="Unread" />
  );
}
