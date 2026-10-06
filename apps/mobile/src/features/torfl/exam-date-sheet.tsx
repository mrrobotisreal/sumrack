import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { addDaysToKey } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { monthGrid, monthTitle, shiftMonth } from './calendar';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Exam-date picker sheet (T69, TORFL §5.3 header) — a bottom sheet with a
 * Monday-first month grid (no native picker dependency: no dev-client
 * rebuild, dark tokens throughout). Past days are disabled. «Сохранить»
 * persists the picked day; «Убрать дату» clears `torfl.examDate`.
 */
export function ExamDateSheet({
  open,
  current,
  today,
  onSave,
  onClose,
}: {
  open: boolean;
  current: string | null;
  today: string;
  onSave: (date: string | null) => void;
  onClose: () => void;
}) {
  const { tokens } = useAppTheme();
  // Fresh state per open: the hub mounts this sheet with a new `key` on
  // every open, so the initial values below are re-read each time.
  const [picked, setPicked] = React.useState<string | null>(current);
  const [month, setMonth] = React.useState<string>(
    (current ?? addDaysToKey(today, 30)).slice(0, 7),
  );

  const cells = monthGrid(month);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Закрыть" />
      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-10 pt-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">Дата экзамена</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Закрыть">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>

        <View className="mb-2 flex-row items-center justify-between">
          <Pressable
            onPress={() => setMonth((m) => shiftMonth(m, -1))}
            disabled={month <= today.slice(0, 7)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Предыдущий месяц"
            className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-2"
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={month <= today.slice(0, 7) ? tokens.border : tokens.text}
            />
          </Pressable>
          <Text className="font-ui-medium">{monthTitle(month)}</Text>
          <Pressable
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Следующий месяц"
            className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-2"
          >
            <Ionicons name="chevron-forward" size={18} color={tokens.text} />
          </Pressable>
        </View>

        <View className="flex-row">
          {WEEKDAYS.map((d) => (
            <Text key={d} variant="caption" className="flex-1 text-center text-xs">
              {d}
            </Text>
          ))}
        </View>
        <View className="mt-1 flex-row flex-wrap">
          {cells.map((day, i) => {
            if (day === null) return <View key={`pad-${i}`} className="h-11 w-[14.2857%]" />;
            const past = day < today;
            const selected = day === picked;
            return (
              <View key={day} className="h-11 w-[14.2857%] items-center justify-center">
                <Pressable
                  onPress={() => setPicked(day)}
                  disabled={past}
                  accessibilityRole="button"
                  accessibilityLabel={day}
                  accessibilityState={{ selected, disabled: past }}
                  className={cn(
                    'h-9 w-9 items-center justify-center rounded-full',
                    selected ? 'bg-accent' : 'active:bg-surface-2',
                    day === today && !selected && 'border border-border',
                  )}
                >
                  <Text
                    className={cn(
                      'font-ui text-sm',
                      selected && 'font-ui-bold text-bg',
                      past && 'text-border',
                    )}
                  >
                    {Number(day.slice(8))}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View className="mt-4 flex-row gap-3">
          {current !== null && (
            <Pressable
              onPress={() => onSave(null)}
              accessibilityRole="button"
              className="flex-1 items-center rounded-full border border-border px-4 py-3 active:bg-surface-2"
            >
              <Text className="text-text-muted">Убрать дату</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => picked && onSave(picked)}
            disabled={!picked || picked === current}
            accessibilityRole="button"
            className={cn(
              'flex-1 items-center rounded-full px-4 py-3',
              !picked || picked === current ? 'bg-surface-2' : 'bg-accent active:opacity-80',
            )}
          >
            <Text
              className={cn(
                'font-ui-medium',
                !picked || picked === current ? 'text-text-muted' : 'text-bg',
              )}
            >
              Сохранить
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
