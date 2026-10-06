import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { MODE_LABELS, bestLabel, formatMinutes, ruPlural, type ExamListItem } from './hub-model';
import { SUBTEST_LABELS } from './topics';

const ITEMS = ['задание', 'задания', 'заданий'] as const;

/**
 * One exam as a row (T69, TORFL §5.2 item 3) — the Library «ТРКИ» shelf and
 * the hub's «Пробные экзамены» list share it. Title, a mode badge
 * («Пробный экзамен» accent-washed / «Тренировка» neutral), one chip per
 * subtest, the best result or «не пройден»; tap → the exam's intro.
 */
export function ExamRow({ item, onPress }: { item: ExamListItem; onPress: () => void }) {
  const { tokens } = useAppTheme();
  const mock = item.mode === 'mock';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${MODE_LABELS[item.mode]}: ${item.titleRu}. ${bestLabel(item.best)}`}
      testID={`exam-row-${item.examId}`}
      className="mb-2 gap-2 rounded-xl border border-border bg-surface px-4 py-3.5 active:bg-surface-2"
    >
      <View className="flex-row items-center gap-2">
        <View className={cn('rounded-full px-2 py-0.5', mock ? 'bg-accent-soft' : 'bg-surface-2')}>
          <Text className={cn('font-ui-medium text-xs', mock ? 'text-accent' : 'text-text-muted')}>
            {MODE_LABELS[item.mode]}
          </Text>
        </View>
        <Text variant="caption" className="flex-1" numberOfLines={1}>
          {item.itemCount} {ruPlural(item.itemCount, ITEMS)} · {formatMinutes(item.totalMin)}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={tokens.textMuted} />
      </View>
      <Text className="font-reading text-base" numberOfLines={2}>
        {item.titleRu}
      </Text>
      <View className="flex-row flex-wrap items-center gap-1.5">
        {item.subtestKinds.map((kind, i) => (
          <View
            key={`${kind}-${i}`}
            className="flex-row items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"
          >
            <Ionicons name={SUBTEST_LABELS[kind].icon} size={11} color={tokens.textMuted} />
            <Text variant="caption" className="text-xs">
              {SUBTEST_LABELS[kind].short}
            </Text>
          </View>
        ))}
        <Text
          variant="caption"
          className={cn('ml-auto', item.best?.verdict === 'pass' && 'text-success')}
        >
          {bestLabel(item.best)}
        </Text>
      </View>
    </Pressable>
  );
}
