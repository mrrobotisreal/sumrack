import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { TokenRow } from '@/db/repositories/content';
import { TokenText } from '@/features/reader/token-text';
import { WordPopup, type WordPopupTarget } from '@/features/reader/word-popup';
import { useAppTheme } from '@/theme/use-app-theme';

import type { ExamAudio } from './exam-audio';
import { EXAM_READING_STYLE } from './passage-panel';
import { Badge } from './stem-text';
import { NORMAL_RATE, SLOW_RATE, useExamAudio } from './use-exam-audio';

/**
 * The listening item's audio controls (T70). `mode: 'drill'`: play / replay
 * (unlimited) / 0.75×, a play counter, the «синтез» badge when the span is
 * TTS, and after the answer «Показать текст» → the transcript with karaoke
 * over the span + tap lookup.
 *
 * `mode: 'exam'` (T71) is the official rule and is DRIVEN BY THE ENGINE: there
 * is no play / replay / slow / seek control at all and no transcript. The
 * mock engine decides when each of the `maxPlays` plays starts (`examPlay.playNo`
 * changing while `phase === 'playing'` starts the span at rate 1.0, locked),
 * the hook's end-of-span fires `onEnded` (→ `AUDIO_ENDED`), and any other
 * phase stops playback. The card shows «Звучит 1-й раз / 2-й раз», a
 * non-interactive progress bar and the 3 s «пауза» between plays.
 */
export function ListeningPlayer({
  audio,
  mode,
  answered,
  storyId,
  maxPlays,
  autoPlay = false,
  onPlay,
  examPlay,
  onEnded,
}: {
  audio: ExamAudio;
  mode: 'drill' | 'exam';
  answered: boolean;
  storyId: string;
  /** Exam mode: plays allowed (official: 2). Ignored in drills. */
  maxPlays?: number;
  autoPlay?: boolean;
  onPlay?: (playNo: number) => void;
  /** Exam mode: the engine's audio state for this text (see the engine's `RunAudio`). */
  examPlay?: { playNo: number; phase: 'idle' | 'playing' | 'gap' | 'done' };
  /** Exam mode: a play reached its end (→ `AUDIO_ENDED`). */
  onEnded?: () => void;
}) {
  const { tokens } = useAppTheme();
  const controls = useExamAudio(audio, { onPlay, onEnded });
  const [showText, setShowText] = React.useState(false);
  const [target, setTarget] = React.useState<WordPopupTarget | null>(null);
  const exam = mode === 'exam';
  const capped = exam && maxPlays !== undefined && controls.playCount >= maxPlays;

  // Exam mode: the engine owns the clock. A new play number in the `playing` phase starts the
  // span (rate locked at 1.0); leaving `playing` (gap, done, resume, quit) silences it.
  const examPhase = examPlay?.phase;
  const examPlayNo = examPlay?.playNo ?? 0;
  React.useEffect(() => {
    if (!exam) return;
    if (examPhase === 'playing' && examPlayNo > 0) controls.play(NORMAL_RATE);
    else controls.stop();
    // controls.* are stable per audio; the effect is keyed on the engine's state only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam, examPhase, examPlayNo]);

  // Non-interactive progress of the current play (a clock over the span, never a seek bar).
  const [progress, setProgress] = React.useState(0);
  React.useEffect(() => {
    if (!exam || !controls.playing || audio.spanMs <= 0) return;
    const startedAt = Date.now();
    const id = setInterval(
      () => setProgress(Math.min(1, (Date.now() - startedAt) / audio.spanMs)),
      250,
    );
    return () => {
      clearInterval(id);
      setProgress(0);
    };
  }, [exam, controls.playing, audio.spanMs]);

  React.useEffect(() => {
    if (!autoPlay || exam) return;
    const t = setTimeout(() => controls.play(NORMAL_RATE), 350);
    return () => clearTimeout(t);
    // once per item (the view remounts per item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transcriptVisible = mode === 'drill' && answered && showText;
  const activeBySentence = controls.activeWord;

  if (exam) {
    const label =
      examPhase === 'playing'
        ? `Звучит ${examPlayNo === 1 ? '1-й' : `${examPlayNo}-й`} раз`
        : examPhase === 'gap'
          ? 'Пауза — сейчас прозвучит ещё раз'
          : examPhase === 'done'
            ? 'Прослушано'
            : 'Приготовься слушать';
    return (
      <View
        className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4"
        testID="listening-player"
        accessibilityLabel={label}
      >
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
            <Ionicons
              name={examPhase === 'playing' ? 'volume-high' : 'headset-outline'}
              size={22}
              color={tokens.accent}
            />
          </View>
          <View className="flex-1 gap-1">
            <Text className="font-ui-medium" testID="listening-status">
              {label}
            </Text>
            <Text variant="caption">
              {Math.min(examPlayNo, maxPlays ?? 2)} из {maxPlays ?? 2}
            </Text>
          </View>
          {audio.synthetic && <Badge label="синтез" />}
        </View>
        <View className="h-1.5 overflow-hidden rounded-full bg-surface-2" pointerEvents="none">
          <View
            className="h-full rounded-full bg-accent"
            style={{ width: `${(examPhase === 'playing' ? progress : 0) * 100}%` }}
          />
        </View>
      </View>
    );
  }

  return (
    <View
      className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4"
      testID="listening-player"
    >
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => controls.play(NORMAL_RATE)}
          disabled={capped}
          accessibilityRole="button"
          accessibilityLabel={controls.playCount === 0 ? 'Play the audio' : 'Replay the audio'}
          testID="listen-play"
          className={`h-14 w-14 items-center justify-center rounded-full ${capped ? 'bg-surface-2' : 'bg-accent active:opacity-80'}`}
        >
          <Ionicons
            name={controls.playing ? 'volume-high' : controls.playCount === 0 ? 'play' : 'refresh'}
            size={24}
            color={capped ? tokens.textMuted : tokens.bg}
          />
        </Pressable>
        <View className="flex-1 gap-1">
          <Text className="font-ui-medium">
            {controls.playCount === 0 ? 'Нажми и слушай' : `Прослушано: ${controls.playCount}`}
            {exam && maxPlays !== undefined ? ` из ${maxPlays}` : ''}
          </Text>
          {audio.synthetic && <Badge label="синтез" />}
        </View>
        {!exam && (
          <Pressable
            onPress={() => controls.play(SLOW_RATE)}
            accessibilityRole="button"
            accessibilityLabel="Replay at 0.75 speed"
            testID="listen-slow"
            className="rounded-full border border-border px-3 py-2 active:bg-surface-2"
          >
            <Text className="font-ui-medium text-sm">0.75×</Text>
          </Pressable>
        )}
      </View>
      {mode === 'drill' && answered && (
        <Pressable
          onPress={() => setShowText((v) => !v)}
          accessibilityRole="button"
          testID="listen-show-text"
          className="flex-row items-center gap-2 self-start"
        >
          <Ionicons
            name={showText ? 'eye-off-outline' : 'document-text-outline'}
            size={16}
            color={tokens.accent}
          />
          <Text className="font-ui-medium text-sm text-accent">
            {showText ? 'Скрыть текст' : 'Показать текст'}
          </Text>
        </Pressable>
      )}
      {transcriptVisible && (
        <View className="gap-2 border-t border-border pt-3" testID="listen-transcript">
          {audio.transcript.map((s) => (
            <TokenText
              key={s.id}
              tokens={s.tokens}
              readingStyle={EXAM_READING_STYLE}
              onWordPress={(token: TokenRow) => setTarget({ token, sentenceId: s.id, storyId })}
              selectionEnabled={false}
              karaokeTokenIndex={
                activeBySentence && activeBySentence.sentenceId === s.id
                  ? activeBySentence.tokenIndex
                  : null
              }
            />
          ))}
        </View>
      )}
      <WordPopup target={target} onClose={() => setTarget(null)} />
    </View>
  );
}
