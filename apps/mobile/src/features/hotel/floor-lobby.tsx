import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';

import type { FloorState } from './hotel-model';
import { formatCooldownRu } from './gate-model';
import { PracticeRows, type PracticeRow } from './practice-rows';

/**
 * T92b floor lobby (T92 decision 2): the floor number and title, the unit list
 * («Урок» and «Упражнения» — exercises stay disabled until the lesson was opened
 * once), the floor exam row (cooldown countdown when cooling), «Практика» rows
 * with before/after, and the экстерн entry on the highest unlocked floor.
 */
export interface FloorLobbyProps {
  state: FloorState;
  floorTitle: { ru: string; en: string };
  /** Units whose lesson has been opened at least once (`hotel-hooks` reads it from the progress rows). */
  lessonOpened: ReadonlySet<string>;
  /** «Практика» rows for this floor (only when the drill pack is installed). */
  practice: readonly PracticeRow[];
  /** Offered here only on the highest unlocked floor; null hides the entry. */
  externCount: number | null;
  onExtern: () => void;
  /** Floor exam cooldown in whole minutes left (null when clear). */
  examCooldownMinutes: number | null;
}

export function FloorLobby({
  state,
  floorTitle,
  lessonOpened,
  practice,
  externCount,
  onExtern,
  examCooldownMinutes,
}: FloorLobbyProps) {
  const router = useRouter();
  if (!state.unlocked) {
    return (
      <View className="gap-2 p-4">
        <Text variant="caption">Этаж закрыт</Text>
      </View>
    );
  }
  return (
    <View className="gap-3 p-4" testID="floor-lobby">
      <View className="gap-1">
        <Text variant="caption">Этаж {state.floor}</Text>
        <Text className="font-ui-medium text-lg">{floorTitle.ru}</Text>
      </View>

      {state.units.map((u, i) => {
        const opened = lessonOpened.has(u.unitId);
        return (
          <View
            key={u.unitId}
            className="gap-2 rounded-xl border border-border bg-surface p-3"
            testID="floor-unit"
          >
            <Text className="font-ui-medium">
              {u.passed ? '✓' : u.unlocked ? '▶' : '🔒'} Урок {i + 1}
            </Text>
            <Text variant="caption">Лучший результат: {u.best}%</Text>
            <View className="flex-row gap-2">
              <Pressable
                disabled={!u.unlocked}
                onPress={() => {
                  track('hotel_unit_opened', { packId: state.packId, unitId: u.unitId });
                  router.push(`/hotel/${state.packId}/${u.unitId}` as never);
                }}
                accessibilityRole="button"
                className="rounded-lg bg-surface-2 px-3 py-2"
              >
                <Text>Урок</Text>
              </Pressable>
              <Pressable
                disabled={!u.unlocked || !opened}
                onPress={() => router.push(`/hotel/${state.packId}/${u.unitId}/practice` as never)}
                accessibilityRole="button"
                testID="floor-unit-exercises"
                className="rounded-lg bg-surface-2 px-3 py-2"
              >
                <Text>Упражнения</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {state.hasExam ? (
        <Pressable
          disabled={!state.examUnlocked || examCooldownMinutes !== null}
          onPress={() => router.push(`/hotel/${state.packId}/exam?mode=floor` as never)}
          accessibilityRole="button"
          testID="floor-exam"
          className="rounded-xl border border-border bg-surface p-3"
        >
          <Text className="font-ui-medium">
            {!state.examUnlocked
              ? '🔒 Экзамен этажа'
              : examCooldownMinutes !== null
                ? `Экзамен этажа · через ${formatCooldownRu(examCooldownMinutes)}`
                : 'Экзамен этажа · 80 %'}
          </Text>
          {state.bestPercent > 0 ? (
            <Text variant="caption">Лучший: {state.bestPercent}%</Text>
          ) : null}
        </Pressable>
      ) : null}

      <PracticeRows rows={practice} />

      {externCount !== null ? (
        <Pressable
          onPress={onExtern}
          accessibilityRole="button"
          testID="floor-extern"
          className="items-center rounded-xl border border-border py-3"
        >
          <Text className="font-ui-medium">Сдать экстерном следующий этаж →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
