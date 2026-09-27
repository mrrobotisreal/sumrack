import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * The lifeline (T62 §9.3, §1.3 decision 6): «Подсказка» appears once the
 * reducer unlocks it (2nd miss, 2nd «я не понимаю», an unanswerable meta
 * ask); tapping reveals the turn's `retry.lifeline` RU + EN inline and
 * marks the turn `assisted` — the ONLY answer-shaped text in a run.
 */
export function LifelineChip({
  available,
  revealed,
  lifeline,
  onReveal,
}: {
  available: boolean;
  revealed: boolean;
  lifeline: { ru: string; en: string } | null;
  onReveal: () => void;
}) {
  const { tokens } = useAppTheme();
  if (!available || !lifeline) return null;
  if (!revealed) {
    return (
      <Pressable
        onPress={onReveal}
        accessibilityRole="button"
        accessibilityLabel="Reveal the hint"
        className="flex-row items-center gap-1.5 self-center rounded-full border border-accent/50 bg-accent-soft px-3 py-1.5 active:opacity-80"
      >
        <Ionicons name="bulb-outline" size={14} color={tokens.accent} />
        <Text className="font-ui-medium text-sm text-accent">Подсказка</Text>
      </Pressable>
    );
  }
  return (
    <View className="gap-0.5 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5">
      <RNText className="font-reading text-lg text-text">{lifeline.ru}</RNText>
      <Text variant="caption">{lifeline.en}</Text>
    </View>
  );
}
