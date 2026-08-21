import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useAppTheme } from '@/theme/use-app-theme';

import type { TextStyle } from 'react-native';

interface SentenceRowProps {
  ru: string;
  en: string;
  revealed: boolean;
  onToggleReveal: () => void;
  readingStyle: TextStyle;
  translationStyle: TextStyle;
}

/**
 * One sentence of the reader (UI_DESIGN §7 `SentenceRow`): Russian text with
 * the translation-reveal icon in a fixed-width right margin ("fixed x so
 * eyes learn the spot", §4). Tapping the text itself is reserved for T05's
 * word popup — only the margin icon toggles the translation.
 */
function SentenceRowInner({
  ru,
  en,
  revealed,
  onToggleReveal,
  readingStyle,
  translationStyle,
}: SentenceRowProps) {
  const { tokens } = useAppTheme();
  return (
    <View className="flex-row items-start px-5 py-2">
      <View className="flex-1">
        {/* RNText directly (not ui/Text) so the dynamic type prefs fully own the style */}
        <RNText style={[readingStyle, { color: tokens.text }]}>{ru}</RNText>
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
