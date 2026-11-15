import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { QueryError } from '@/components/query-error';
import {
  HOTEL_LADDER,
  hotelProfileFor,
  isHotelLevel,
  type HotelLevel,
} from '@/features/torfl/hotel-profile';
import { levelFromParam } from '@/features/torfl/level-profile';
import { useReduceMotion } from '@/store/motion-prefs';
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
import { cooldownLeft, gatePasses, markedFloors, passedFloorsOf } from './gate-model';
import { trackHotel } from './hotel-analytics';
import {
  floorInputOf,
  useHotelBuilding,
  useHotelFloors,
  useCourseProgress,
  useHotelState,
  useInstalledBuildings,
  useLastFloor,
  useLessonOpened,
  useLastGateDetail,
  usePracticeRows,
} from './hotel-hooks';
import { Lift } from './lift/lift';
import { FloorLobby } from './floor-lobby';
import type { PracticeRow } from './practice-rows';

/** How long the indicator shows the building («А2») with the doors shut (H2). */
const SWITCH_HOLD_MS = 900;

/**
 * T92: the Путь tab IS the hotel (decision 1). The ladder header and the lift;
 * the open doors show the current floor's lobby. The lift never rides to a
 * locked floor (▲ dark), and «13» appears only once the gate is revealed.
 *
 * T116 (HOTEL_PATH_A2 H2): the hotel has buildings. The header's ladder row is
 * the building switch — a building with ≥ 1 installed floor is lit and
 * selectable, the rest dim («Корпус ещё строится»). Switching closes the
 * doors, the indicator shows the level, and the doors open on that building's
 * last floor. The choice persists (`hotel.building`); `hotel.lastFloor` is per
 * building. `?level=A2&floor=N` (a deep link) opens a building / floor and is
 * saved.
 */
export function HotelScreen() {
  const params = useLocalSearchParams<{ floor?: string; level?: string }>();
  const building = useHotelBuilding();
  const installedBuildings = useInstalledBuildings();
  const { tokens } = useAppTheme();
  const reduced = useReduceMotion();
  const [switching, setSwitching] = React.useState<string | null>(null);
  const [buildingToast, setBuildingToast] = React.useState(false);
  // A manual switch ends the deep link's say over the floor.
  const [deepDone, setDeepDone] = React.useState(false);
  const switchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (switchTimer.current) clearTimeout(switchTimer.current);
    },
    [],
  );

  // The deep link's building is applied (and saved) once.
  const deepLevel = params.level !== undefined ? levelFromParam(params.level) : null;
  const appliedDeep = React.useRef(false);
  React.useEffect(() => {
    if (appliedDeep.current || !building.loaded || deepLevel === null) return;
    appliedDeep.current = true;
    if (!isHotelLevel(deepLevel) || deepLevel === building.level) return;
    trackHotel('hotel_building_switched', {
      from: building.level,
      to: deepLevel,
      via: 'deeplink',
      level: deepLevel,
    });
    void building.save(deepLevel);
  }, [deepLevel, building]);

  const pickBuilding = (to: HotelLevel) => {
    if (to === building.level || switching !== null) return;
    trackHotel('hotel_building_switched', { from: building.level, to, via: 'ladder', level: to });
    setDeepDone(true);
    // Doors close → the indicator shows the level → the doors open on the new building.
    setSwitching(hotelProfileFor(to).shortLabel);
    switchTimer.current = setTimeout(
      () => {
        void building.save(to);
        setSwitching(null);
      },
      reduced ? SWITCH_HOLD_MS / 2 : SWITCH_HOLD_MS,
    );
  };

  if (!building.loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  const lit = new Set<string>(installedBuildings.data ?? []);
  lit.add(building.level);
  // `?floor=` belongs to the deep link's building (`?level=`, else the saved one), once.
  const deepFloorHere =
    !deepDone &&
    params.floor !== undefined &&
    (deepLevel === null || !isHotelLevel(deepLevel) || deepLevel === building.level)
      ? parseLastFloor(Number(params.floor))
      : null;
  return (
    <BuildingView
      key={building.level}
      level={building.level}
      deepFloor={deepFloorHere}
      switching={switching}
      header={
        <BuildingHeader
          level={building.level}
          lit={lit}
          onPick={pickBuilding}
          onDim={() => setBuildingToast(true)}
          toast={buildingToast}
          onToastDismiss={() => setBuildingToast(false)}
        />
      }
    />
  );
}

/**
 * The header (H2): «ТРКИ-А2 · Отель «Сумрак»» and the ladder row
 * `A1 ● — A2 ● — B1 ○ — B2 ○ — C1 ○`, every rung a button. A lit rung is a
 * building with floors; a dim rung answers «Корпус ещё строится».
 */
function BuildingHeader({
  level,
  lit,
  onPick,
  onDim,
  toast,
  onToastDismiss,
}: {
  level: HotelLevel;
  lit: ReadonlySet<string>;
  onPick: (level: HotelLevel) => void;
  onDim: () => void;
  toast: boolean;
  onToastDismiss: () => void;
}) {
  React.useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onToastDismiss, 2_000);
    return () => clearTimeout(id);
  }, [toast, onToastDismiss]);
  return (
    <View className="gap-1">
      <Text variant="caption" className="uppercase tracking-wider">
        {`${hotelProfileFor(level).chipLabel} · Отель «Сумрак»`}
      </Text>
      <View className="flex-row flex-wrap items-center" testID="hotel-ladder">
        {HOTEL_LADDER.map((rung, i) => {
          const on = lit.has(rung);
          const current = rung === level;
          return (
            <React.Fragment key={rung}>
              {i > 0 ? (
                <Text variant="caption" className="text-text-muted">
                  {' — '}
                </Text>
              ) : null}
              <Pressable
                onPress={() => (on && isHotelLevel(rung) ? onPick(rung) : onDim())}
                accessibilityRole="button"
                accessibilityState={{ selected: current, disabled: !on }}
                accessibilityLabel={on ? `Корпус ${rung}` : `Корпус ${rung} ещё строится`}
                hitSlop={8}
                testID={`hotel-ladder-${rung}`}
                className="py-1"
              >
                <Text
                  variant="caption"
                  className={
                    current ? 'font-ui-medium text-accent' : on ? 'text-text' : 'text-text-muted'
                  }
                >
                  {`${rung} ${on ? '●' : '○'}`}
                </Text>
              </Pressable>
            </React.Fragment>
          );
        })}
      </View>
      {toast ? (
        <Pressable onPress={onToastDismiss} accessibilityRole="alert" testID="hotel-ladder-toast">
          <Text variant="caption">Корпус ещё строится</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One building's lift and lobby (remounted per building, so every local state starts fresh). */
function BuildingView({
  level,
  deepFloor,
  switching,
  header,
}: {
  level: HotelLevel;
  deepFloor: number | null;
  switching: string | null;
  header: React.ReactNode;
}) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const floors = useHotelFloors(level);
  const progress = useCourseProgress();
  const hotel = useHotelState(level);
  const lastFloor = useLastFloor(level);
  const lessonOpened = useLessonOpened();
  const gate = useLastGateDetail(level);
  // The lift's floor: null until the saved/deep-linked start is known, then user-driven.
  const [picked, setFloor] = React.useState<number | null>(null);
  const [toast, setToast] = React.useState(false);
  const [externMenuOpen, setExternMenuOpen] = React.useState(false);
  const [externTarget, setExternTarget] = React.useState<FloorState | null>(null);

  const states = hotel.states;
  const installedPanel = panelFor((floors.data ?? []).map(floorInputOf), level).map((f) => f.floor);
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
    trackHotel('hotel_floor_entered', { floor, via: 'lift', level });
  }, [floor, level]);

  // Debrief markers (T92d): the last Номер 13 debrief's floors, minus the ones already passed.
  const gateResults = gate.detail.data?.results ?? [];
  const gateFailed = gateResults.length > 0 && !gatePasses(gateResults, level);
  // H6c: the passed set is this building's floors only (an A1 pass never clears an A2 marker).
  const passedFloors = passedFloorsOf(progress.data ?? [], floors.data ?? []);
  const markers = gateFailed ? markedFloors(gate.detail.data?.debrief ?? [], passedFloors) : [];

  const shownFloor = floor ?? 0;
  const state = states.find((s) => s.floor === shownFloor);
  const practiceRef =
    (floors.data ?? []).find((f) => f.packId === state?.packId)?.course.practice ?? [];
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
    const packId = states.find((s) => s.floor === n)?.packId;
    const f = (floors.data ?? []).find((x) => x.packId === packId);
    return { ru: f?.title.ru ?? `Этаж ${n}`, en: f?.title.en ?? `Floor ${n}` };
  };

  const nextAbove = panel.find((n) => n > top);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-4 px-4 py-6">
      {header}

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
        onRide13={() => router.push(`/hotel/room-13?level=${level}` as never)}
        markers={markers}
        level={level}
        switching={switching}
      >
        {/* Through the open doors: just the floor's plate. The lobby itself sits below the lift as a normal
            scrolling panel — inside the clipped door opening it was cut off and the frame art swallowed taps. */}
        <View className="flex-1 items-center justify-center gap-1 p-4" testID="hotel-doorway">
          <Text className="font-ui-medium text-lg text-center">{titleFor(shownFloor).ru}</Text>
          <Text variant="caption" className="text-center">
            {state ? `Этаж ${shownFloor}` : shownFloor === 0 ? 'Этажи скоро появятся' : ''}
          </Text>
        </View>
      </Lift>

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
