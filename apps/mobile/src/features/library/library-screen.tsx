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
  usePacks,
  useStories,
  useStoryProgressList,
} from '@/db/hooks';
import type { PackRow, StoryListItem } from '@/db/repositories/content';
import type { DialogueListItem } from '@/db/repositories/dialogues';
import { readStateOf, type StoryProgressRow } from '@/db/repositories/reading';
import { DialogueRow } from '@/features/dialogue/dialogues-list-screen';
import { useImportedPackMeta } from '@/features/import/hooks';
import {
  defaultRungLevel,
  groupByFamily,
  sharedShelfTags,
  type RungState,
} from '@/features/library/family-groups';
import { FamilyShelfHeader } from '@/features/library/family-shelf';
import { SyncStatusLine } from '@/features/sync/sync-status-line';
import { runSync } from '@/features/sync/sync-service';
import { track } from '@/services/analytics';
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

  // T24: long-press a story row to toggle its story bookmark (recorded
  // placement decision — the row press stays "open the reader").
  const toggleBookmark = React.useCallback(
    (packId: string, storyId: string) => {
      void repos.bookmarks.toggleStory(packId, storyId).then(({ added }) => {
        track(added ? 'bookmark_added' : 'bookmark_removed', { kind: 'story', from: 'library' });
        void queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
      });
    },
    [queryClient],
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

  const sections = React.useMemo<LibrarySection[]>(() => {
    if (!packs.data || !stories.data) return [];
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
    // T30.1: remote sections sharing a `family:<slug>` tag collapse into one
    // shelf at the lowest installed rung's list position (the CT002b fix —
    // a newly synced higher rung joins the shelf instead of appending at the
    // bottom). Single-member families and untagged packs pass through as-is.
    const remote = groupByFamily(
      packs.data
        .filter((p) => p.origin !== 'local')
        .map(build)
        .filter((section) => section.data.length > 0),
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
    // T28: local (imported) packs shelve together under «Импортировано»,
    // after the remote content (design V2 §4.3).
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
    return [...remote, ...local];
  }, [packs.data, stories.data, dialogues.data, importedMeta.data, progressByStory, rungChoice]);

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
      keyExtractor={(item) =>
        item.kind === 'story'
          ? `story/${item.story.packId}/${item.story.id}`
          : `dialogue/${item.dialogue.packId}/${item.dialogue.id}`
      }
      stickySectionHeadersEnabled={false}
      contentContainerClassName="px-4 pb-12 pt-2"
      refreshControl={refreshControl}
      ListHeaderComponent={<SyncStatusLine />}
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
        <Text variant="caption" numberOfLines={1}>
          {story.titleEn} · {story.sentenceCount} sentences
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
