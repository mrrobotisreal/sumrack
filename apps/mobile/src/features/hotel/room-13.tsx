import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ExamSubtestKind } from '@sumrak/schema';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { QueryError } from '@/components/query-error';
import { SUBTEST_LABELS } from '@/features/torfl/topics';
import { recordHotelGatePassed } from '@/features/motivation/service';
import { hotelProfileFor, isHotelLevel, type HotelLevel } from '@/features/torfl/hotel-profile';
import { levelFromParam, profileFor } from '@/features/torfl/level-profile';
import { useAppTheme } from '@/theme/use-app-theme';

import { trackHotel } from './hotel-analytics';
import {
  useCourseProgress,
  useHotelBuilding,
  useHotelFloors,
  useLastGateDetail,
} from './hotel-hooks';
import { gatePasses, markedFloors, passedFloorsOf, roomStatus } from './gate-model';

/**
 * Номер 13 (T92c D6): the dark room behind the brass «13» plate — one per
 * building (T116 H5). `?level=` names the building (the lift passes it); absent
 * = the persisted `hotel.building`. The exam text and «Войти» → the building's
 * gate mock intro. The last verdict with per-subtest bars; after a fail, the
 * 6 h cooldown and the debrief, whose floors (of THIS building) get glowing
 * markers on the lift until their floor exam is retaken. A pass shows «A1
 * пройден» / «A2 пройден».
 */
export default function Room13Screen() {
  const params = useLocalSearchParams<{ level?: string }>();
  const building = useHotelBuilding();
  const fromParam = params.level !== undefined ? levelFromParam(params.level) : null;
  const level: HotelLevel = fromParam && isHotelLevel(fromParam) ? fromParam : building.level;
  return <Room13 level={level} />;
}

function Room13({ level }: { level: HotelLevel }) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const profile = hotelProfileFor(level);
  const rule = profileFor(level);
  const { last, attempts, detail: gate } = useLastGateDetail(level);
  const progress = useCourseProgress();
  const floors = useHotelFloors(level);
  const [now] = React.useState(() => Date.now());

  const status = roomStatus({
    verdict: last?.verdict ?? null,
    lastFinishedAt: last?.finishedAt ?? null,
    now,
  });

  const results = React.useMemo(() => gate.data?.results ?? [], [gate.data]);
  const passed = results.length > 0 && gatePasses(results, level);
  const debrief = React.useMemo(() => {
    if (!gate.data || passed) return [];
    return gate.data.debrief;
  }, [gate.data, passed]);

  const passedFloors = React.useMemo(
    () => passedFloorsOf(progress.data ?? [], floors.data ?? []),
    [progress.data, floors.data],
  );
  const markers = markedFloors(debrief, passedFloors);

  // One analytics event per finished gate attempt, once it has been read (T92d: the engine's overall %).
  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!last || !gate.data || reported.current === last.id) return;
    reported.current = last.id;
    trackHotel('hotel_gate_attempt', {
      percent: gate.data.overall ?? 0,
      verdict: passed ? 'pass' : 'fail',
      level,
    });
    if (passed) void recordHotelGatePassed(level);
  }, [last, gate.data, passed, level]);

  if (attempts.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <Stack.Screen options={{ title: 'Номер 13' }} />
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (attempts.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <Stack.Screen options={{ title: 'Номер 13' }} />
        <QueryError onRetry={() => void attempts.refetch()} />
      </View>
    );
  }

  const open = () => router.push(`/exam/${profile.gatePackId}/${profile.gateExamId}` as never);
  const canEnter = status.kind !== 'cooling';

  return (
    <ScrollView
      className="flex-1 bg-bg"
      style={{ backgroundColor: tokens.hotelPlate }}
      contentContainerClassName="gap-5 px-5 py-8"
      testID="room-13"
    >
      <Stack.Screen options={{ title: 'Номер 13' }} />

      <View className="items-center gap-2">
        <View
          className="h-16 w-24 items-center justify-center rounded-md border-2"
          style={{ borderColor: tokens.hotelBrass, backgroundColor: tokens.hotelBrass }}
          testID="room-13-plate"
        >
          <Text className="font-ui-bold text-2xl" style={{ color: tokens.hotelPlate }}>
            13
          </Text>
        </View>
        <Text className="font-ui-medium text-base" style={{ color: tokens.hotelGlow }}>
          Номер 13
        </Text>
      </View>

      <View className="gap-2 rounded-2xl border border-border px-4 py-4">
        <Text className="font-ui-medium text-base">{profile.roomTitle}</Text>
        <Text variant="caption">{profile.roomDuration}</Text>
        <Text variant="caption">
          {`Правило СПбГУ: каждый субтест ≥ ${rule.passPct} %, один может быть ≥ ${rule.borderlinePct} %.`}
        </Text>
      </View>

      {results.length > 0 ? (
        <View className="gap-3" testID="room-13-last">
          <Text className="font-ui-medium text-base">Последняя попытка</Text>
          {results.map((r) => (
            <View key={r.kind} className="gap-1">
              <View className="flex-row justify-between">
                <Text variant="caption">{SUBTEST_LABELS[r.kind as ExamSubtestKind].ru}</Text>
                <Text variant="caption">{`${Math.round(r.percent)} %`}</Text>
              </View>
              <View className="h-2 overflow-hidden rounded-full bg-surface-2">
                <View
                  className="h-2 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(0, r.percent))}%`,
                    backgroundColor:
                      r.percent >= rule.passPct ? tokens.accent : tokens.hotelGlowDim,
                  }}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {status.kind === 'passed' ? (
        <View className="items-center gap-1" testID="room-13-passed">
          <Text className="font-ui-bold text-lg" style={{ color: tokens.hotelGlow }}>
            {profile.passedLabel}
          </Text>
        </View>
      ) : null}

      {status.kind === 'cooling' ? (
        <View className="gap-2" testID="room-13-cooldown">
          <Text className="font-ui-medium text-base">
            {`Можно снова через ${status.left.text}`}
          </Text>
          {debrief.length > 0 ? (
            <View className="gap-1" testID="room-13-debrief">
              <Text className="font-ui-medium">Повторите этажи:</Text>
              {debrief.map((d) => (
                <Text key={d.kind} variant="caption">
                  {`${SUBTEST_LABELS[d.kind as ExamSubtestKind]?.ru ?? d.kind}: ${d.floors.map((f) => `этаж ${f}`).join(', ') || '—'}`}
                </Text>
              ))}
              {markers.length > 0 ? (
                <Text variant="caption" style={{ color: tokens.hotelGlow }}>
                  {`Отмечены на лифте: ${markers.join(', ')}`}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={open}
        disabled={!canEnter}
        accessibilityRole="button"
        testID="room-13-enter"
        className={
          canEnter
            ? 'items-center rounded-xl bg-accent py-3.5'
            : 'items-center rounded-xl bg-surface-2 py-3.5'
        }
      >
        <Text className="font-ui-medium text-bg">{canEnter ? 'Войти' : 'Закрыто'}</Text>
      </Pressable>
    </ScrollView>
  );
}
