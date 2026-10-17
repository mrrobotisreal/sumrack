import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { QueryError } from '@/components/query-error';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { panelFor, highestUnlocked } from './hotel-model';
import { useHotelFloors, useCourseProgress, useHotelState } from './hotel-hooks';
import { Lift } from './lift/lift';
import { FloorLobby } from './floor-lobby';

/**
 * T92: the Путь tab IS the hotel (decision 1). The ladder header and the lift;
 * the open doors show the current floor's lobby. The lift never rides to a
 * locked floor (▲ dark), and «13» appears only once the gate is revealed.
 */
export function HotelScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const floors = useHotelFloors();
  const progress = useCourseProgress();
  const hotel = useHotelState();
  const [floor, setFloor] = React.useState<number>(0);
  const [toast, setToast] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      track('hotel_floor_entered', { floor, via: 'lift' });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (floors.isPending || progress.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (floors.isError || progress.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError
          onRetry={() => {
            void floors.refetch();
            void progress.refetch();
          }}
        />
      </View>
    );
  }

  const states = hotel.states;
  const panel = panelFor(
    (floors.data ?? []).map((f) => ({
      packId: f.packId,
      floor: f.floor,
      unitIds: f.course.units.map((u) => u.id),
      hasExam: f.course.floorExam !== undefined,
    })),
  ).map((f) => f.floor);
  const panelWith13 = hotel.reveal13 ? [...panel.slice(0, panel.indexOf(15)), 13, 15] : panel;
  const top = highestUnlocked(states) ?? 0;
  const state = states.find((s) => s.floor === floor);
  const titleFor = (n: number) => {
    if (n === 0) return { ru: 'Вестибюль', en: 'Lobby' };
    if (n === 13) return { ru: 'Номер 13', en: 'Room 13' };
    const f = (floors.data ?? []).find((x) => x.floor === n);
    return { ru: f?.title.ru ?? `Этаж ${n}`, en: f?.title.en ?? `Floor ${n}` };
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-4 px-4 py-6">
      <View className="gap-1">
        <Text variant="caption" className="uppercase tracking-wider">
          ТРКИ-А1 · Отель «Сумрак»
        </Text>
        <Text variant="caption" className="text-text-muted">
          A1 ● — A2 ○ — B1 ○ — B2 ○ — C1 ○
        </Text>
      </View>

      <Lift
        panel={panelWith13}
        floor={floor}
        highestUnlocked={top}
        titleFor={titleFor}
        reveal13={hotel.reveal13}
        onArrive={(n) => {
          setFloor(n);
          void hotel.lastFloor;
        }}
        onBlockedUp={() => setToast(true)}
        onRide13={() => router.push('/hotel/room-13' as never)}
      >
        {state ? (
          <FloorLobby state={state} floorTitle={titleFor(floor)} packs={floors.data ?? []} />
        ) : null}
      </Lift>

      {toast ? (
        <Pressable onPress={() => setToast(false)} accessibilityRole="button">
          <Text variant="caption">Сначала сдайте экзамен этажа</Text>
        </Pressable>
      ) : null}

      {hotel.reveal13 && !hotel.gatePassed ? <Text variant="caption">Номер 13 ждёт</Text> : null}
    </ScrollView>
  );
}
