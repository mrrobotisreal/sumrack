import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { TokenRow } from '@/db/repositories/content';
import { useAppTheme } from '@/theme/use-app-theme';

import { TokenText, type PhraseSelection } from './token-text';

import type { TextStyle } from 'react-native';

interface SentenceRowProps {
  sentenceId: string;
  ruTokens: TokenRow[];
  en: string;
  revealed: boolean;
  onToggleReveal: () => void;
  readingStyle: TextStyle;
  translationStyle: TextStyle;
  onWordPress: (token: TokenRow, sentenceId: string) => void;
  onPhraseSelected: (selection: PhraseSelection, sentenceId: string) => void;
  onSelectingChange: (selecting: boolean) => void;
  /** T10 karaoke: the currently-spoken token in this sentence (word mode). */
  karaokeTokenIndex?: number | null;
  /** T10 karaoke: sentence-level fallback — wash the whole sentence. */
  karaokeSentenceActive?: boolean;
  /**
   * T10 tap-sentence-to-seek: non-null while a narration track is loaded.
   * Fires on taps that land on the sentence but not on a word (word taps
   * keep opening the lookup popup).
   */
  onSeekToSentence?: ((sentenceId: string) => void) | null;
}

/**
 * One sentence of the reader (UI_DESIGN §7 `SentenceRow`): token-level
 * Russian text (T05 TokenText — tap lookup + drag selection) with the
 * translation-reveal icon in a fixed-width right margin ("fixed x so eyes
 * learn the spot", §4).
 */
function SentenceRowInner({
  sentenceId,
  ruTokens,
  en,
  revealed,
  onToggleReveal,
  readingStyle,
  translationStyle,
  onWordPress,
  onPhraseSelected,
  onSelectingChange,
  karaokeTokenIndex,
  karaokeSentenceActive,
  onSeekToSentence,
}: SentenceRowProps) {
  const { tokens } = useAppTheme();
  const handleWordPress = React.useCallback(
    (token: TokenRow) => onWordPress(token, sentenceId),
    [onWordPress, sentenceId],
  );
  const handlePhraseSelected = React.useCallback(
    (selection: PhraseSelection) => onPhraseSelected(selection, sentenceId),
    [onPhraseSelected, sentenceId],
  );
  const handleSeek = React.useMemo(
    () => (onSeekToSentence ? () => onSeekToSentence(sentenceId) : undefined),
    [onSeekToSentence, sentenceId],
  );
  return (
    <View className="flex-row items-start px-5 py-2">
      {/* Word taps (RNText onPress) win over this pressable; touches on the
          gaps/punctuation/background seek the narration here (T10). */}
      <Pressable
        className={
          karaokeSentenceActive
            ? '-mx-2 flex-1 rounded-lg bg-accent-soft px-2'
            : '-mx-2 flex-1 px-2'
        }
        onPress={handleSeek}
        disabled={!handleSeek}
        accessibilityLabel={handleSeek ? 'Play narration from this sentence' : undefined}
      >
        <TokenText
          tokens={ruTokens}
          readingStyle={readingStyle}
          onWordPress={handleWordPress}
          onPhraseSelected={handlePhraseSelected}
          onSelectingChange={onSelectingChange}
          karaokeTokenIndex={karaokeTokenIndex}
        />
        {revealed && (
          <Animated.View
            entering={FadeIn.duration(180)}
            className="mt-1.5 border-l-2 border-accent/40 pl-3"
          >
            <RNText style={[translationStyle, { color: tokens.textMuted }]}>{en}</RNText>
          </Animated.View>
        )}
      </Pressable>
      <Pressable
        onPress={onToggleReveal}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={revealed ? 'Hide translation' : 'Show translation'}
        accessibilityState={{ expanded: revealed }}
        className="ml-2 w-9 items-center pt-1 active:opacity-60"
      >
        <Ionicons
          name={revealed ? 'language' : 'language-outline'}
          size={16}
          color={revealed ? tokens.accent : tokens.border}
        />
      </Pressable>
    </View>
  );
}

export const SentenceRow = React.memo(SentenceRowInner);
