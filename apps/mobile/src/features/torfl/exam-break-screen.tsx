import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatMinutes } from './hub-model';
import { SUBTEST_LABELS } from './topics';
import type { ExamSubtestKind } from '@sumrak/schema';

/** The untimed break between subtests of a full mock (T71, TORFL §8.2). */
export function ExamBreakScreen({
  nextKind,
  nextTitle,
  nextMin,
  onContinue,
  onQuit,
}: {
  nextKind: ExamSubtestKind;
  nextTitle: string;
  nextMin: number;
  onContinue: () => void;
  onQuit: () => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-5 bg-bg px-8"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}
      testID="exam-break"
    >
      <Ionicons name="cafe-outline" size={44} color={tokens.accent} />
      <View className="items-center gap-1">
        <Text className="font-reading-bold text-2xl">Перерыв</Text>
        <Text variant="muted" className="text-center">
          Время не идёт. Отдохни, когда будешь готов — продолжай.
        </Text>
      </View>
      <View className="items-center gap-1 rounded-2xl border border-border bg-surface px-5 py-4">
        <Text variant="caption">Следующий субтест</Text>
        <View className="flex-row items-center gap-2">
          <Ionicons name={SUBTEST_LABELS[nextKind].icon} size={18} color={tokens.textMuted} />
          <Text className="font-ui-bold text-lg">
            {nextTitle} · {formatMinutes(nextMin)}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={onContinue}
        accessibilityRole="button"
        testID="break-continue"
        className="w-full items-center rounded-full bg-accent px-5 py-3.5 active:opacity-80"
      >
        <Text className="font-ui-bold text-bg">Продолжить</Text>
      </Pressable>
      <Pressable onPress={onQuit} accessibilityRole="button" className="py-2">
        <Text className="font-ui-medium text-text-muted">Выйти из экзамена</Text>
      </Pressable>
    </View>
  );
}

/** The writing / speaking «скоро» placeholder (T72 / T73 replace it). */
export function ExamPlaceholderScreen({
  titleRu,
  kind,
  onSkip,
  onQuit,
}: {
  titleRu: string;
  kind: ExamSubtestKind;
  onSkip: () => void;
  onQuit: () => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-5 bg-bg px-8"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}
      testID="exam-placeholder"
    >
      <Ionicons name={SUBTEST_LABELS[kind].icon} size={44} color={tokens.textMuted} />
      <View className="items-center gap-1">
        <Text className="font-reading-bold text-2xl">{titleRu}</Text>
        <Text className="font-ui-medium text-accent">скоро</Text>
        <Text variant="muted" className="mt-2 text-center">
          Этот субтест появится в следующем обновлении. Сейчас он записывается как пропущенный и не
          входит в проценты.
        </Text>
      </View>
      <Pressable
        onPress={onSkip}
        accessibilityRole="button"
        testID="placeholder-skip"
        className="w-full items-center rounded-full bg-accent px-5 py-3.5 active:opacity-80"
      >
        <Text className="font-ui-bold text-bg">Дальше</Text>
      </Pressable>
      <Pressable onPress={onQuit} accessibilityRole="button" className="py-2">
        <Text className="font-ui-medium text-text-muted">Выйти из экзамена</Text>
      </Pressable>
    </View>
  );
}
