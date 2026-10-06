import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { matrixCounts, submitConfirmCopy, type MatrixCell } from './engine/matrix';

/**
 * The answer matrix sheet (T71, TORFL §8.2): a grid of item numbers — answered
 * filled, unanswered outlined, flagged ⚑, current ringed; tap to jump (cells
 * the engine would refuse — the linear lock — are dimmed); «Сдать субтест»
 * confirms with the unanswered count. NEVER shows correctness.
 */
export function ExamMatrixSheet({
  open,
  cells,
  linear,
  onJump,
  onSubmit,
  onClose,
}: {
  open: boolean;
  cells: readonly MatrixCell[];
  linear: boolean;
  onJump: (flat: number) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const counts = matrixCounts(cells);

  const confirmSubmit = () => {
    const copy = submitConfirmCopy(counts);
    Alert.alert(copy.title, copy.body, [
      { text: 'Вернуться', style: 'cancel' },
      { text: 'Сдать', style: 'destructive', onPress: onSubmit },
    ]);
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Закрыть" />
      <View
        className="max-h-[80%] rounded-t-2xl border-t border-border bg-surface px-5 pt-4"
        style={{ paddingBottom: insets.bottom + 20 }}
        testID="exam-matrix"
      >
        <View className="mb-3 flex-row items-center justify-between">
          <View>
            <Text className="font-ui-medium text-lg">Матрица ответов</Text>
            <Text variant="caption" testID="matrix-counts">
              Отвечено {counts.answered} из {counts.total}
              {counts.flagged > 0 ? ` · флажков ${counts.flagged}` : ''}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Закрыть">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>
        <ScrollView>
          <View className="flex-row flex-wrap gap-2 pb-3">
            {cells.map((c) => (
              <Pressable
                key={c.itemId}
                disabled={!c.enabled}
                onPress={() => {
                  onJump(c.flat);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Задание ${c.number}: ${c.answered ? 'есть ответ' : 'без ответа'}${c.flagged ? ', с флажком' : ''}`}
                testID={`matrix-cell-${c.number}`}
                className={cn(
                  'h-11 w-11 items-center justify-center rounded-lg border',
                  c.answered ? 'border-accent bg-accent' : 'border-border bg-bg',
                  c.current && 'border-2 border-text',
                  !c.enabled && 'opacity-30',
                )}
              >
                <Text className={cn('font-ui-medium', c.answered ? 'text-bg' : 'text-text')}>
                  {c.number}
                </Text>
                {c.flagged && (
                  <View className="absolute -right-1 -top-1">
                    <Ionicons name="flag" size={14} color={tokens.trackWarm} />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <View className="mb-3 flex-row flex-wrap gap-x-4 gap-y-1">
          <Legend filled label="есть ответ" />
          <Legend label="без ответа" />
          <Legend flag label="флажок" />
          {linear && <Text variant="caption">Назад нельзя: текст звучит один раз подряд.</Text>}
        </View>
        <Pressable
          onPress={confirmSubmit}
          accessibilityRole="button"
          testID="matrix-submit"
          className="items-center rounded-full bg-accent py-3.5 active:opacity-80"
        >
          <Text className="font-ui-bold text-bg">Сдать субтест</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Legend({ filled, flag, label }: { filled?: boolean; flag?: boolean; label: string }) {
  const { tokens } = useAppTheme();
  return (
    <View className="flex-row items-center gap-1.5">
      {flag ? (
        <Ionicons name="flag" size={12} color={tokens.trackWarm} />
      ) : (
        <View
          className={cn(
            'h-3 w-3 rounded-sm border',
            filled ? 'border-accent bg-accent' : 'border-border',
          )}
        />
      )}
      <Text variant="caption" className="text-xs">
        {label}
      </Text>
    </View>
  );
}
