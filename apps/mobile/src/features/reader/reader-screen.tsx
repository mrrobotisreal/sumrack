import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useBookmarksForStory, useStoryDetail, useStoryProgress } from '@/db/hooks';
import type { SentenceWithTokens, TokenRow } from '@/db/repositories/content';
import { track } from '@/services/analytics';
import { useReaderPrefs } from '@/store/reader-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { ExplainSheet } from '@/features/ai/explain-sheet';
import type { ExplainTarget } from '@/features/ai/explain';
import {
  classificationEventProps,
  classifyPack,
  type ClassificationEventProps,
  type Classified,
} from '@/features/library/categories';
import { recordReading, recordStoryFinished } from '@/features/motivation/service';

import { AudioBar } from './audio-bar';
import { PhraseCardSheet, type PhraseCardTarget } from './phrase-card-sheet';
import { SentenceRow } from './sentence-row';
import { StoryHeader } from './story-header';
import type { PhraseSelection } from './token-text';
import { TypeSettingsSheet } from './type-settings-sheet';
import { readingTextStyle, translationTextStyle } from './typography';
import { resolveRestoreTarget, type RestoreTarget } from './restore';
import { useNarrationActivity, useStudyAmbience } from '@/features/ambient-audio/activity';
import { useNarration } from './use-narration';
import { WordPopup, type WordPopupTarget } from './word-popup';

const POSITION_SAVE_DEBOUNCE_MS = 800;
/**
 * T22 (T17/T19-reported bug): a story short enough to fit on one screen had
 * its last sentence "viewable" during initial layout, so opening it marked
 * it finished. A finish now requires the story to have been on screen for
 * at least this long, with the end still visible when the dwell elapses.
 */
const MIN_FINISH_DWELL_MS = 5000;
/** Sessions shorter than this don't count as reading time (accidental opens). */
const MIN_READING_SESSION_MS = 3000;
/** After the user scrolls by hand, karaoke auto-follow pauses this long. */
const FOLLOW_SUSPEND_MS = 5000;
/**
 * T30.2: the restore scroll is confirmed by viewability (target on screen)
 * before position saves arm. If it never confirms, arm anyway after this —
 * the never-regress save rule makes a missed restore harmless, not lossy.
 */
const RESTORE_SETTLE_TIMEOUT_MS = 3500;
const RESTORE_MAX_SCROLL_ATTEMPTS = 30;
/**
 * A far target isn't rendered yet, and scrollToIndex to an unrendered row
 * stalls (its offset-estimate fallback stops moving the viewport). Stepping
 * a few rows past the rendered edge always succeeds and always fires a new
 * viewability event, so the ladder provably reaches any index.
 */
const RESTORE_STEP_ROWS = 8;
/**
 * CT003b: an explicit narration seek auto-scrolls the list; viewability is
 * ignored this long after one so the jump itself never writes the reading
 * position (sustained listening at the sought point still counts).
 */
const SEEK_SAVE_SUPPRESS_MS = 2500;
/** Reserved space above the safe area for the narration bar (list padding). */
const AUDIO_BAR_HEIGHT = 104;
/** M14: what `classifyPack` gives a legacy remote pack — used until the detail row lands. */
const PENDING_CLASSIFICATION: Classified = { category: 'stories', genre: 'horror' };

interface ReaderScreenProps {
  packId: string;
  storyId: string;
  /** Entry point ('library' | 'path' | 'today' | 'search' | 'bookmarks'). */
  from?: string;
  /**
   * T24 deep link: open scrolled to this sentence orderIdx (search results,
   * sentence bookmarks). Takes precedence over the saved reading position
   * for the initial scroll only — position saving behaves as always after.
   */
  initialSentenceIdx?: number;
}

/**
 * The story reader (design §7.1 minus popup/audio — those are T05/T10).
 * Sentence-by-sentence FlatList under an atmospheric header; per-sentence
 * translation reveal; position auto-saved (debounced) and restored across
 * full app restarts; reaching the last sentence records completion.
 */
export function ReaderScreen({ packId, storyId, from, initialSentenceIdx }: ReaderScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();
  const queryClient = useQueryClient();
  const prefs = useReaderPrefs();

  const detail = useStoryDetail(packId, storyId);
  const progress = useStoryProgress(packId, storyId);
  const bookmarks = useBookmarksForStory(packId, storyId);

  const [revealed, setRevealed] = React.useState<ReadonlySet<string>>(new Set());
  const [typeSheetOpen, setTypeSheetOpen] = React.useState(false);
  const [popupTarget, setPopupTarget] = React.useState<WordPopupTarget | null>(null);
  const [explainTarget, setExplainTarget] = React.useState<ExplainTarget | null>(null);
  const [phraseTarget, setPhraseTarget] = React.useState<PhraseCardTarget | null>(null);
  // Drag selection in progress → the list must not scroll under the finger.
  const [selecting, setSelecting] = React.useState(false);

  const listRef = React.useRef<FlatList<SentenceWithTokens>>(null);
  // T30.2 restore flow: saves (and karaoke follow) stay disarmed until the
  // restore scroll settles; the list stays invisible until then (no flash).
  const savesArmedRef = React.useRef(false);
  const restoreStartedRef = React.useRef(false);
  const restoreTargetRef = React.useRef<RestoreTarget | null>(null);
  const restoreAttemptsRef = React.useRef(0);
  const restoreTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [listReady, setListReady] = React.useState(false);
  const finishRequestedRef = React.useRef(false);
  const mountedAtRef = React.useRef(Date.now());
  const endVisibleRef = React.useRef(false);
  const dwellTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIdxRef = React.useRef<number | null>(null);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const sentences = React.useMemo(() => detail.data?.sentences ?? [], [detail.data]);
  const sentenceIds = React.useMemo(() => sentences.map((s) => s.id), [sentences]);
  const allRevealed = sentences.length > 0 && revealed.size === sentences.length;

  const readingStyle = React.useMemo(() => readingTextStyle(prefs), [prefs]);
  const translationStyle = React.useMemo(() => translationTextStyle(prefs), [prefs]);

  // M14 (T46): classify ONCE per mount — the header badge, every reader
  // event and (via options) every narration event read this same object.
  // Before the detail row lands it holds the legacy-remote defaults; the
  // props object is keyed on the two slugs so a detail refetch never yields
  // a new object (callbacks and effects below depend on it).
  const cls = React.useMemo(
    () => (detail.data ? classifyPack(detail.data.pack) : PENDING_CLASSIFICATION),
    [detail.data],
  );
  const { category: clsCategory, genre: clsGenre } = cls;
  const clsProps = React.useMemo<ClassificationEventProps>(
    () => classificationEventProps({ category: clsCategory, genre: clsGenre }),
    [clsCategory, clsGenre],
  );
  const clsPropsRef = React.useRef(clsProps);
  React.useEffect(() => {
    clsPropsRef.current = clsProps;
  }, [clsProps]);

  // ---- narration + karaoke (T10) ----------------------------------------
  const narration = useNarration({
    packId,
    storyId,
    storyTitleRu: detail.data?.story.titleRu ?? '',
    packTitleRu: detail.data?.pack.titleRu ?? '',
    sentences,
    tracks: detail.data?.audio ?? [],
    eventProps: clsProps,
  });
  // The shared host applies the user's narration preference independently of
  // reader readiness, overlays, screen focus and foreground state.
  useNarrationActivity(narration.playing);
  useStudyAmbience(
    !!detail.data &&
      !progress.isPending &&
      listReady &&
      !popupTarget &&
      !phraseTarget &&
      !explainTarget &&
      !typeSheetOpen,
  );
  const trackLoaded = narration.currentTrack != null;

  // Auto-follow with gentle catch-up (UI_DESIGN §4/§5): ease the active
  // sentence toward the upper third on every change; a manual scroll
  // suspends following briefly so the user can look around mid-playback.
  const followSuspendedUntilRef = React.useRef(0);
  const { activeSentenceIdx, playing } = narration;
  React.useEffect(() => {
    if (activeSentenceIdx == null || !playing) return;
    if (Date.now() < followSuspendedUntilRef.current) return;
    if (!savesArmedRef.current) return;
    listRef.current?.scrollToIndex({
      index: activeSentenceIdx,
      animated: true,
      viewPosition: 0.33,
    });
  }, [activeSentenceIdx, playing]);

  const { seekToSentence } = narration;
  const handleSeekToSentence = React.useCallback(
    (sentenceId: string) => {
      // A deliberate jump is also a "keep following from here" signal.
      followSuspendedUntilRef.current = 0;
      seekToSentence(sentenceId);
    },
    [seekToSentence],
  );

  // story_opened waits for the detail row so its category/genre are the
  // pack's, not the placeholder (still exactly once per open — the row is
  // cached across re-renders and the guard ref survives them).
  const openedTrackedRef = React.useRef(false);
  React.useEffect(() => {
    if (!detail.data || openedTrackedRef.current) return;
    openedTrackedRef.current = true;
    track('story_opened', { packId, storyId, from: from ?? 'library', ...clsProps });
  }, [detail.data, packId, storyId, from, clsProps]);

  // Reading time → daily_activity.readingMs (feeds the Today goal ring, §7.7).
  // The classification is read through the ref so a pending→loaded change
  // never restarts (splits) the session.
  useFocusEffect(
    React.useCallback(() => {
      const startedAt = Date.now();
      return () => {
        const ms = Date.now() - startedAt;
        if (ms >= MIN_READING_SESSION_MS) {
          // recordReading bumps readingMs + XP and evaluates goal/streak (T19).
          void recordReading(ms);
          track('reading_session_ended', { packId, storyId, ms, ...clsPropsRef.current });
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

  const finishStory = React.useCallback(
    function finish(this: void) {
      if (finishRequestedRef.current) return;
      // Dwell gate — see MIN_FINISH_DWELL_MS. If we're still inside the
      // window, arm a one-shot timer that re-checks whether the end is still
      // visible once the dwell has genuinely elapsed.
      const elapsed = Date.now() - mountedAtRef.current;
      if (elapsed < MIN_FINISH_DWELL_MS) {
        if (!dwellTimerRef.current) {
          dwellTimerRef.current = setTimeout(() => {
            dwellTimerRef.current = null;
            if (endVisibleRef.current) finish();
          }, MIN_FINISH_DWELL_MS - elapsed);
        }
        return;
      }
      finishRequestedRef.current = true;
      void repos.reading.markFinished(packId, storyId).then((newlyFinished) => {
        if (newlyFinished) {
          track('story_finished', { packId, storyId, ...clsProps });
          // Bumps storiesFinished + XP, unlocks first-story, evaluates (T19).
          void recordStoryFinished();
        }
        invalidateProgress();
      });
    },
    [packId, storyId, invalidateProgress, clsProps],
  );

  // Arm saves + karaoke follow, reveal the list, and log the restore if one
  // actually happened. Idempotent — first caller wins (confirm vs timeout).
  const settleRestore = React.useCallback(
    (restored: RestoreTarget | null) => {
      if (savesArmedRef.current) return;
      savesArmedRef.current = true;
      restoreTargetRef.current = null;
      if (restoreTimeoutRef.current) {
        clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
      }
      setListReady(true);
      if (restored?.source === 'saved' && restored.targetIdx != null) {
        track('reading_position_restored', {
          packId,
          storyId,
          sentenceIdx: restored.targetIdx,
          from: from ?? 'library',
          ...clsProps,
        });
      }
    },
    [packId, storyId, from, clsProps],
  );

  const attemptRestoreScroll = React.useCallback(() => {
    const target = restoreTargetRef.current;
    if (target?.targetIdx == null || savesArmedRef.current) return;
    restoreAttemptsRef.current += 1;
    listRef.current?.scrollToIndex({ index: target.targetIdx, animated: false, viewPosition: 0.1 });
  }, []);

  // T30.2 restore-on-open. The target comes from a FRESH progress read —
  // after an earlier visit the react-query row can be stale (the CT002b
  // open-at-top failure), so the cache is never trusted for the restore.
  // Library card, Today continue card, and deep links all resolve through
  // resolveRestoreTarget; the scroll is confirmed via viewability (or the
  // timeout) before anything is allowed to save.
  React.useEffect(() => {
    if (restoreStartedRef.current || detail.isPending) return;
    restoreStartedRef.current = true;
    if (sentences.length === 0) {
      settleRestore(null);
      return;
    }
    void repos.reading.getProgress(packId, storyId).then((row) => {
      const target = resolveRestoreTarget({
        initialSentenceIdx,
        savedIdx: row?.currentSentenceIdx ?? null,
        finished: row?.finishedAt != null,
        sentenceCount: sentences.length,
      });
      if (target.targetIdx == null) {
        settleRestore(target);
      } else {
        restoreTargetRef.current = target;
        // Defer one frame so the list has laid out its first batch.
        requestAnimationFrame(attemptRestoreScroll);
        restoreTimeoutRef.current = setTimeout(
          () => settleRestore(null),
          RESTORE_SETTLE_TIMEOUT_MS,
        );
      }
      // First-ever open: create the progress row now so the Library shows
      // in-progress even before the first scroll.
      if (row == null) schedulePositionSave(0);
    });
  }, [
    detail.isPending,
    sentences.length,
    packId,
    storyId,
    initialSentenceIdx,
    settleRestore,
    attemptRestoreScroll,
    schedulePositionSave,
  ]);

  // Clear the pending dwell + restore timers on unmount.
  React.useEffect(
    () => () => {
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);
    },
    [],
  );

  // Viewability drives both position saves and finished detection. FlatList
  // requires a stable callback, so the pairs are created once and dispatch
  // through a latest-value ref kept current from an effect.
  const viewabilityHandlerRef = React.useRef<(items: ViewToken<SentenceWithTokens>[]) => void>(
    () => {},
  );
  const { lastUserSeekAtRef } = narration;
  React.useEffect(() => {
    viewabilityHandlerRef.current = (viewableItems) => {
      if (viewableItems.length === 0) return;
      const indices = viewableItems.map((v) => v.index).filter((i): i is number => i != null);
      if (indices.length === 0) return;
      const minIdx = Math.min(...indices);
      const maxIdx = Math.max(...indices);
      // Pre-settle: confirm (or keep nudging) the restore scroll; no saves.
      if (!savesArmedRef.current) {
        const target = restoreTargetRef.current;
        if (target?.targetIdx == null) return;
        if (minIdx <= target.targetIdx && target.targetIdx <= maxIdx) {
          settleRestore(target);
        } else if (restoreAttemptsRef.current < RESTORE_MAX_SCROLL_ATTEMPTS) {
          restoreAttemptsRef.current += 1;
          // Step toward the target via the rendered edge (see RESTORE_STEP_ROWS).
          const stepIdx =
            target.targetIdx > maxIdx
              ? Math.min(maxIdx + RESTORE_STEP_ROWS, target.targetIdx)
              : Math.max(minIdx - RESTORE_STEP_ROWS, target.targetIdx);
          listRef.current?.scrollToIndex({ index: stepIdx, animated: false, viewPosition: 0.1 });
        } else {
          // Never confirmed — arm anyway; never-regress keeps this harmless.
          settleRestore(null);
        }
        return;
      }
      // The auto-follow jump right after an explicit seek is not reading.
      if (Date.now() - lastUserSeekAtRef.current < SEEK_SAVE_SUPPRESS_MS) return;
      schedulePositionSave(minIdx);
      endVisibleRef.current = maxIdx === sentences.length - 1;
      if (endVisibleRef.current) finishStory();
    };
  }, [schedulePositionSave, finishStory, sentences.length, settleRestore, lastUserSeekAtRef]);
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

  // ---- bookmarks (T24) ---------------------------------------------------
  const storyBookmarked = React.useMemo(
    () => (bookmarks.data ?? []).some((b) => b.kind === 'story'),
    [bookmarks.data],
  );
  const bookmarkedSentenceIds = React.useMemo(
    () =>
      new Set(
        (bookmarks.data ?? [])
          .filter((b) => b.kind === 'sentence' && b.sentenceId)
          .map((b) => b.sentenceId!),
      ),
    [bookmarks.data],
  );
  const invalidateBookmarks = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
  }, [queryClient]);
  const toggleStoryBookmark = React.useCallback(() => {
    void repos.bookmarks.toggleStory(packId, storyId).then(({ added }) => {
      track(added ? 'bookmark_added' : 'bookmark_removed', {
        kind: 'story',
        from: 'reader',
        ...clsProps,
      });
      invalidateBookmarks();
    });
  }, [packId, storyId, invalidateBookmarks, clsProps]);
  const toggleSentenceBookmark = React.useCallback(
    (sentenceId: string) => {
      void repos.bookmarks.toggleSentence(packId, storyId, sentenceId).then(({ added }) => {
        track(added ? 'bookmark_added' : 'bookmark_removed', {
          kind: 'sentence',
          from: 'reader',
          ...clsProps,
        });
        invalidateBookmarks();
      });
    },
    [packId, storyId, invalidateBookmarks, clsProps],
  );

  const handleWordPress = React.useCallback(
    (token: TokenRow, sentenceId: string) => {
      track('word_tapped', { lemma: token.lemma ?? token.text, sentenceId, ...clsProps });
      setPopupTarget({ token, sentenceId, storyId, eventProps: clsProps });
    },
    [storyId, clsProps],
  );

  const sentenceById = React.useMemo(() => new Map(sentences.map((s) => [s.id, s])), [sentences]);

  const handlePhraseSelected = React.useCallback(
    (selection: PhraseSelection, sentenceId: string) => {
      const sentence = sentenceById.get(sentenceId);
      if (!sentence) return;
      track('phrase_selection_completed', {
        sentenceId,
        chunks: selection.range.end - selection.range.start + 1,
        ...clsProps,
      });
      setPhraseTarget({
        selection,
        sentenceRu: sentence.ru,
        sentenceId,
        storyId,
        eventProps: clsProps,
      });
    },
    [sentenceById, storyId, clsProps],
  );

  const toggleSentence = React.useCallback(
    (sentenceId: string) => {
      setRevealed((prev) => {
        const next = new Set(prev);
        const nowRevealed = !next.has(sentenceId);
        if (nowRevealed) next.add(sentenceId);
        else next.delete(sentenceId);
        track('sentence_reveal_toggled', { sentenceId, revealed: nowRevealed, ...clsProps });
        return next;
      });
    },
    [clsProps],
  );

  const toggleRevealAll = React.useCallback(() => {
    track('reveal_all_toggled', { packId, storyId, revealed: !allRevealed, ...clsProps });
    setRevealed(allRevealed ? new Set() : new Set(sentenceIds));
  }, [allRevealed, sentenceIds, packId, storyId, clsProps]);

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
  const source = story.sourceName
    ? {
        name: story.sourceName,
        url: story.sourceUrl,
        publishedAt: story.sourcePublishedAt,
        author: story.sourceAuthor,
      }
    : null;

  return (
    <View className="flex-1 bg-bg">
      <FlatList
        ref={listRef}
        data={sentences}
        keyExtractor={(s) => s.id}
        // Invisible (but laying out) until the restore scroll settles, so a
        // restored open never flashes the top of the story first (T30.2).
        style={{ opacity: listReady ? 1 : 0 }}
        scrollEnabled={!selecting}
        renderItem={({ item }) => (
          <SentenceRow
            sentenceId={item.id}
            ruTokens={item.tokens}
            en={item.en}
            revealed={revealed.has(item.id)}
            onToggleReveal={() => toggleSentence(item.id)}
            readingStyle={readingStyle}
            translationStyle={translationStyle}
            onWordPress={handleWordPress}
            onPhraseSelected={handlePhraseSelected}
            onSelectingChange={setSelecting}
            karaokeTokenIndex={
              narration.mode === 'word' && narration.activeWord?.sentenceId === item.id
                ? narration.activeWord.tokenIndex
                : null
            }
            karaokeSentenceActive={
              narration.mode === 'sentence' &&
              narration.playing &&
              narration.activeSentenceId === item.id
            }
            bookmarked={bookmarkedSentenceIds.has(item.id)}
            onToggleBookmark={toggleSentenceBookmark}
            onSeekToSentence={trackLoaded ? handleSeekToSentence : null}
            onExplain={() =>
              setExplainTarget({
                kind: 'sentence',
                ru: item.ru,
                en: item.en,
                sourceTitle: detail.data?.story.titleRu,
              })
            }
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
            category={cls.category}
            genre={cls.genre}
            subtitleRu={story.subtitleRu}
            source={source}
            onSourceLinkOpened={() =>
              track('story_source_link_opened', { packId, storyId, category: cls.category })
            }
          />
        }
        ListFooterComponent={<StoryEnd finished={finished} />}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 48 + (narration.available ? AUDIO_BAR_HEIGHT : 0),
        }}
        onScrollBeginDrag={() => {
          followSuspendedUntilRef.current = Date.now() + FOLLOW_SUSPEND_MS;
        }}
        viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs}
        onScrollToIndexFailed={(info) => {
          // Variable row heights: jump near the target, then settle exactly.
          // (Restore settling is confirmed via viewability, not from here.)
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
            icon={storyBookmarked ? 'bookmark' : 'bookmark-outline'}
            label={storyBookmarked ? 'Remove story bookmark' : 'Bookmark this story'}
            onPress={toggleStoryBookmark}
            tint={storyBookmarked ? tokens.accent : tokens.text}
          />
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

      {narration.available && <AudioBar narration={narration} />}

      <TypeSettingsSheet open={typeSheetOpen} onClose={() => setTypeSheetOpen(false)} />
      <WordPopup
        target={popupTarget}
        onClose={() => setPopupTarget(null)}
        segments={narration.segments}
      />
      <PhraseCardSheet target={phraseTarget} onClose={() => setPhraseTarget(null)} />
      <ExplainSheet target={explainTarget} onClose={() => setExplainTarget(null)} />
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
