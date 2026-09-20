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

import { useQueryClient } from '@tanstack/react-query';

import { LevelChip, type CefrLevel } from '@/components/level-chip';
import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import {
  useBookmarkedStoryKeys,
  useDialogues,
  usePackClassification,
  usePacks,
  useStories,
  useStoryProgressList,
} from '@/db/hooks';
import type { PackRow, StoryListItem } from '@/db/repositories/content';
import type { DialogueListItem } from '@/db/repositories/dialogues';
import { readStateOf, type StoryProgressRow } from '@/db/repositories/reading';
import { DialogueRow } from '@/features/dialogue/dialogues-list-screen';
import { useImportedPackMeta } from '@/features/import/hooks';
import { ChipRow } from '@/features/library/category-chips';
import {
  ALL_GENRES,
  classificationEventProps,
  labelForCategory,
  type Classified,
} from '@/features/library/categories';
import {
  defaultRungLevel,
  groupByFamily,
  sharedShelfTags,
  type RungState,
} from '@/features/library/family-groups';
import { FamilyShelfHeader } from '@/features/library/family-shelf';
import {
  categoryChipItems,
  categoryCounts,
  filterSectionsByCategory,
  genreRowItems,
  orderRowsForCategory,
  storyRowCaption,
} from '@/features/library/library-filter';
import { SyncStatusLine } from '@/features/sync/sync-status-line';
import { runSync } from '@/features/sync/sync-service';
import { track } from '@/services/analytics';
import { useLibraryPrefs } from '@/store/library-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

/** T27: dialogue packs shelve beside stories — one row union per pack. */
type LibraryRow =
  { kind: 'story'; story: StoryListItem } | { kind: 'dialogue'; dialogue: DialogueListItem };

interface LibrarySection {
  pack: PackRow;
  data: LibraryRow[];
  /** T28: set on the first local-origin section — renders the «Импортировано» shelf divider. */
  shelfHeader?: string;
  /** T28: source label + imported date for local packs (from `imported_packs`). */
  importedMeta?: { sourceLabel: string | null; createdAt: number };
  /**
   * T30.1: set on a story-family shelf (≥2 installed packs sharing a
   * `family:<slug>` tag). `pack`/`data` above are the SELECTED rung's; the
   * header renders the level selector instead of the plain pack header.
   */
  family?: {
    slug: string;
    titleRu: string;
    tags: string[];
    rungs: RungState[];
    selectedLevel: CefrLevel;
  };
}

/** A pack the classification map hasn't seen (row just removed) — the dialogue default. */
const UNKNOWN_PACK: Classified = { category: 'stories', genre: null };

/**
 * Библиотека (design §7.2 nav / T04): installed packs with their stories —
 * level chips, tags, and the read-state each story carries (unread /
 * in-progress with % / finished). Tapping a story opens the reader.
 */
export function LibraryScreen() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const queryClient = useQueryClient();
  const packs = usePacks();
  const stories = useStories();
  const dialogues = useDialogues();
  const progressList = useStoryProgressList();
  const bookmarkedKeys = useBookmarkedStoryKeys();
  const importedMeta = useImportedPackMeta();
  // M14 (T45): the persisted shelf selection — category chips + genre sub-row.
  const category = useLibraryPrefs((s) => s.category);
  const genre = useLibraryPrefs((s) => s.genre);
  const setCategory = useLibraryPrefs((s) => s.setCategory);
  const setGenre = useLibraryPrefs((s) => s.setGenre);
  // M14 (T46): category/genre props for bookmark_* and dialogue_opened —
  // a memoized Map over the same usePacks() query, no extra read.
  const classification = usePackClassification();
  const eventPropsFor = React.useCallback(
    (packId: string) => classificationEventProps(classification.get(packId) ?? UNKNOWN_PACK),
    [classification],
  );

  // T24: long-press a story row to toggle its story bookmark (recorded
  // placement decision — the row press stays "open the reader").
  const toggleBookmark = React.useCallback(
    (packId: string, storyId: string) => {
      void repos.bookmarks.toggleStory(packId, storyId).then(({ added }) => {
        track(added ? 'bookmark_added' : 'bookmark_removed', {
          kind: 'story',
          from: 'library',
          ...eventPropsFor(packId),
        });
        void queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
      });
    },
    [queryClient, eventPropsFor],
  );

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

  const progressByStory = React.useMemo(() => {
    const map = new Map<string, StoryProgressRow>();
    for (const row of progressList.data ?? []) {
      map.set(`${row.packId}/${row.storyId}`, row);
    }
    return map;
  }, [progressList.data]);

  // T30.1: which rung each family shelf shows. Ephemeral per visit — on a
  // fresh mount the recorded default-rung rule picks (most-recently-read →
  // lowest unfinished → lowest). Switching writes zero progress.
  const [rungChoice, setRungChoice] = React.useState<Record<string, CefrLevel>>({});

  // Every installed pack as a plain section (stories + dialogue rows), in
  // pack-id order, before any category filter or family grouping. Split out
  // of the grouped list because the chip counts and the genre sub-row look
  // at ALL remote packs, not just the selected shelf.
  const { remoteAll, local } = React.useMemo(() => {
    if (!packs.data || !stories.data) {
      return { remoteAll: [] as LibrarySection[], local: [] as LibrarySection[] };
    }
    const build = (pack: PackRow): LibrarySection => ({
      pack,
      data: [
        ...stories.data
          .filter((s) => s.packId === pack.id)
          .map((story): LibraryRow => ({ kind: 'story', story })),
        ...(dialogues.data ?? [])
          .filter((d) => d.packId === pack.id)
          .map((dialogue): LibraryRow => ({ kind: 'dialogue', dialogue })),
      ],
    });
    const remoteAll = packs.data
      .filter((p) => p.origin !== 'local')
      .map(build)
      .filter((section) => section.data.length > 0);
    // T28: local (imported) packs shelve together under «Импортировано»,
    // after the remote content (design V2 §4.3) — and under EVERY category
    // (M14 §4.4: an imported paste has no category and must never vanish).
    const local = packs.data
      .filter((p) => p.origin === 'local')
      .map(build)
      .filter((section) => section.data.length > 0)
      .map((section) => ({
        ...section,
        importedMeta: importedMeta.data?.get(section.pack.id)
          ? {
              sourceLabel: importedMeta.data.get(section.pack.id)!.sourceLabel,
              createdAt: importedMeta.data.get(section.pack.id)!.createdAt,
            }
          : undefined,
      }));
    if (local[0]) local[0] = { ...local[0], shelfHeader: 'Импортировано' };
    return { remoteAll, local };
  }, [packs.data, stories.data, dialogues.data, importedMeta.data]);

  // M14 (T45): chip data — counts over every remote pack; the genre sub-row
  // only when ≥2 distinct genre values are installed under «Истории».
  // Memoized so a chip tap re-renders the header without remounting the list.
  const categoryItems = React.useMemo(
    () => categoryChipItems(categoryCounts(packs.data ?? []), category),
    [packs.data, category],
  );
  const genreItems = React.useMemo(
    () => (category === 'stories' ? genreRowItems(remoteAll) : null),
    [remoteAll, category],
  );
  // A persisted genre the row no longer offers (its last pack was removed,
  // or the row is hidden) must not keep filtering the shelf to nothing —
  // found on-device (T45): removing a1-comedy-090 with «Комедия» selected
  // produced a false «Пока пусто». Fall back to «Все» and heal the store.
  const genreStale =
    genre !== ALL_GENRES && !(genreItems?.some((item) => item.key === genre) ?? false);
  const effectiveGenre = genreStale ? ALL_GENRES : genre;
  React.useEffect(() => {
    if (genreStale && packs.data) setGenre(ALL_GENRES);
  }, [genreStale, packs.data, setGenre]);
  const installedInCategory = React.useCallback(
    (slug: string) => categoryItems.find((item) => item.key === slug)?.count ?? 0,
    [categoryItems],
  );

  // The selected shelf: filter BEFORE grouping so a family shelf can only
  // hold rungs of the selected category, then order each section's story
  // rows for the category (news = newest first).
  const remote = React.useMemo<LibrarySection[]>(() => {
    const rungStateOf = (section: LibrarySection): RungState => {
      const storyRows = section.data.filter((row) => row.kind === 'story');
      let finishedCount = 0;
      let lastReadAt: number | null = null;
      for (const row of storyRows) {
        if (row.kind !== 'story') continue;
        const progress = progressByStory.get(`${row.story.packId}/${row.story.id}`);
        if (!progress) continue;
        if (progress.finishedAt != null) finishedCount += 1;
        if (lastReadAt === null || progress.updatedAt > lastReadAt) {
          lastReadAt = progress.updatedAt;
        }
      }
      return { level: section.pack.level, storyCount: storyRows.length, finishedCount, lastReadAt };
    };
    // §4.3 row order: story rows sorted for the category; dialogue rows keep
    // their place after the stories (as today).
    const orderRows = (section: LibrarySection): LibrarySection => {
      const storyRows = section.data.filter((row) => row.kind === 'story');
      const ordered = orderRowsForCategory(
        category,
        storyRows.map((row) => ({ row, ...row.story })),
      ).map(({ row }) => row);
      return {
        ...section,
        data: [...ordered, ...section.data.filter((row) => row.kind !== 'story')],
      };
    };
    // T30.1: remote sections sharing a `family:<slug>` tag collapse into one
    // shelf at the lowest installed rung's list position (the CT002b fix —
    // a newly synced higher rung joins the shelf instead of appending at the
    // bottom). Single-member families and untagged packs pass through as-is.
    return groupByFamily(
      filterSectionsByCategory(remoteAll, { category, genre: effectiveGenre }).map(orderRows),
      (section) => ({
        packId: section.pack.id,
        level: section.pack.level,
        tags: section.pack.tags,
      }),
    ).map((group): LibrarySection => {
      if (group.kind === 'single') return group.item;
      // groupByFamily only emits families with ≥2 members — [0] is safe.
      const lowest = group.members[0]!;
      const rungs = group.members.map(rungStateOf);
      const chosen = rungChoice[group.slug];
      const selectedLevel =
        chosen && rungs.some((r) => r.level === chosen) ? chosen : defaultRungLevel(rungs);
      const selected = group.members.find((m) => m.pack.level === selectedLevel) ?? lowest;
      return {
        pack: selected.pack,
        data: selected.data,
        family: {
          slug: group.slug,
          titleRu: lowest.pack.titleRu,
          tags: sharedShelfTags(group.members.map((m) => m.pack.tags)),
          rungs,
          selectedLevel,
        },
      };
    });
  }, [remoteAll, category, effectiveGenre, progressByStory, rungChoice]);

  // The selected category has nothing installed while packs exist → the
  // «Пока пусто» block goes into the list header, with only the local
  // (imported) shelf as sections so pull-to-refresh and «Импортировано»
  // survive (§4.2). Zero packs total keeps «Библиотека пуста» below.
  const emptyCategory = remoteAll.length + local.length > 0 && remote.length === 0;
  const sections = React.useMemo<LibrarySection[]>(
    () => (emptyCategory ? local : [...remote, ...local]),
    [emptyCategory, remote, local],
  );

  // M14 §4.5: chip presses persist through the store and log only on a real
  // change (a tap on the selected chip is a no-op, no event).
  const onSelectCategory = React.useCallback(
    (to: string) => {
      if (to === category) return;
      track('library_category_switched', {
        from: category,
        to,
        installedPacks: installedInCategory(to),
      });
      setCategory(to);
    },
    [category, installedInCategory, setCategory],
  );
  const onSelectGenre = React.useCallback(
    (to: string) => {
      if (to === genre) return;
      track('library_genre_switched', { category, from: genre, to });
      setGenre(to);
    },
    [category, genre, setGenre],
  );

  // One library_empty_category_viewed per category per Library visit — the
  // set is cleared on blur (mirrors familySignature's once-per-visit rule).
  // Two focus effects on purpose: the first has no deps so its cleanup runs
  // only on blur (never on a chip tap), the second re-runs on focus AND on
  // every category change while focused.
  const emptyViewedRef = React.useRef(new Set<string>());
  useFocusEffect(
    React.useCallback(() => {
      const viewed = emptyViewedRef.current;
      return () => viewed.clear();
    }, []),
  );
  useFocusEffect(
    React.useCallback(() => {
      if (!emptyCategory || emptyViewedRef.current.has(category)) return;
      emptyViewedRef.current.add(category);
      track('library_empty_category_viewed', { category });
    }, [emptyCategory, category]),
  );

  const onSelectRung = React.useCallback(
    (slug: string, from: CefrLevel, to: CefrLevel, via: 'chip' | 'next-rung') => {
      setRungChoice((prev) => ({ ...prev, [slug]: to }));
      track(via === 'next-rung' ? 'family_next_rung_tapped' : 'family_rung_switched', {
        family: slug,
        from,
        to,
      });
    },
    [],
  );

  // One family_shelf_viewed per shelf per Library visit. The signature only
  // carries per-shelf identity (slug/rungs/levels), so rung switching does
  // not re-fire; data arriving after mount fires exactly once.
  const familySignature = React.useMemo(
    () =>
      sections
        .filter((s) => s.family)
        .map((s) => `${s.family!.slug}:${s.family!.rungs.map((r) => r.level).join(',')}`)
        .join('|'),
    [sections],
  );
  useFocusEffect(
    React.useCallback(() => {
      if (!familySignature) return;
      for (const entry of familySignature.split('|')) {
        const [slug = '', levels = ''] = entry.split(':');
        track('family_shelf_viewed', {
          family: slug,
          rungs: levels.split(',').length,
          levels,
        });
      }
    }, [familySignature]),
  );

  // §4.1: status line → category chips → genre chips → (empty block). All in
  // the list header so the chips scroll with the content (recorded decision:
  // sticky rows are out). Memoized on its inputs so a chip tap re-renders the
  // header alone — the SectionList keeps its scroll position and rows.
  const listHeader = React.useMemo(
    () => (
      <View className="-mx-4 gap-3 pb-1">
        <View className="px-4">
          <SyncStatusLine />
        </View>
        <ChipRow
          items={categoryItems}
          selected={category}
          onSelect={onSelectCategory}
          testID="library-category-chips"
        />
        {genreItems && (
          <ChipRow
            items={genreItems}
            selected={effectiveGenre}
            onSelect={onSelectGenre}
            size="sm"
            testID="library-genre-chips"
          />
        )}
        {emptyCategory && <EmptyCategory category={category} />}
      </View>
    ),
    [
      categoryItems,
      category,
      onSelectCategory,
      genreItems,
      effectiveGenre,
      onSelectGenre,
      emptyCategory,
    ],
  );

  if (packs.isPending || stories.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (packs.isError || stories.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError
          onRetry={() => {
            void packs.refetch();
            void stories.refetch();
          }}
        />
      </View>
    );
  }

  if (remoteAll.length === 0 && local.length === 0) {
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
      keyExtractor={(item) =>
        item.kind === 'story'
          ? `story/${item.story.packId}/${item.story.id}`
          : `dialogue/${item.dialogue.packId}/${item.dialogue.id}`
      }
      stickySectionHeadersEnabled={false}
      contentContainerClassName="px-4 pb-12 pt-2"
      refreshControl={refreshControl}
      ListHeaderComponent={listHeader}
      renderSectionHeader={({ section }) => (
        <View>
          {section.shelfHeader && (
            <View className="mt-8 flex-row items-center gap-2 border-b border-border pb-2">
              <Ionicons name="download-outline" size={16} color={tokens.textMuted} />
              <Text variant="caption" className="uppercase tracking-wider">
                {section.shelfHeader}
              </Text>
            </View>
          )}
          {section.family ? (
            <FamilyShelfHeader
              slug={section.family.slug}
              titleRu={section.family.titleRu}
              tags={section.family.tags}
              rungs={section.family.rungs}
              selectedLevel={section.family.selectedLevel}
              onSelectRung={(to, via) =>
                onSelectRung(section.family!.slug, section.family!.selectedLevel, to, via)
              }
            />
          ) : (
            <PackHeader pack={section.pack} importedMeta={section.importedMeta} />
          )}
        </View>
      )}
      renderItem={({ item }) =>
        item.kind === 'story' ? (
          <StoryRow
            story={item.story}
            progress={progressByStory.get(`${item.story.packId}/${item.story.id}`)}
            bookmarked={bookmarkedKeys.data?.has(`${item.story.packId}/${item.story.id}`) ?? false}
            onPress={() => router.push(`/reader/${item.story.packId}/${item.story.id}`)}
            onLongPress={() => toggleBookmark(item.story.packId, item.story.id)}
          />
        ) : (
          <View className="mb-2">
            <DialogueRow
              item={item.dialogue}
              onPress={() => {
                track('dialogue_opened', {
                  packId: item.dialogue.packId,
                  dialogueId: item.dialogue.id,
                  from: 'library',
                  ...eventPropsFor(item.dialogue.packId),
                });
                router.push(`/dialogue/${item.dialogue.packId}/${item.dialogue.id}`);
              }}
            />
          </View>
        )
      }
    />
  );
}

/**
 * §4.2 — the selected shelf has nothing installed (while other packs exist):
 * category icon + «Пока пусто» + one muted line. Lives inside the list header
 * so the «Импортировано» shelf still renders under it and pull-to-refresh
 * keeps working.
 */
function EmptyCategory({ category }: { category: string }) {
  const { tokens } = useAppTheme();
  const { icon } = labelForCategory(category);
  return (
    <View className="items-center gap-3 px-10 pb-6 pt-16">
      <Ionicons name={icon} size={40} color={tokens.textMuted} />
      <Text className="font-reading-bold text-xl">Пока пусто</Text>
      <Text variant="muted" className="text-center">
        Материалы для этой полки появятся после синхронизации.
      </Text>
    </View>
  );
}

function PackHeader({
  pack,
  importedMeta,
}: {
  pack: PackRow;
  importedMeta?: { sourceLabel: string | null; createdAt: number };
}) {
  return (
    <View className="mb-2 mt-6 gap-1.5">
      <View className="flex-row items-center gap-2">
        <LevelChip level={pack.level} />
        <Text className="flex-1 font-ui-medium text-lg" numberOfLines={1}>
          {pack.titleRu}
        </Text>
      </View>
      {importedMeta && (
        <Text variant="caption" numberOfLines={1}>
          {importedMeta.sourceLabel ? `${importedMeta.sourceLabel} · ` : ''}
          {new Date(importedMeta.createdAt).toLocaleDateString()}
        </Text>
      )}
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
  bookmarked,
  onPress,
  onLongPress,
}: {
  story: StoryListItem;
  progress: StoryProgressRow | undefined;
  bookmarked: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { tokens } = useAppTheme();
  const state = readStateOf(progress);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Read ${story.titleRu}. Long press to ${bookmarked ? 'remove the' : 'add a'} bookmark`}
      className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 active:bg-surface-2"
    >
      <View className="flex-1 gap-0.5">
        <Text
          className={`font-reading text-base ${state === 'finished' ? 'text-text-muted' : ''}`}
          numberOfLines={1}
        >
          {story.titleRu}
        </Text>
        {/* M14 §4.3: dek / episode tagline as a muted second line; the
            caption becomes `source · date` for sourced rows. Fiction rows
            (no subtitle, no source) render exactly as before. */}
        {story.subtitleRu && (
          <Text variant="muted" numberOfLines={1}>
            {story.subtitleRu}
          </Text>
        )}
        <Text variant="caption" numberOfLines={1}>
          {storyRowCaption(story)}
        </Text>
      </View>
      {bookmarked && <Ionicons name="bookmark" size={14} color={tokens.accent} />}
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
