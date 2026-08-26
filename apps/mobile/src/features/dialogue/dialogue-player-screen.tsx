import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { useDialogueGraph, useDialogueStamps } from '@/db/hooks';
import type { TokenRow } from '@/db/repositories/content';
import type { DialogueGraphChoice, DialogueGraphNode } from '@/db/repositories/dialogues';
import { preloadAsr } from '@/features/pronunciation/asr-service';
import { WordPopup, type WordPopupTarget } from '@/features/reader/word-popup';
import { track } from '@/services/analytics';
import { speak } from '@/services/speech';
import { useAppTheme } from '@/theme/use-app-theme';

import { ChoicePanel } from './choice-panel';
import { EndingView } from './ending-view';
import { gradeSpokenChoice } from './grade-spoken-choice';
import { ChoiceBubble, NodeBubble, type OnDialogueWordPress } from './transcript';
import { useDialogueRun } from './use-dialogue-run';
import { useNodePlayback } from './use-node-playback';

/**
 * The dialogue player (T27, V2 §3.3): chat transcript building downward —
 * NPC lines autoplay their node audio with per-line karaoke, player turns
 * are the ChoicePanel's mic-vs-tap flow, ending nodes finish the run into
 * the EndingView. Pure composition: the engine derives all state from
 * `pathJson`, so force-close resume is just reopening the screen.
 */

/** Beat between a finished line and the auto-advance / ending reveal. */
const ADVANCE_BEAT_MS = 400;
const ENDING_BEAT_MS = 700;

export function DialoguePlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens: theme } = useAppTheme();
  const { packId, dialogueId } = useLocalSearchParams<{ packId: string; dialogueId: string }>();

  const graphQuery = useDialogueGraph(packId, dialogueId);
  const graph = graphQuery.data ?? null;
  const run = useDialogueRun(packId, dialogueId, graph);
  const engine = run.engine;

  const current = engine?.status === 'active' && !run.finishInfo ? engine.current : null;
  // One playback per walk step (revisited loop nodes still replay).
  const stepKey = `${engine?.entries.length ?? 0}:${current?.id ?? 'none'}`;

  const stamps = useDialogueStamps(packId, current?.audio ? current.sentenceId : undefined);

  const advanceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    },
    [],
  );

  const currentRef = React.useRef<DialogueGraphNode | null>(null);
  React.useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // Warm the recognizer while the first line plays (T12 pattern).
  React.useEffect(() => {
    preloadAsr();
  }, []);

  const handleLineDone = React.useCallback(() => {
    const node = currentRef.current;
    if (!node) return;
    if (node.kind === 'next' && node.nextNodeId) {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => {
        void run.advanceToNode(node.nextNodeId!);
      }, ADVANCE_BEAT_MS);
    } else if (node.kind === 'ending') {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => {
        void run.finalize();
      }, ENDING_BEAT_MS);
    }
    // 'choices': the panel reveal is derived from playback status below.
  }, [run]);

  const playback = useNodePlayback(current, stamps.data, handleLineDone, stepKey);

  // Choices reveal when the line settles and STAY revealed through replays
  // (the panel holds attempt state — unmounting it would reset the retry
  // counter). Render-time latch: the endorsed adjust-state-on-prop-change
  // pattern, not an effect.
  const [choicesRevealedKey, setChoicesRevealedKey] = React.useState('');
  const lineSettled = playback.status === 'done' || playback.status === 'unavailable';
  if (current?.kind === 'choices' && lineSettled && choicesRevealedKey !== stepKey) {
    setChoicesRevealedKey(stepKey);
  }
  const showChoices = current?.kind === 'choices' && choicesRevealedKey === stepKey;

  // Manual «Далее» when the line has no playable audio (TTS pacing unknown).
  const showManualAdvance =
    current != null && current.kind !== 'choices' && playback.status === 'unavailable';

  const [popupTarget, setPopupTarget] = React.useState<WordPopupTarget | null>(null);
  const onWordPress = React.useCallback<OnDialogueWordPress>(
    (token: TokenRow, sentenceId: string) => {
      if (!dialogueId) return;
      setPopupTarget({ token, sentenceId, storyId: dialogueId });
    },
    [dialogueId],
  );

  const [resolving, setResolving] = React.useState(false);
  const handleResolve = React.useCallback(
    (choice: DialogueGraphChoice, opts: { score?: number; via: 'voice' | 'tap' }) => {
      if (resolving) return;
      setResolving(true);
      void (async () => {
        try {
          track('dialogue_choice_resolved', {
            via: opts.via,
            ...(opts.score !== undefined ? { score: Math.round(opts.score) } : {}),
          });
          if (opts.via === 'voice' && opts.score !== undefined) {
            // FSRS production ratings for existing bank items only (T27).
            await gradeSpokenChoice(choice, opts.score).catch((err) =>
              console.warn('[dialogue] grading failed', err),
            );
          }
          await run.applyChoice(choice, opts.score);
        } finally {
          setResolving(false);
        }
      })();
    },
    [resolving, run],
  );

  // Replay a PAST line: ephemeral player (never the main one).
  const ephemeralRef = React.useRef<AudioPlayer | null>(null);
  React.useEffect(() => () => ephemeralRef.current?.release(), []);
  const replayPast = React.useCallback((node: DialogueGraphNode) => {
    track('dialogue_line_replayed', { hasAudio: node.audio?.localUri != null });
    const uri = node.audio?.localUri;
    if (!uri) {
      if (node.sentence?.ru) void speak(node.sentence.ru);
      return;
    }
    ephemeralRef.current?.release();
    try {
      const player = createAudioPlayer({ uri });
      ephemeralRef.current = player;
      player.play();
    } catch {
      if (node.sentence?.ru) void speak(node.sentence.ru);
    }
  }, []);

  const scrollRef = React.useRef<ScrollView>(null);

  const confirmRestart = React.useCallback(() => {
    const midRun = !run.finishInfo && (engine?.entries.length ?? 0) > 1;
    if (!midRun) {
      void run.restart();
      return;
    }
    Alert.alert('Начать сначала?', 'Текущий разговор будет отброшен.', [
      { text: 'Продолжить разговор', style: 'cancel' },
      { text: 'Сначала', style: 'destructive', onPress: () => void run.restart() },
    ]);
  }, [run, engine]);

  // ----- states ---------------------------------------------------------

  if (graphQuery.isPending || (graph && run.phase === 'loading')) {
    return (
      <View className="flex-1 items-center justify-center bg-bg" style={{ paddingTop: insets.top }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (graphQuery.isError || run.phase === 'error') {
    return (
      <View
        className="flex-1 items-center justify-center gap-3 bg-bg px-8"
        style={{ paddingTop: insets.top }}
      >
        <QueryError
          onRetry={() => {
            if (graphQuery.isError) void graphQuery.refetch();
            else run.retryInit();
          }}
        />
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="min-h-12 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
        >
          <Text className="text-accent">Back</Text>
        </Pressable>
      </View>
    );
  }

  // Pack uninstalled (also mid-run: the graph query refetches to null).
  if (!graph || !engine) {
    return (
      <View
        className="flex-1 items-center justify-center gap-3 bg-bg px-8"
        style={{ paddingTop: insets.top }}
      >
        <Ionicons name="cloud-offline-outline" size={40} color={theme.textMuted} />
        <Text className="font-ui-medium text-lg">Контент удалён</Text>
        <Text variant="muted" className="text-center">
          This dialogue&apos;s pack is no longer installed. Your runs and collected endings are kept
          and will reconnect when the pack is reinstalled.
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="mt-2 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
        >
          <Text className="text-accent">Back</Text>
        </Pressable>
      </View>
    );
  }

  if (run.finishInfo) {
    return (
      <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
        <Header
          title={graph.dialogue.titleRu}
          onClose={() => router.back()}
          onRestart={confirmRestart}
        />
        <EndingView
          graph={graph}
          ending={run.finishInfo.ending}
          entries={engine.entries}
          onRestart={() => void run.restart()}
          onClose={() => router.back()}
        />
      </View>
    );
  }

  // Stale engine on an open screen (pack replaced under us): recover by
  // restarting — content changed, the old walk can't continue.
  if (engine.status !== 'active' || !engine.current) {
    return (
      <View
        className="flex-1 items-center justify-center gap-3 bg-bg px-8"
        style={{ paddingTop: insets.top }}
      >
        <Ionicons name="refresh-outline" size={40} color={theme.textMuted} />
        <Text variant="muted" className="text-center">
          Этот диалог обновился — начни разговор заново.
        </Text>
        <Pressable
          onPress={() => void run.restart()}
          accessibilityRole="button"
          className="mt-2 rounded-full bg-accent px-5 py-2.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-bg">Начать сначала</Text>
        </Pressable>
      </View>
    );
  }

  const lastEntryKey = engine.entries[engine.entries.length - 1]?.key;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      <Header
        title={graph.dialogue.titleRu}
        onClose={() => router.back()}
        onRestart={confirmRestart}
      />

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="gap-3 px-4 pb-6 pt-3"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        // The choice panel appearing shrinks this viewport without a content
        // change — re-pin to the newest line then too.
        onLayout={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {engine.entries.map((entry) => {
          if (entry.kind === 'choice') {
            return <ChoiceBubble key={entry.key} entry={entry} onWordPress={onWordPress} />;
          }
          const isCurrent = entry.key === lastEntryKey && entry.node.id === engine.current?.id;
          return (
            <NodeBubble
              key={entry.key}
              entry={entry}
              graph={graph}
              isCurrent={isCurrent}
              karaokeTokenIndex={isCurrent ? playback.karaokeTokenIndex : null}
              sentenceWash={isCurrent && playback.sentenceWash}
              onWordPress={onWordPress}
              onReplay={isCurrent ? playback.replay : () => replayPast(entry.node)}
            />
          );
        })}

        {showManualAdvance && (
          <View className="items-center pt-1">
            <Pressable
              onPress={handleLineDone}
              accessibilityRole="button"
              className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 active:bg-surface-2"
            >
              <Text className="font-ui-medium text-accent">Далее</Text>
              <Ionicons name="arrow-forward" size={15} color={theme.accent} />
            </Pressable>
          </View>
        )}
      </ScrollView>

      {showChoices && engine.current && (
        <ChoicePanel
          // Remount per choice point so attempts/feedback start fresh.
          key={stepKey}
          node={engine.current}
          disabled={resolving}
          onResolve={handleResolve}
          onWordPress={onWordPress}
        />
      )}

      <WordPopup target={popupTarget} onClose={() => setPopupTarget(null)} />
    </View>
  );
}

function Header({
  title,
  onClose,
  onRestart,
}: {
  title: string;
  onClose: () => void;
  onRestart: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  return (
    <View className="flex-row items-center gap-3 border-b border-border bg-surface px-3 py-2.5">
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close dialogue"
        className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
      >
        <Ionicons name="chevron-back" size={22} color={theme.text} />
      </Pressable>
      <Text className="flex-1 font-ui-medium text-lg" numberOfLines={1}>
        {title}
      </Text>
      <Pressable
        onPress={onRestart}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Restart dialogue"
        className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
      >
        <Ionicons name="refresh" size={19} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}
