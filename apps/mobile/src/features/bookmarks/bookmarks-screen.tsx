import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useResolvedBookmarks, type ResolvedBookmark } from '@/db/hooks';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * «Закладки» (T24, V2 §7.1) — reached from the Словарь header. Story and
 * sentence bookmarks in two sections, newest first; tapping opens the reader
 * (sentences scroll straight to their spot via the T04 restore path). A
 * bookmark whose pack was removed stays listed in a clear degraded state —
 * removable, never a crash.
 */
export function BookmarksScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const queryClient = useQueryClient();
  const bookmarks = useResolvedBookmarks();

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
  }, [queryClient]);

  const remove = React.useCallback(
    (row: ResolvedBookmark) => {
      track('bookmark_removed', { kind: row.kind, from: 'bookmarks-list' });
      void repos.bookmarks.remove(row.id).then(invalidate);
    },
    [invalidate],
  );

  const open = React.useCallback(
    (row: ResolvedBookmark) => {
      track('bookmark_opened', { kind: row.kind });
      router.push({
        pathname: '/reader/[packId]/[storyId]',
        params: {
          packId: row.packId,
          storyId: row.storyId,
          ...(row.kind === 'sentence' && row.sentenceOrderIdx != null
            ? { sentenceIdx: String(row.sentenceOrderIdx) }
            : {}),
          from: 'bookmarks',
        },
      });
    },
    [router],
  );

  if (bookmarks.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (bookmarks.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void bookmarks.refetch()} />
      </View>
    );
  }

  const rows = bookmarks.data ?? [];
  const storyRows = rows.filter((r) => r.kind === 'story');
  const sentenceRows = rows.filter((r) => r.kind === 'sentence');

  if (rows.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-10">
        <Ionicons name="bookmark-outline" size={40} color={theme.textMuted} />
        <Text className="font-reading-bold text-xl">Закладок нет</Text>
        <Text variant="muted" className="text-center">
          Bookmark a story from its reader header, or a sentence from its revealed translation row.
          Everything you mark lands here.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-bg px-4 pt-2" contentContainerClassName="pb-16 gap-2">
      {storyRows.length > 0 && (
        <Text variant="caption" className="mt-2 uppercase tracking-wider">
          Истории · {storyRows.length}
        </Text>
      )}
      {storyRows.map((row) => (
        <BookmarkCard
          key={row.id}
          row={row}
          onOpen={() => open(row)}
          onRemove={() => remove(row)}
        />
      ))}
      {sentenceRows.length > 0 && (
        <Text variant="caption" className="mt-3 uppercase tracking-wider">
          Предложения · {sentenceRows.length}
        </Text>
      )}
      {sentenceRows.map((row) => (
        <BookmarkCard
          key={row.id}
          row={row}
          onOpen={() => open(row)}
          onRemove={() => remove(row)}
        />
      ))}
    </ScrollView>
  );
}

function BookmarkCard({
  row,
  onOpen,
  onRemove,
}: {
  row: ResolvedBookmark;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const removed = row.storyTitleRu == null;
  const title = row.storyTitleRu ?? row.storyId;
  return (
    <View className="flex-row items-center gap-2 rounded-xl border border-border bg-surface p-3">
      <Pressable
        onPress={onOpen}
        disabled={removed}
        accessibilityRole="button"
        accessibilityLabel={`Open bookmark in ${title}`}
        className={`flex-1 gap-0.5 ${removed ? 'opacity-50' : 'active:opacity-80'}`}
      >
        <View className="flex-row items-center gap-2">
          <Ionicons
            name={row.kind === 'story' ? 'book-outline' : 'bookmark'}
            size={14}
            color={removed ? theme.textMuted : theme.accent}
          />
          <Text className="flex-1 font-ui-medium text-sm" numberOfLines={1}>
            {title}
          </Text>
        </View>
        {row.kind === 'sentence' && (
          <Text className="font-reading text-sm leading-5" numberOfLines={2}>
            {row.sentenceRu ?? '—'}
          </Text>
        )}
        <Text variant="caption" numberOfLines={1}>
          {removed ? 'Контент удалён — the pack is no longer installed' : row.packTitleRu}
        </Text>
      </Pressable>
      <Pressable
        onPress={onRemove}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Remove bookmark"
        className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-2"
      >
        <Ionicons name="trash-outline" size={16} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}
