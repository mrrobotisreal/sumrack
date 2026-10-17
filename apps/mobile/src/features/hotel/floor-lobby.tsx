import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';

import type { FloorState } from './hotel-model';

/**
 * T92 floor lobby (decision 2): the floor number and title, the unit list
 * (state, best %, «Урок», «Упражнения»), and the floor exam row. The «Практика»
 * rows and экстерн entry arrive with the practice wiring (see the handoff).
 */
export interface FloorLobbyProps {
  state: FloorState;
  floorTitle: { ru: string; en: string };
  packs: readonly { packId: string; floor: number; title: { ru: string; en: string } }[];
}

export function FloorLobby({ state, floorTitle }: FloorLobbyProps) {
  const router = useRouter();
  if (!state.unlocked) {
    return (
      <View className="gap-2 p-4">
        <Text variant="caption">Этаж закрыт</Text>
      </View>
    );
  }
  return (
    <View className="gap-3 p-4">
      <View className="gap-1">
        <Text variant="caption">Этаж {state.floor}</Text>
        <Text className="font-ui-medium text-lg">{floorTitle.ru}</Text>
      </View>

      {state.units.map((u, i) => (
        <View key={u.unitId} className="gap-2 rounded-xl border border-border bg-surface p-3">
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
              disabled={!u.unlocked}
              onPress={() => router.push(`/hotel/${state.packId}/${u.unitId}/practice` as never)}
              accessibilityRole="button"
              className="rounded-lg bg-surface-2 px-3 py-2"
            >
              <Text>Упражнения</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {state.hasExam ? (
        <Pressable
          disabled={!state.examUnlocked}
          onPress={() => router.push(`/hotel/${state.packId}/exam?mode=floor` as never)}
          accessibilityRole="button"
          className="rounded-xl border border-border bg-surface p-3"
        >
          <Text className="font-ui-medium">
            {state.examUnlocked ? 'Экзамен этажа · 80 %' : '🔒 Экзамен этажа'}
          </Text>
          {state.bestPercent > 0 ? (
            <Text variant="caption">Лучший: {state.bestPercent}%</Text>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}
