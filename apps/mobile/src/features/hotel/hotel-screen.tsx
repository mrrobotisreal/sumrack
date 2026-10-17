import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { QueryError } from '@/components/query-error';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  EXTERN_CONFIRM,
  externMenu,
  highestUnlocked,
  panelFor,
  parseLastFloor,
  startFloor,
  type FloorState,
} from './hotel-model';
import { cooldownLeft } from './gate-model';
import {
  useHotelFloors,
  useCourseProgress,
  useHotelState,
  useLastFloor,
  useLessonOpened,
  usePracticeRows,
} from './hotel-hooks';
import { Lift } from './lift/lift';
import { FloorLobby } from './floor-lobby';
import type { PracticeRow } from './practice-rows';

/**
 * T92: the Путь tab IS the hotel (decision 1). The ladder header and the lift;
 * the open doors show the current floor's lobby. The lift never rides to a
 * locked floor (▲ dark), and «13» appears only once the gate is revealed.
 * The tab opens on `hotel.lastFloor` (decision 4); `?floor=N` (a deep link,
 * decision 11) overrides it for one visit and is saved.
 */
export function HotelScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ floor?: string }>();
  const deepFloor = params.floor !== undefined ? parseLastFloor(Number(params.floor)) : null;
  const floors = useHotelFloors();
  const progress = useCourseProgress();
  const hotel = useHotelState();
  const lastFloor = useLastFloor();
  const lessonOpened = useLessonOpened();
  // The lift's floor: null until the saved/deep-linked start is known, then user-driven.
  const [picked, setFloor] = React.useState<number | null>(null);
  const [toast, setToast] = React.useState(false);
  const [externMenuOpen, setExternMenuOpen] = React.useState(false);
  const [externTarget, setExternTarget] = React.useState<FloorState | null>(null);

  const states = hotel.states;
  const installedPanel = panelFor(
    (floors.data ?? []).map((f) => ({
      packId: f.packId,
      floor: f.floor,
      unitIds: f.course.units.map((u) => u.id),
      hasExam: f.course.floorExam !== undefined,
    })),
  ).map((f) => f.floor);
  // Empty state (decision 7): no floors installed → the lift still shows floor 0.
  const basePanel = installedPanel.length > 0 ? installedPanel : [0];
  const panel = hotel.reveal13
    ? [...basePanel.filter((n) => n !== 13), 13].sort((a, b) => a - b)
    : basePanel;
  const top = highestUnlocked(states) ?? 0;

  // The start floor is derived, not stored: the deep link wins, else the saved floor.
  const start = startFloor(panel, deepFloor ?? (lastFloor.loaded ? lastFloor.lastFloor : null));
  const floor = picked ?? (lastFloor.loaded ? start : null);

  // A deep link is saved once it is the floor shown; the tab then keeps it.
  const savedDeep = React.useRef(false);
  React.useEffect(() => {
    if (deepFloor === null || savedDeep.current || !lastFloor.loaded) return;
    savedDeep.current = true;
    void lastFloor.save(start);
  }, [deepFloor, lastFloor, start]);

  const enteredFor = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (floor === null || enteredFor.current === floor) return;
    enteredFor.current = floor;
    track('hotel_floor_entered', { floor, via: 'lift' });
  }, [floor]);

  const shownFloor = floor ?? 0;
  const state = states.find((s) => s.floor === shownFloor);
  const practiceRef =
    (floors.data ?? []).find((f) => f.floor === shownFloor)?.course.practice ?? [];
  const practice = usePracticeRows(state ? state.packId : null, practiceRef);
  const practiceRows: PracticeRow[] = practice.data ?? [];

  // The экстерн entry lives in the lobby of the highest unlocked floor (decision 3).
  const menu = externMenu(states);
  const externCount = shownFloor === top && menu.length > 0 ? menu.length : null;
  const examCooldown = state?.cooldownUntil ? cooldownLeft(state.cooldownUntil, hotel.now) : null;
  const examCooldownMinutes = examCooldown?.minutesLeft ?? null;

  if (floors.isPending || progress.isPending || !lastFloor.loaded || floor === null) {
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

  const titleFor = (n: number) => {
    if (n === 0) return { ru: 'Вестибюль', en: 'Lobby' };
    if (n === 13) return { ru: 'Номер 13', en: 'Room 13' };
    const f = (floors.data ?? []).find((x) => x.floor === n);
    return { ru: f?.title.ru ?? `Этаж ${n}`, en: f?.title.en ?? `Floor ${n}` };
  };

  const nextAbove = panel.find((n) => n > top);

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
        panel={panel}
        floor={floor}
        highestUnlocked={top}
        titleFor={titleFor}
        reveal13={hotel.reveal13}
        onArrive={(n) => {
          setFloor(n);
          void lastFloor.save(n);
        }}
        onBlockedUp={() => setToast(true)}
        onRide13={() => router.push('/hotel/room-13' as never)}
      >
        {state ? (
          <FloorLobby
            state={state}
            floorTitle={titleFor(shownFloor)}
            lessonOpened={lessonOpened}
            practice={practiceRows}
            externCount={externCount}
            onExtern={() => setExternMenuOpen(true)}
            examCooldownMinutes={examCooldownMinutes}
          />
        ) : shownFloor === 0 ? (
          <View className="gap-2 p-4" testID="hotel-empty">
            <Text className="font-ui-medium text-lg">Вестибюль</Text>
            <Text variant="caption">Этажи скоро появятся</Text>
          </View>
        ) : null}
      </Lift>

      {toast ? (
        <Pressable onPress={() => setToast(false)} accessibilityRole="button">
          <Text variant="caption">Сначала сдайте экзамен этажа</Text>
        </Pressable>
      ) : null}

      {nextAbove !== undefined && shownFloor === top ? (
        <Text variant="caption" testID="hotel-next-preview">
          {`Следующий: ${titleFor(nextAbove).ru}`}
        </Text>
      ) : null}
      {hotel.reveal13 && !hotel.gatePassed ? <Text variant="caption">Номер 13 ждёт</Text> : null}

      <ExternMenuSheet
        open={externMenuOpen}
        menu={menu}
        onClose={() => setExternMenuOpen(false)}
        onPick={(s) => {
          setExternMenuOpen(false);
          setExternTarget(s);
        }}
      />
      <ExternConfirmSheet
        target={externTarget}
        title={externTarget ? titleFor(externTarget.floor).ru : ''}
        onClose={() => setExternTarget(null)}
        onConfirm={(s) => {
          setExternTarget(null);
          router.push(`/hotel/${s.packId}/exam?mode=extern` as never);
        }}
      />
    </ScrollView>
  );
}

/** The экстерн menu (decision 3): every locked floor on the panel that owns an exam. */
function ExternMenuSheet({
  open,
  menu,
  onClose,
  onPick,
}: {
  open: boolean;
  menu: readonly FloorState[];
  onClose: () => void;
  onPick: (s: FloorState) => void;
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <View className="gap-3 rounded-t-2xl bg-surface p-5" testID="extern-menu">
          <Text className="font-ui-medium text-base">Сдать экстерном</Text>
          {menu.map((s) => (
            <Pressable
              key={s.packId}
              onPress={() => onPick(s)}
              accessibilityRole="button"
              testID={`extern-pick-${s.floor}`}
              className="rounded-xl border border-border px-4 py-3"
            >
              <Text className="font-ui-medium">{`Этаж ${s.floor}`}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

/** The confirm sheet (decision 3): «90 %, без подсказок, при неудаче — пауза 1 час». */
function ExternConfirmSheet({
  target,
  title,
  onClose,
  onConfirm,
}: {
  target: FloorState | null;
  title: string;
  onClose: () => void;
  onConfirm: (s: FloorState) => void;
}) {
  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <View className="gap-3 rounded-t-2xl bg-surface p-5" testID="extern-confirm">
          <Text className="font-ui-medium text-base">{`${EXTERN_CONFIRM.title} · ${title}`}</Text>
          <Text variant="caption">{EXTERN_CONFIRM.body}</Text>
          <Pressable
            onPress={() => target && onConfirm(target)}
            accessibilityRole="button"
            testID="extern-start"
            className="items-center rounded-xl bg-accent py-3.5"
          >
            <Text className="font-ui-medium text-bg">Начать</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            className="items-center rounded-xl border border-border py-3"
          >
            <Text className="font-ui-medium">Отмена</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
