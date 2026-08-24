import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';

import { LevelChip, type CefrLevel } from '@/components/level-chip';
import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { useBankFilterOptions, useBankItems, useStories } from '@/db/hooks';
import type { BankFilter, BankListItem } from '@/db/repositories/bank';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

type KindFilter = 'all' | 'word' | 'phrase';

/**
 * Словарь (design §7.2): the word bank as a reference tool — dense list,
 * search-first, filters as chips (UI_DESIGN §4). Search is ё/е-tolerant via
 * the bank repo's normalized matching (T03 convention, first UI-visible
 * here). Mastery filter is a placeholder slot until T06 brings FSRS bands.
 */
export function WordBankScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();

  const [search, setSearch] = React.useState('');
  const [kind, setKind] = React.useState<KindFilter>('all');
  const [level, setLevel] = React.useState<CefrLevel | null>(null);
  const [pos, setPos] = React.useState<string | null>(null);
  const [sourceStoryId, setSourceStoryId] = React.useState<string | null>(null);
  const [needsInfo, setNeedsInfo] = React.useState(false);

  const deferredSearch = React.useDeferredValue(search);

  useFocusEffect(
    React.useCallback(() => {
      track('tab_viewed', { tab: 'Словарь' });
    }, []),
  );

  React.useEffect(() => {
    if (deferredSearch.trim()) track('bank_searched', { chars: deferredSearch.trim().length });
  }, [deferredSearch]);

  const filter = React.useMemo<BankFilter>(
    () => ({
      search: deferredSearch.trim() || undefined,
      kind: kind === 'all' ? undefined : kind,
      level: level ?? undefined,
      pos: pos ?? undefined,
      sourceStoryId: sourceStoryId ?? undefined,
      needsEnrichment: needsInfo ? true : undefined,
    }),
    [deferredSearch, kind, level, pos, sourceStoryId, needsInfo],
  );

  const items = useBankItems(filter);
  const options = useBankFilterOptions();
  const stories = useStories();
  /** Flagged-for-enrichment count drives the T16 call-to-action banner. */
  const enrichable = useBankItems({ needsEnrichment: true, limit: 200 });

  const storyTitles = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stories.data ?? []) map.set(s.id, s.titleRu);
    return map;
  }, [stories.data]);

  const anyFilterActive =
    kind !== 'all' || level != null || pos != null || sourceStoryId != null || needsInfo;

  return (
    <View className="flex-1 bg-bg">
      {/* search-first header */}
      <View className="flex-row items-center gap-2 px-4 pb-2 pt-3">
        <View className="flex-1 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3">
          <Ionicons name="search" size={16} color={theme.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search words and phrases…"
            placeholderTextColor={theme.textMuted}
            autoCorrect={false}
            className="flex-1 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Search word bank"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={theme.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => router.push('/word-bank/add')}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Add a word manually"
          className="h-11 w-11 items-center justify-center rounded-xl bg-accent active:opacity-80"
        >
          <Ionicons name="add" size={24} color={theme.bg} />
        </Pressable>
      </View>

      {/* filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="items-center gap-2 px-4 pb-2"
        className="max-h-11 shrink-0 grow-0"
      >
        <FilterChip
          label={kind === 'word' ? 'Words' : kind === 'phrase' ? 'Phrases' : 'All'}
          icon="albums-outline"
          active={kind !== 'all'}
          onPress={() => {
            const next: KindFilter = kind === 'all' ? 'word' : kind === 'word' ? 'phrase' : 'all';
            setKind(next);
            track('bank_filter_changed', { filter: 'kind', value: next });
          }}
        />
        {(options.data?.levels ?? []).map((l) => (
          <FilterChip
            key={l}
            label={l}
            active={level === l}
            onPress={() => {
              setLevel(level === l ? null : l);
              track('bank_filter_changed', { filter: 'level', value: l });
            }}
          />
        ))}
        {(options.data?.pos ?? []).map((p) => (
          <FilterChip
            key={p}
            label={p}
            active={pos === p}
            onPress={() => {
              setPos(pos === p ? null : p);
              track('bank_filter_changed', { filter: 'pos', value: p });
            }}
          />
        ))}
        {(options.data?.sourceStoryIds ?? []).map((sid) => (
          <FilterChip
            key={sid}
            label={storyTitles.get(sid) ?? sid}
            icon="book-outline"
            active={sourceStoryId === sid}
            onPress={() => {
              setSourceStoryId(sourceStoryId === sid ? null : sid);
              track('bank_filter_changed', { filter: 'source', value: sid });
            }}
          />
        ))}
        <FilterChip
          label="Needs info"
          icon="help-circle-outline"
          active={needsInfo}
          onPress={() => {
            setNeedsInfo(!needsInfo);
            track('bank_filter_changed', { filter: 'needsInfo', value: !needsInfo });
          }}
        />
        {/* Mastery bands arrive with FSRS in T06 — slot reserved, inert. */}
        <FilterChip label="Mastery · T06" icon="hourglass-outline" active={false} disabled />
      </ScrollView>

      {/* enrichment call-to-action (T16): visible whenever items are flagged */}
      {(enrichable.data?.length ?? 0) > 0 && (
        <Pressable
          onPress={() => router.push('/word-bank/enrich')}
          accessibilityRole="button"
          className="mx-4 mb-2 flex-row items-center gap-3 rounded-xl border border-accent/40 bg-surface px-4 py-3 active:bg-surface-2"
        >
          <Ionicons name="sparkles-outline" size={16} color={theme.accent} />
          <View className="flex-1">
            <Text className="font-ui-medium text-sm">
              {enrichable.data!.length} {enrichable.data!.length === 1 ? 'item' : 'items'} missing
              details
            </Text>
            <Text variant="caption">Let AI propose lemma, translation, and grammar</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
        </Pressable>
      )}

      {items.isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : items.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <QueryError onRetry={() => void items.refetch()} />
        </View>
      ) : (items.data?.length ?? 0) === 0 ? (
        <EmptyState searching={!!deferredSearch.trim() || anyFilterActive} />
      ) : (
        <FlatList
          data={items.data}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-12"
          renderItem={({ item }) => (
            <BankRow item={item} onPress={() => router.push(`/word-bank/${item.id}`)} />
          )}
        />
      )}
    </View>
  );
}

function FilterChip({
  label,
  icon,
  active,
  disabled,
  onPress,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      accessibilityLabel={`Filter: ${label}`}
      className={`flex-row items-center gap-1 rounded-full border px-3 py-1.5 ${
        active ? 'border-accent bg-accent-soft' : 'border-border bg-surface active:bg-surface-2'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      {icon && <Ionicons name={icon} size={13} color={active ? theme.accent : theme.textMuted} />}
      <Text className={`text-sm ${active ? 'font-ui-medium text-accent' : 'text-text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function BankRow({ item, onPress }: { item: BankListItem; onPress: () => void }) {
  const { tokens: theme } = useAppTheme();
  const headword = item.kind === 'word' ? (item.lemma ?? item.surface) : item.surface;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${headword}`}
      className="flex-row items-center gap-3 border-b border-border/60 py-3 active:bg-surface"
    >
      <Ionicons
        name={item.kind === 'phrase' ? 'chatbox-ellipses-outline' : 'text-outline'}
        size={16}
        color={theme.textMuted}
      />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="font-reading text-base" numberOfLines={1}>
            {headword}
          </Text>
          {item.needsEnrichment && <Ionicons name="help-circle" size={14} color={theme.danger} />}
        </View>
        <Text variant="caption" numberOfLines={1}>
          {item.translation || '—'}
        </Text>
      </View>
      {item.encounterCount > 1 && (
        <Text variant="caption" accessibilityLabel={`${item.encounterCount} encounters`}>
          ×{item.encounterCount}
        </Text>
      )}
      {item.level && <LevelChip level={item.level} />}
    </Pressable>
  );
}

function EmptyState({ searching }: { searching: boolean }) {
  const { tokens: theme } = useAppTheme();
  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      <Ionicons name="bookmarks-outline" size={40} color={theme.textMuted} />
      <Text className="font-reading-bold text-xl">
        {searching ? 'Ничего не найдено' : 'Словарь пуст'}
      </Text>
      <Text variant="muted" className="text-center">
        {searching
          ? 'Nothing matches. Search is ё/е-tolerant — try fewer letters or clear the filters.'
          : 'Tap a word while reading to look it up, or long-press and drag to collect a phrase. Everything you save lands here.'}
      </Text>
    </View>
  );
}
