import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useStoryDetail, useStoryProgress } from '@/db/hooks';
import type { SentenceWithTokens } from '@/db/repositories/content';
import { track } from '@/services/analytics';
import { useReaderPrefs } from '@/store/reader-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { SentenceRow } from './sentence-row';
import { StoryHeader } from './story-header';
import { TypeSettingsSheet } from './type-settings-sheet';
import { readingTextStyle, translationTextStyle } from './typography';

const POSITION_SAVE_DEBOUNCE_MS = 800;
/** Sessions shorter than this don't count as reading time (accidental opens). */
const MIN_READING_SESSION_MS = 3000;

interface ReaderScreenProps {
  packId: string;
  storyId: string;
}

/**
 * The story reader (design §7.1 minus popup/audio — those are T05/T10).
 * Sentence-by-sentence FlatList under an atmospheric header; per-sentence
 * translation reveal; position auto-saved (debounced) and restored across
 * full app restarts; reaching the last sentence records completion.
 */
export function ReaderScreen({ packId, storyId }: ReaderScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();
  const queryClient = useQueryClient();
  const prefs = useReaderPrefs();

  const detail = useStoryDetail(packId, storyId);
  const progress = useStoryProgress(packId, storyId);

  const [revealed, setRevealed] = React.useState<ReadonlySet<string>>(new Set());
  const [typeSheetOpen, setTypeSheetOpen] = React.useState(false);

  const listRef = React.useRef<FlatList<SentenceWithTokens>>(null);
  const restoredRef = React.useRef(false);
  const finishRequestedRef = React.useRef(false);
  const pendingIdxRef = React.useRef<number | null>(null);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const sentences = React.useMemo(() => detail.data?.sentences ?? [], [detail.data]);
  const sentenceIds = React.useMemo(() => sentences.map((s) => s.id), [sentences]);
  const allRevealed = sentences.length > 0 && revealed.size === sentences.length;

  const readingStyle = React.useMemo(() => readingTextStyle(prefs), [prefs]);
  const translationStyle = React.useMemo(() => translationTextStyle(prefs), [prefs]);

  React.useEffect(() => {
    track('story_opened', { packId, storyId });
  }, [packId, storyId]);

  // Reading time → daily_activity.readingMs (feeds the Today goal ring, §7.7).
  useFocusEffect(
    React.useCallback(() => {
      const startedAt = Date.now();
      return () => {
        const ms = Date.now() - startedAt;
        if (ms >= MIN_READING_SESSION_MS) {
          void repos.stats.bumpDailyActivity({ readingMs: ms });
          track('reading_session_ended', { packId, storyId, ms });
        }
      };
    }, [packId, storyId]),
  );

  const invalidateProgress = React.useCallback(() => {
    // Both the per-story query and the Library's list share this key prefix.
    void queryClient.invalidateQueries({ queryKey: ['story-progress'] });
  }, [queryClient]);

  const flushPosition = React.useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const idx = pendingIdxRef.current;
    if (idx == null) return;
    pendingIdxRef.current = null;
    void repos.reading.savePosition(packId, storyId, idx).then(invalidateProgress);
  }, [packId, storyId, invalidateProgress]);

  const schedulePositionSave = React.useCallback(
    (idx: number) => {
      pendingIdxRef.current = idx;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushPosition, POSITION_SAVE_DEBOUNCE_MS);
    },
    [flushPosition],
  );

  // Flush the last position when leaving the screen.
  React.useEffect(() => flushPosition, [flushPosition]);

  const finishStory = React.useCallback(() => {
    if (finishRequestedRef.current) return;
    finishRequestedRef.current = true;
    void repos.reading.markFinished(packId, storyId).then((newlyFinished) => {
      if (newlyFinished) {
        track('story_finished', { packId, storyId });
        void repos.stats.bumpDailyActivity({ storiesFinished: 1 });
      }
      invalidateProgress();
    });
  }, [packId, storyId, invalidateProgress]);

  // Restore the saved position once both the story and the progress row are in.
  React.useEffect(() => {
    if (restoredRef.current || detail.isPending || progress.isPending) return;
    const idx = progress.data?.currentSentenceIdx ?? 0;
    if (idx > 0 && idx < sentences.length) {
      // Defer one frame so the list has laid out its first batch.
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.1 });
        restoredRef.current = true;
        track('reading_position_restored', { packId, storyId, sentenceIdx: idx });
      });
    } else {
      restoredRef.current = true;
      // First open: create the progress row now so the Library shows
      // in-progress even before the first scroll.
      if (sentences.length > 0) schedulePositionSave(idx);
    }
  }, [
    detail.isPending,
    progress.isPending,
    progress.data,
    sentences.length,
    packId,
    storyId,
    schedulePositionSave,
  ]);

  // Viewability drives both position saves and finished detection. FlatList
  // requires a stable callback, so the pairs are created once and dispatch
  // through a latest-value ref kept current from an effect.
  const viewabilityHandlerRef = React.useRef<(items: ViewToken<SentenceWithTokens>[]) => void>(
    () => {},
  );
  React.useEffect(() => {
    viewabilityHandlerRef.current = (viewableItems) => {
      if (!restoredRef.current || viewableItems.length === 0) return;
      const indices = viewableItems.map((v) => v.index).filter((i): i is number => i != null);
      if (indices.length === 0) return;
      schedulePositionSave(Math.min(...indices));
      if (Math.max(...indices) === sentences.length - 1) finishStory();
    };
  }, [schedulePositionSave, finishStory, sentences.length]);
  const [viewabilityConfigCallbackPairs] = React.useState(() => [
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 25 },
      onViewableItemsChanged: ({
        viewableItems,
      }: {
        viewableItems: ViewToken<SentenceWithTokens>[];
      }) => viewabilityHandlerRef.current(viewableItems),
    },
  ]);

  const toggleSentence = React.useCallback((sentenceId: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      const nowRevealed = !next.has(sentenceId);
      if (nowRevealed) next.add(sentenceId);
      else next.delete(sentenceId);
      track('sentence_reveal_toggled', { sentenceId, revealed: nowRevealed });
      return next;
    });
  }, []);

  const toggleRevealAll = React.useCallback(() => {
    track('reveal_all_toggled', { packId, storyId, revealed: !allRevealed });
    setRevealed(allRevealed ? new Set() : new Set(sentenceIds));
  }, [allRevealed, sentenceIds, packId, storyId]);

  if (detail.isPending || progress.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (!detail.data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Text className="font-reading-bold text-xl">История не найдена</Text>
        <Text variant="muted" className="text-center">
          This story is no longer installed. It may have been removed with its pack.
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-2 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
        >
          <Text className="text-accent">Back to library</Text>
        </Pressable>
      </View>
    );
  }

  const { story } = detail.data;
  const finished = progress.data?.finishedAt != null;

  return (
    <View className="flex-1 bg-bg">
      <FlatList
        ref={listRef}
        data={sentences}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <SentenceRow
            ru={item.ru}
            en={item.en}
            revealed={revealed.has(item.id)}
            onToggleReveal={() => toggleSentence(item.id)}
            readingStyle={readingStyle}
            translationStyle={translationStyle}
          />
        )}
        ListHeaderComponent={
          <StoryHeader
            titleRu={story.titleRu}
            titleEn={story.titleEn}
            level={story.level}
            packTitleRu={detail.data.pack.titleRu}
            sentenceCount={sentences.length}
            finished={finished}
          />
        }
        ListFooterComponent={<StoryEnd finished={finished} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
        viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs}
        onScrollToIndexFailed={(info) => {
          // Variable row heights: jump near the target, then settle exactly.
          listRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          });
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: false,
              viewPosition: 0.1,
            });
            restoredRef.current = true;
          }, 120);
        }}
        showsVerticalScrollIndicator={false}
      />

      {/* floating chrome — stays out of the reading column (immersive, §4) */}
      <View
        className="absolute left-0 right-0 flex-row items-center justify-between px-3"
        style={{ top: insets.top + 4 }}
      >
        <ChromeButton
          icon="chevron-back"
          label="Back"
          onPress={() => router.back()}
          tint={tokens.text}
        />
        <View className="flex-row gap-2">
          <ChromeButton
            icon={allRevealed ? 'eye' : 'eye-outline'}
            label={allRevealed ? 'Hide all translations' : 'Reveal all translations'}
            onPress={toggleRevealAll}
            tint={allRevealed ? tokens.accent : tokens.text}
          />
          <ChromeButton
            icon="text"
            label="Typography settings"
            onPress={() => setTypeSheetOpen(true)}
            tint={tokens.text}
          />
        </View>
      </View>

      <TypeSettingsSheet open={typeSheetOpen} onClose={() => setTypeSheetOpen(false)} />
    </View>
  );
}

function ChromeButton({
  icon,
  label,
  onPress,
  tint,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  tint: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full bg-bg/60 active:bg-surface-2"
    >
      <Ionicons name={icon} size={20} color={tint} />
    </Pressable>
  );
}

/** Quiet end-of-story marker — its last sentence being seen is what finishes the story. */
function StoryEnd({ finished }: { finished: boolean }) {
  return (
    <View className="mt-10 items-center gap-2 px-8">
      <View className="h-px w-16 bg-border" />
      <Text variant="muted" className="font-reading-italic tracking-widest">
        конец
      </Text>
      {finished && (
        <Text variant="caption" className="text-success">
          ✓ Прочитано
        </Text>
      )}
    </View>
  );
}
