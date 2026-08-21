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
  return (
    <View className="flex-row items-start px-5 py-2">
      <View className="flex-1">
        <TokenText
          tokens={ruTokens}
          readingStyle={readingStyle}
          onWordPress={handleWordPress}
          onPhraseSelected={handlePhraseSelected}
          onSelectingChange={onSelectingChange}
        />
        {revealed && (
          <Animated.View
            entering={FadeIn.duration(180)}
            className="mt-1.5 border-l-2 border-accent/40 pl-3"
          >
            <RNText style={[translationStyle, { color: tokens.textMuted }]}>{en}</RNText>
          </Animated.View>
        )}
      </View>
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
