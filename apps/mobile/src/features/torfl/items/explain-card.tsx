import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import type { ItemOutcome } from '../scoring';

/**
 * The feedback card that slides up after a drill answer (T70, TORFL §7.1):
 * the verdict line, the item's `explain` (when authored) and «Дальше».
 */
export function ExplainCard({
  outcome,
  explain,
  last,
  onNext,
}: {
  outcome: ItemOutcome;
  explain?: string;
  last: boolean;
  onNext: () => void;
}) {
  const { tokens } = useAppTheme();
  const ok = outcome === 'full';
  const half = outcome === 'half';
  const icon = ok ? 'checkmark-circle' : half ? 'remove-circle' : 'close-circle';
  const color = ok ? tokens.success : half ? tokens.trackWarm : tokens.danger;
  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      testID="explain-card"
      className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4"
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={22} color={color} />
        <Text className="font-ui-bold text-base">
          {ok ? 'Верно' : half ? 'Почти' : outcome === 'blank' ? 'Без ответа' : 'Неверно'}
        </Text>
      </View>
      {explain ? (
        <Text variant="muted" className="leading-6" testID="explain-text">
          {explain}
        </Text>
      ) : null}
      <Pressable
        onPress={onNext}
        accessibilityRole="button"
        testID="explain-next"
        className="items-center rounded-xl bg-accent py-3.5 active:opacity-80"
      >
        <Text className="font-ui-medium text-bg">{last ? 'Завершить' : 'Дальше'}</Text>
      </Pressable>
    </Animated.View>
  );
}
