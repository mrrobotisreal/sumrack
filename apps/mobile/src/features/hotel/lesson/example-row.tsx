import { Ionicons } from '@expo/vector-icons';
import type { SentenceWithTokens, TokenRow } from '@/db/repositories/content';
import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useExamAudio } from '@/features/torfl/items/use-exam-audio';
import { useAppTheme } from '@/theme/use-app-theme';

import type { ExamAudio } from '@/features/torfl/items/exam-audio';
import { buildSentenceChunks, highlightIndices } from './lesson-model';
import { SentenceLine } from './sentence-line';

/**
 * One voiced example (T90 decision 1): the Russian sentence with its
 * `highlight` surfaces in accent, the English gloss muted, the `why` pill,
 * and a ▶ that plays the narration span with karaoke. Long-press the Russian
 * line → the reader's word popup (the parent owns the popup, `onWordPress`).
 */
export function ExampleRow({
  sentence,
  highlight,
  english,
  why,
  audio,
  onWordPress,
  onPlay,
}: {
  sentence: SentenceWithTokens;
  highlight: readonly string[];
  english?: string;
  why?: string;
  audio: ExamAudio | null;
  onWordPress: (token: TokenRow, sentenceId: string) => void;
  /** Fires when ▶ starts playback (the library quote's play event). */
  onPlay?: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const controls = useExamAudio(audio);
  const karaokeToken =
    controls.activeWord && controls.activeWord.sentenceId === sentence.id
      ? controls.activeWord.tokenIndex
      : null;
  const hits = React.useMemo(
    () => highlightIndices(sentence.tokens, highlight),
    [sentence.tokens, highlight],
  );
  return (
    <View
      className="gap-1.5 rounded-xl border border-border bg-surface px-4 py-3"
      testID="example-row"
    >
      {why ? (
        <View className="self-start rounded-full bg-accent-soft px-2.5 py-0.5">
          <Text className="font-ui-medium text-xs text-accent">{why}</Text>
        </View>
      ) : null}
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <SentenceLine
            chunks={buildSentenceChunks(sentence.tokens)}
            tokens={sentence.tokens}
            highlighted={hits}
            karaokeTokenIndex={karaokeToken}
            onWordPress={(token) => onWordPress(token, sentence.id)}
          />
        </View>
        <Pressable
          onPress={() => {
            if (controls.playing) {
              controls.stop();
              return;
            }
            onPlay?.();
            controls.play();
          }}
          disabled={!audio}
          accessibilityRole="button"
          accessibilityLabel={controls.playing ? 'Остановить' : 'Прослушать предложение'}
          testID="example-play"
          className="h-11 w-11 items-center justify-center rounded-full bg-surface-2 active:opacity-80"
          style={{ opacity: audio ? 1 : 0.4 }}
        >
          <Ionicons name={controls.playing ? 'stop' : 'play'} size={18} color={theme.accent} />
        </Pressable>
      </View>
      {english ? (
        <RNText className="font-reading-italic text-sm text-text-muted">{english}</RNText>
      ) : null}
    </View>
  );
}
