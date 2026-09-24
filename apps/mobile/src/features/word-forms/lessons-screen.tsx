import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, SectionList, TextInput, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { useLessons } from '@/db/hooks';
import type { GrammarLessonRow } from '@/db/repositories/word-forms';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatReceiptTime, receiptBadges, sectionTitleById } from './format';
import { groupByDay } from './lesson-core';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Global Lessons screen (WORD_FORMS §7.3, route `app/lessons/index`; entry
 * = the `school-outline` icon in the dictionary tab header): search box
 * (headword, ё/е-tolerant through the repository's normalized match), the
 * list newest first grouped by local day with receipt badges, the empty
 * state «No lessons yet — open a word → Forms → Learn», pagination by
 * `limit/offset` 50 («Load more» = the infinite query's next page).
 * Read-only, works offline.
 */
export function LessonsScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const [search, setSearch] = React.useState('');
  const [query, setQuery] = React.useState('');
  const lessons = useLessons(query);

  React.useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    track('lessons_screen_opened');
  }, []);

  const rows = React.useMemo(() => lessons.data?.pages.flat() ?? [], [lessons.data]);
  const groups = React.useMemo(() => groupByDay(rows), [rows]);

  const open = React.useCallback(
    (id: string) => {
      track('lesson_opened', { from: 'global' });
      router.push({ pathname: '/lessons/[id]', params: { id } });
    },
    [router],
  );

  return (
    <View className="flex-1 bg-bg">
      {/* search-first header (the Словарь pattern) */}
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-3">
        <View className="flex-1 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Ionicons name="search" size={16} color={theme.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search lessons by word…"
            placeholderTextColor={theme.textMuted}
            autoCorrect={false}
            className="flex-1 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Search lessons"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={theme.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {lessons.isPending ? (
        <View className="items-center py-12">
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : lessons.isError ? (
        <View className="px-4 pt-4">
          <QueryError onRetry={() => void lessons.refetch()} />
        </View>
      ) : (
        <SectionList
          sections={groups.map((g) => ({ title: g.label, key: g.day, data: g.rows }))}
          keyExtractor={(row) => row.id}
          stickySectionHeadersEnabled={false}
          contentContainerClassName="px-4 pb-16"
          keyboardShouldPersistTaps="handled"
          renderSectionHeader={({ section }) => (
            <Text variant="caption" className="mb-2 mt-5 uppercase tracking-wider">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => <LessonRow row={item} onPress={() => open(item.id)} />}
          ItemSeparatorComponent={() => <View className="h-2" />}
          ListEmptyComponent={
            <View className="mt-10 items-center gap-2 rounded-xl border border-border bg-surface px-6 py-10">
              <Ionicons name="school-outline" size={26} color={theme.textMuted} />
              <Text className="font-ui-medium text-lg">
                {query ? 'No lessons match' : 'No lessons yet'}
              </Text>
              <Text variant="caption" className="text-center">
                {query
                  ? `Nothing for «${query}» — try a shorter stem.`
                  : 'Open a word → Forms → Learn to create your first one.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            lessons.hasNextPage ? (
              <Pressable
                onPress={() => void lessons.fetchNextPage()}
                disabled={lessons.isFetchingNextPage}
                accessibilityRole="button"
                accessibilityLabel="Load more lessons"
                accessibilityState={{ busy: lessons.isFetchingNextPage }}
                className="mt-4 items-center rounded-xl border border-border bg-surface py-3 active:bg-surface-2"
              >
                {lessons.isFetchingNextPage ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <Text className="font-ui-medium text-sm text-accent">Load more</Text>
                )}
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  );
}

function LessonRow({ row, onPress }: { row: GrammarLessonRow; onPress: () => void }) {
  const { tokens: theme } = useAppTheme();
  const title = sectionTitleById(row.sectionId);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.headword}, ${title.en}`}
      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2"
    >
      <View className="flex-1">
        <View className="flex-row items-baseline gap-2">
          <Text className="font-reading text-lg text-text">{row.headword}</Text>
          <Text variant="caption" className="flex-shrink" numberOfLines={1}>
            {title.en}
          </Text>
        </View>
        <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
          <Text variant="caption" className="text-xs">
            {formatReceiptTime(row.createdAt)}
          </Text>
          {receiptBadges(row).map((badge) => (
            <View key={badge} className="rounded-full bg-surface-2 px-1.5 py-px">
              <Text className="font-ui-medium text-xs text-text-muted">{badge}</Text>
            </View>
          ))}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </Pressable>
  );
}
