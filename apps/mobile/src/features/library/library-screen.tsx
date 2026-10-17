import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  UIManager,
  View,
} from 'react-native';

import { useQuery, useQueryClient } from '@tanstack/react-query';

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
import { ListenRow } from '@/features/library/listen-row';
import {
  assembleRows,
  withListenRow,
  type ListenRowItem,
} from '@/features/library/listen-row-model';
import { useListenNowPlaying } from '@/features/library/listen-now-playing';
import { useListenProgress } from '@/features/library/listen-progress';
import {
  ALL_GENRES,
  classificationEventProps,
  labelForCategory,
  type Classified,
} from '@/features/library/categories';
import {
  CEFR_ORDER,
  defaultRungLevel,
  groupByFamily,
  sharedShelfTags,
  type RungState,
} from '@/features/library/family-groups';
import {
  ancestorKeysFor,
  bookKey,
  familyKey,
  packKey,
  sectionDataFor,
  summarizeStories,
  type AncestorSection,
} from '@/features/library/expansion';
import { FamilyShelfHeader } from '@/features/library/family-shelf';
import {
  categoryChipItems,
  categoryCounts,
  filterSectionsByCategory,
  genreRowItems,
  orderRowsForCategory,
  storyRowCaption,
} from '@/features/library/library-filter';
import { chapterLabel, groupBySeries, seriesBookTitle } from '@/features/library/series';
import { resolveContinueTarget } from '@/features/reader/continue-target';
import { SyncStatusLine } from '@/features/sync/sync-status-line';
import { ExamRow } from '@/features/torfl/exam-row';
import type { ExamListItem } from '@/features/torfl/hub-model';
import { useExamListItems } from '@/features/torfl/hooks';
import { isTorflCategory, levelForCategory } from '@/features/torfl/level-profile';
import { TorflHubCard } from '@/features/torfl/torfl-hub-card';
import { runSync } from '@/features/sync/sync-service';
import { track } from '@/services/analytics';
import { useLibraryExpansion } from '@/store/library-expansion';
import { useLibraryPrefs } from '@/store/library-prefs';
import { useReduceMotion } from '@/store/motion-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * T27: dialogue packs shelve beside stories — one row union per pack.
 * M18 (T69): an exam pack's rows are its EXAMS (TORFL §5.2 item 3) — its
 * stories are never Library rows (decision 3; still searchable).
 */
type LibraryRow =
  | { kind: 'story'; story: StoryListItem }
  | { kind: 'dialogue'; dialogue: DialogueListItem }
  | { kind: 'exam'; exam: ExamListItem }
  /** M26 (T97): «Прослушать всю историю» — first row of a stories section with listenable audio. */
  | ListenRowItem
  /** T86: a chapter inside a series book (its own family/pack section, collapsed by default). */
  | { kind: 'chapter'; section: LibrarySection; chapter: number };

/**
 * T86: one chapter of a series book. Its `section` is a normal section (family
 * shelf or single pack) — collapsed until tapped, then expands to its parts.
 */
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
    /** T86: every installed rung's pack id (the shelf expands for any of them). */
    packIds: string[];
  };
  /**
   * T86: set on a series book section (a `series` + `book` group). `data` holds
   * its chapter rows (ordered by chapter number), each expanding to its parts.
   */
  book?: {
    series: string;
    book: number;
    titleRu: string;
    subtitle?: string;
    chapters: { chapter: number; section: LibrarySection }[];
  };
}

/** T86: the ancestor-lookup view of a section (its packs and its series chain). */
function toAncestorSection(section: LibrarySection): AncestorSection {
  return {
    packIds: section.family ? section.family.packIds : [section.pack.id],
    family: section.family ? { slug: section.family.slug } : undefined,
    book: section.book
      ? {
          series: section.book.series,
          book: section.book.book,
          chapters: section.book.chapters.map((c) => ({
            chapter: c.chapter,
            section: toAncestorSection(c.section),
          })),
        }
      : undefined,
  };
}

/** A pack the classification map hasn't seen (row just removed) — the dialogue default. */
const UNKNOWN_PACK: Classified = { category: 'stories', genre: null };

// T86: Android needs this flag before LayoutAnimation does anything (once per
// process; the module loads once). Guarded so iOS and the new arch are untouched.
UIManager.setLayoutAnimationEnabledExperimental?.(true);

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
  const examItems = useExamListItems();
  // M26 (T97): full-story listen availability per pack (one query over all packs).
  const packIds = React.useMemo(() => (packs.data ?? []).map((p) => p.id), [packs.data]);
  const listenAvailability = useQuery({
    queryKey: ['listen', 'availability', packIds],
    queryFn: () => repos.listen.listListenAvailability(packIds),
    enabled: packIds.length > 0,
  });
  const listenProgress = useListenProgress();
  const listenNowPlaying = useListenNowPlaying();
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

  // T86: accordion expansion. Persisted keys (store) plus a mount-only set of
  // the continue target's ancestors — never written to the store.
  const expandedKeys = useLibraryExpansion((s) => s.keys);
  const toggleExpanded = useLibraryExpansion((s) => s.toggle);
  const setAllExpanded = useLibraryExpansion((s) => s.setAll);
  const reduceMotion = useReduceMotion();
  const persistedSet = React.useMemo(() => new Set(expandedKeys), [expandedKeys]);

  // Mount-only: the continue target's section and its book/chapter ancestors
  // expand for THIS visit only and are never written to the store (ticket
  // decision 5). Derived once, the first render where sections exist; the
  // state is set during render (not in an effect) so it never re-derives.
  const [continueAncestors, setContinueAncestors] = React.useState<ReadonlySet<string> | null>(
    null,
  );

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
      data:
        pack.type === 'exam'
          ? examItems.items
              .filter((e) => e.packId === pack.id)
              .map((exam): LibraryRow => ({ kind: 'exam', exam }))
          : withListenRow<LibraryRow>(
              [
                ...stories.data
                  .filter((s) => s.packId === pack.id)
                  .map((story): LibraryRow => ({ kind: 'story', story })),
                ...(dialogues.data ?? [])
                  .filter((d) => d.packId === pack.id)
                  .map((dialogue): LibraryRow => ({ kind: 'dialogue', dialogue })),
              ],
              pack,
              listenAvailability.data,
            ),
    });
    // T89: course packs (HOTEL_PATH §3) are never a Library shelf, local or remote.
    const remoteAll = packs.data
      .filter((p) => p.origin !== 'local' && p.type !== 'course')
      .map(build)
      .filter((section) => section.data.length > 0);
    // T28: local (imported) packs shelve together under «Импортировано»,
    // after the remote content (design V2 §4.3) — and under EVERY category
    // (M14 §4.4: an imported paste has no category and must never vanish).
    const local = packs.data
      .filter((p) => p.origin === 'local' && p.type !== 'course')
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
  }, [
    packs.data,
    stories.data,
    dialogues.data,
    importedMeta.data,
    examItems.items,
    listenAvailability.data,
  ]);

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
      // M26 (T97): the listen row stays first, then stories, then the rest.
      return { ...section, data: assembleRows(section.data, ordered) };
    };
    // T30.1: remote sections sharing a `family:<slug>` tag collapse into one
    // shelf at the lowest installed rung's list position (the CT002b fix —
    // a newly synced higher rung joins the shelf instead of appending at the
    // bottom). Single-member families and untagged packs pass through as-is.
    const families = groupByFamily(
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
          packIds: group.members.map((m) => m.pack.id),
        },
      };
    });

    // T86: series packs (series + book + chapter tags) collapse into one book
    // per (series, book). Each chapter is a family/single section, its own
    // collapsed row; the book is positioned at its first member.
    return groupBySeries(families, (section) => section.pack.tags).map((group): LibrarySection => {
      if (group.kind === 'plain') return group.item;
      const first = group.chapters[0]!.item;
      const chapters = group.chapters.map(({ chapter, item }) => ({ chapter, section: item }));
      const bookTitle = seriesBookTitle(group.series, group.book, first.pack.titleRu);
      return {
        pack: first.pack,
        data: chapters.map((c): LibraryRow => ({
          kind: 'chapter',
          section: c.section,
          chapter: c.chapter,
        })),
        book: {
          series: group.series,
          book: group.book,
          titleRu: bookTitle.title,
          subtitle: bookTitle.subtitle,
          chapters,
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

  // T86 decision 5: once the sections exist, find the section holding the
  // continue target and expand its ancestors for this visit (not persisted).
  if (
    continueAncestors === null &&
    stories.data &&
    progressList.data &&
    (remote.length > 0 || local.length > 0)
  ) {
    const target = resolveContinueTarget(progressList.data, stories.data);
    setContinueAncestors(
      new Set(target ? ancestorKeysFor(sections.map(toAncestorSection), target.packId) : []),
    );
  }
  // A user toggle always wins over the continue-target ancestors: once a key is
  // touched (either way) it is removed from the ephemeral set for this visit.
  const [touchedKeys, setTouchedKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  const expandedSetForRender = React.useMemo(() => {
    const ancestors = [...(continueAncestors ?? [])].filter((k) => !touchedKeys.has(k));
    return new Set([...persistedSet, ...ancestors]);
  }, [persistedSet, continueAncestors, touchedKeys]);

  // T86 toolbar: «Свернуть всё» when anything is open, else «Развернуть всё».
  // Expand-all adds only the top-level keys (packs, families, books); chapters
  // stay collapsed. Collapse-all clears everything (persisted).
  const topLevelKeys = React.useMemo(() => collectTopLevelKeys(remote), [remote]);
  const anyExpanded = expandedKeys.length > 0;
  const onToggleAll = React.useCallback(() => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    // Every ephemeral ancestor is now an explicit choice too.
    setTouchedKeys(new Set([...(continueAncestors ?? [])]));
    if (anyExpanded) {
      setAllExpanded([]);
      track('library_collapse_all', { expanded: false, sections: topLevelKeys.length });
    } else {
      setAllExpanded(topLevelKeys);
      track('library_collapse_all', { expanded: true, sections: topLevelKeys.length });
    }
  }, [anyExpanded, continueAncestors, reduceMotion, setAllExpanded, topLevelKeys]);

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
  // M26 (T97): one listen_row_shown per pack per Library visit. The signature
  // carries pack identity + state + parts; the viewed set clears on blur.
  const listenSignature = React.useMemo(
    () =>
      sections
        .flatMap((s) => {
          const row = s.data.find((r): r is ListenRowItem => r.kind === 'listen');
          return row ? [`${row.packId}:${row.availability.state}:${row.availability.parts}`] : [];
        })
        .join('|'),
    [sections],
  );
  const listenShownRef = React.useRef(new Set<string>());
  useFocusEffect(
    React.useCallback(() => {
      const shown = listenShownRef.current;
      return () => shown.clear();
    }, []),
  );
  useFocusEffect(
    React.useCallback(() => {
      if (!listenSignature) return;
      const shown = listenShownRef.current;
      for (const entry of listenSignature.split('|')) {
        const [packId = '', state = '', parts = '0'] = entry.split(':');
        if (shown.has(packId)) continue;
        shown.add(packId);
        track('listen_row_shown', { packId, state, parts: Number(parts) });
      }
    }, [listenSignature]),
  );
  // Audio may have finished downloading while away — refresh on focus.
  const refetchListen = listenAvailability.refetch;
  useFocusEffect(
    React.useCallback(() => {
      if (packIds.length > 0) void refetchListen();
    }, [packIds.length, refetchListen]),
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
        {/* T86: expand-all / collapse-all, shown only when ≥2 sections exist. */}
        {sections.length >= 2 && (
          <View className="flex-row justify-end px-4">
            <Pressable
              onPress={onToggleAll}
              accessibilityRole="button"
              accessibilityLabel={anyExpanded ? 'Свернуть всё' : 'Развернуть всё'}
              className="rounded-lg px-2 py-1 active:bg-surface-2"
            >
              <Text variant="caption" className="text-accent">
                {anyExpanded ? 'Свернуть всё' : 'Развернуть всё'}
              </Text>
            </Pressable>
          </View>
        )}
        {/* M18 (T69) / M19 (T75): the pinned hub card — under each «ТРКИ» chip
            (A1 / A2), parameterised by level, above the sections AND inside
            the empty state (the hub works before sync). */}
        {isTorflCategory(category) && (
          <View className="px-4">
            <TorflHubCard key={category} level={levelForCategory(category) ?? 'A1'} />
          </View>
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
      sections.length,
      anyExpanded,
      onToggleAll,
    ],
  );

  // T86: every toggle goes through here — persists, logs, and animates (only
  // with reduce-motion off). `kind` is the section kind for analytics.
  const onToggle = React.useCallback(
    (kind: 'pack' | 'family' | 'book' | 'chapter', key: string, expanded: boolean) => {
      if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTouchedKeys((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
      toggleExpanded(key, expanded);
      track('library_section_toggled', { kind, key, expanded });
    },
    [reduceMotion, toggleExpanded],
  );

  // T86 analytics: once per series per Library visit (focus-effect signature).
  const seriesSignature = React.useMemo(
    () =>
      remote
        .filter((s) => s.book)
        .map((s) => `${s.book!.series}:${s.book!.book}:${s.book!.chapters.length}`)
        .join('|'),
    [remote],
  );
  useFocusEffect(
    React.useCallback(() => {
      if (!seriesSignature) return;
      const byseries = new Map<string, { books: number; chapters: number }>();
      for (const entry of seriesSignature.split('|')) {
        const [series = '', , chapters = '0'] = entry.split(':');
        const acc = byseries.get(series) ?? { books: 0, chapters: 0 };
        acc.books += 1;
        acc.chapters += Number(chapters);
        byseries.set(series, acc);
      }
      for (const [series, acc] of byseries) {
        track('library_series_viewed', { series, books: acc.books, chapters: acc.chapters });
      }
    }, [seriesSignature]),
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
      sections={sections.map((section) => ({
        ...section,
        // Collapsed → no rows at all (ticket rule 8); the header still renders.
        data: sectionDataFor(sectionKeyOf(section), section.data, expandedSetForRender),
      }))}
      keyExtractor={(item) =>
        item.kind === 'story'
          ? `story/${item.story.packId}/${item.story.id}`
          : item.kind === 'exam'
            ? `exam/${item.exam.packId}/${item.exam.examId}`
            : item.kind === 'listen'
              ? `listen/${item.packId}`
              : item.kind === 'chapter'
                ? `chapter/${item.section.pack.id}/${item.chapter}`
                : `dialogue/${item.dialogue.packId}/${item.dialogue.id}`
      }
      stickySectionHeadersEnabled={false}
      contentContainerClassName="px-4 pb-12 pt-2"
      refreshControl={refreshControl}
      ListHeaderComponent={listHeader}
      renderSectionHeader={({ section }) => (
        <SectionHeader
          section={section}
          expanded={expandedSetForRender.has(sectionKeyOf(section))}
          onToggle={(expanded) =>
            onToggle(
              section.book ? 'book' : section.family ? 'family' : 'pack',
              sectionKeyOf(section),
              expanded,
            )
          }
          progressByStory={progressByStory}
          onSelectRung={onSelectRung}
        />
      )}
      renderItem={({ item }) => {
        if (item.kind === 'chapter') {
          return (
            <ChapterRow
              section={item.section}
              expanded={expandedSetForRender.has(sectionKeyOf(item.section))}
              onToggle={(expanded) => onToggle('chapter', sectionKeyOf(item.section), expanded)}
              progressByStory={progressByStory}
              onSelectRung={onSelectRung}
              renderPartRow={renderPartRow}
            />
          );
        }
        return renderPartRow(item);
      }}
    />
  );

  /** A story / dialogue / exam row (inside a chapter it is indented). */
  function renderPartRow(item: LibraryRow) {
    return item.kind === 'listen' ? (
      <ListenRow
        packId={item.packId}
        availability={item.availability}
        progressPercent={listenProgress.get(item.packId)?.percent ?? null}
        finished={listenProgress.get(item.packId)?.finished ?? false}
        nowPlaying={listenNowPlaying === item.packId}
        onPress={() => {
          track('listen_row_tapped', { packId: item.packId });
          router.push(`/listen/${item.packId}` as never);
        }}
      />
    ) : item.kind === 'exam' ? (
      <ExamRow
        item={item.exam}
        onPress={() =>
          router.push({
            pathname: '/exam/[packId]/[examId]',
            params: { packId: item.exam.packId, examId: item.exam.examId },
          })
        }
      />
    ) : item.kind === 'story' ? (
      <StoryRow
        story={item.story}
        progress={progressByStory.get(`${item.story.packId}/${item.story.id}`)}
        bookmarked={bookmarkedKeys.data?.has(`${item.story.packId}/${item.story.id}`) ?? false}
        onPress={() => router.push(`/reader/${item.story.packId}/${item.story.id}`)}
        onLongPress={() => toggleBookmark(item.story.packId, item.story.id)}
      />
    ) : item.kind === 'dialogue' ? (
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
    ) : null;
  }
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
        {isTorflCategory(category)
          ? 'Материалы ТРКИ появятся после синхронизации — подготовка к экзамену уже открыта выше.'
          : 'Материалы для этой полки появятся после синхронизации.'}
      </Text>
    </View>
  );
}

/** T86: the expansion key of a section (family shelf, series book, or pack). */
function sectionKeyOf(section: LibrarySection): string {
  if (section.book) return bookKey(section.book.series, section.book.book);
  if (section.family) return familyKey(section.family.slug);
  return packKey(section.pack.id);
}

/** T86 expand-all targets: top-level keys only (packs, families, books) — never chapters. */
function collectTopLevelKeys(sections: readonly LibrarySection[]): string[] {
  return sections.map(sectionKeyOf);
}

/**
 * T86: a section's header. Collapsed it is one tappable row (title + level or
 * rung chips + progress + chevron); expanded it is today's header chrome,
 * unchanged, under a small toggle row. The shelf divider and the toolbar sit
 * above it.
 */
function SectionHeader({
  section,
  expanded,
  onToggle,
  progressByStory,
  onSelectRung,
}: {
  section: LibrarySection;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  progressByStory: Map<string, StoryProgressRow>;
  onSelectRung: (slug: string, from: CefrLevel, to: CefrLevel, via: 'chip' | 'next-rung') => void;
}) {
  const { tokens } = useAppTheme();
  const summary = summarizeStories(sectionStories(section, progressByStory));
  const levels = sectionLevels(section);
  return (
    <View>
      {section.shelfHeader && (
        <View className="mt-8 flex-row items-center gap-2 border-b border-border pb-2">
          <Ionicons name="download-outline" size={16} color={tokens.textMuted} />
          <Text variant="caption" className="uppercase tracking-wider">
            {section.shelfHeader}
          </Text>
        </View>
      )}
      {!expanded && (
        <Pressable
          onPress={() => onToggle(true)}
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
          accessibilityLabel={`${section.family?.titleRu ?? section.pack.titleRu}. Expand`}
          className="mb-2 mt-4 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2"
        >
          <Ionicons name="chevron-forward" size={16} color={tokens.textMuted} />
          <Text className="flex-1 font-ui-medium text-lg" numberOfLines={1}>
            {section.book
              ? section.book.subtitle
                ? `${section.book.titleRu} · ${section.book.subtitle}`
                : section.book.titleRu
              : (section.family?.titleRu ?? section.pack.titleRu)}
          </Text>
          <View className="flex-row gap-1">
            {levels.map((level) => (
              <LevelChip key={level} level={level} />
            ))}
          </View>
          <Text variant="caption" className="text-xs">
            {summary.finished === summary.total && summary.total > 0
              ? '✓'
              : `${summary.finished}/${summary.total}`}
          </Text>
        </Pressable>
      )}
      {expanded && (
        <Pressable
          onPress={() => onToggle(false)}
          accessibilityRole="button"
          accessibilityState={{ expanded: true }}
          accessibilityLabel={`${section.family?.titleRu ?? section.pack.titleRu}. Collapse`}
          className="mt-4 flex-row items-center gap-2 self-start rounded-lg px-1 py-1 active:bg-surface-2"
        >
          <Ionicons name="chevron-down" size={16} color={tokens.textMuted} />
          <Text variant="caption">Свернуть</Text>
        </Pressable>
      )}
      {expanded && section.book && (
        <BookHeader book={section.book} progressByStory={progressByStory} />
      )}
      {expanded &&
        !section.book &&
        (section.family ? (
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
        ))}
    </View>
  );
}

/** T86: the level chips a section shows (a family's rungs, a book's union of its chapters, or the pack's level). */
function sectionLevels(section: LibrarySection): CefrLevel[] {
  if (section.book) {
    const all = section.book.chapters.flatMap((c) => sectionLevels(c.section));
    return CEFR_ORDER.filter((level) => all.includes(level));
  }
  return section.family ? section.family.rungs.map((r) => r.level) : [section.pack.level];
}

/**
 * T86: the stories a section counts for progress. A plain pack or family is its
 * selected rung's stories; a series book is every chapter's selected-rung
 * stories, so the book row shows the whole book's finished/total.
 */
function sectionStories(
  section: LibrarySection,
  progressByStory: Map<string, StoryProgressRow>,
): { finished: boolean }[] {
  if (section.book) {
    return section.book.chapters.flatMap((c) => sectionStories(c.section, progressByStory));
  }
  return section.data
    .filter((row): row is Extract<LibraryRow, { kind: 'story' }> => row.kind === 'story')
    .map((row) => ({
      finished: progressByStory.get(`${row.story.packId}/${row.story.id}`)?.finishedAt != null,
    }));
}

/**
 * T86 book header (expanded): title, subtitle and the book's count line. The
 * chapter rows follow in the list.
 */
function BookHeader({
  book,
  progressByStory,
}: {
  book: NonNullable<LibrarySection['book']>;
  progressByStory: Map<string, StoryProgressRow>;
}) {
  const summary = summarizeStories(
    book.chapters.flatMap((c) => sectionStories(c.section, progressByStory)),
  );
  return (
    <View className="mb-1 mt-2 gap-1">
      <Text variant="caption">
        {`${book.chapters.length} глав · ${summary.finished}/${summary.total} частей`}
      </Text>
    </View>
  );
}

/**
 * T86: a chapter row inside a book — collapsed it is one indented row with the
 * chapter label and its level chips; expanded it shows the family chrome and
 * the chapter's part rows (indented).
 */
function ChapterRow({
  section,
  expanded,
  onToggle,
  progressByStory,
  onSelectRung,
  renderPartRow,
}: {
  section: LibrarySection;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  progressByStory: Map<string, StoryProgressRow>;
  onSelectRung: (slug: string, from: CefrLevel, to: CefrLevel, via: 'chip' | 'next-rung') => void;
  renderPartRow: (item: LibraryRow) => React.ReactNode;
}) {
  const { tokens } = useAppTheme();
  const title = chapterLabel(section.family?.titleRu ?? section.pack.titleRu);
  const levels = sectionLevels(section);
  const summary = summarizeStories(sectionStories(section, progressByStory));
  return (
    <View className="mb-1 ml-3 border-l border-border pl-3">
      <Pressable
        onPress={() => onToggle(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}. ${expanded ? 'Collapse' : 'Expand'}`}
        className="flex-row items-center gap-2 py-2 active:bg-surface-2"
      >
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={14}
          color={tokens.textMuted}
        />
        <Text className="flex-1 font-reading text-base" numberOfLines={1}>
          {title}
        </Text>
        <View className="flex-row gap-1">
          {levels.map((level) => (
            <LevelChip key={level} level={level} />
          ))}
        </View>
        <Text variant="caption" className="text-xs">
          {summary.finished === summary.total && summary.total > 0
            ? '✓'
            : `${summary.finished}/${summary.total}`}
        </Text>
      </Pressable>
      {expanded && section.family && (
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
      )}
      {expanded &&
        section.data.map((row) => (
          <React.Fragment
            key={
              row.kind === 'story'
                ? `${row.story.packId}/${row.story.id}`
                : row.kind === 'listen'
                  ? `listen/${row.packId}`
                  : row.kind
            }
          >
            {renderPartRow(row)}
          </React.Fragment>
        ))}
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
