import { Stack, useRouter } from 'expo-router';
import type { ExamSubtestKind } from '@sumrak/schema';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { QueryError } from '@/components/query-error';
import { repos } from '@/db';
import { findExamItem } from '@/features/torfl/model';
import { SUBTEST_LABELS } from '@/features/torfl/topics';
import { recordHotelGatePassed } from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { useCourseProgress } from './hotel-hooks';
import {
  debriefForSubtests,
  gatePasses,
  GATE_PACK_ID,
  markedFloors,
  missedByKind,
  roomStatus,
  type GradedResponse,
  type SubtestResult,
} from './gate-model';

/** The gate mock's exam id inside `a1-torfl-mock-004` (the mock intro route). */
const GATE_EXAM_ID = 'a1-mock-04';

/** Floor number of a floor pack: the course pack id ends in its floor (`a1-hotel-f07` → 7). */
function floorOfPack(packId: string): number | null {
  const m = /-f(\d+)$/.exec(packId);
  return m ? Number(m[1]) : null;
}

/**
 * Номер 13 (T92c D6): the dark room behind the brass «13» plate. The exam text
 * and «Войти» → the mock intro. The last verdict with per-subtest bars; after a
 * fail, the 6 h cooldown and the debrief, whose floors get glowing markers on
 * the lift until their floor exam is retaken. A pass shows «A1 пройден».
 */
export default function Room13Screen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  // The gate pack's own attempts, filtered in SQL (not the shared 50-row history).
  const attempts = useQuery({
    queryKey: ['hotel', 'gate-attempts'],
    queryFn: () => repos.exams.listAttempts({ packId: GATE_PACK_ID, limit: 20 }),
  });
  const progress = useCourseProgress();
  const [now] = React.useState(() => Date.now());
  const [detail, setDetail] = React.useState<{
    results: SubtestResult[];
    responses: GradedResponse[];
  } | null>(null);

  const finished = (attempts.data ?? []).filter((a) => a.status === 'finished');
  const last = finished[0] ?? null;
  const status = roomStatus({
    verdict: last?.verdict ?? null,
    lastFinishedAt: last?.finishedAt ?? null,
    now,
  });

  // The last finished attempt's subtest results and graded responses (for the bars and the debrief).
  React.useEffect(() => {
    let cancelled = false;
    if (!last) return;
    void (async () => {
      const exam = await repos.exams.getExam(GATE_PACK_ID, last.examId);
      const full = await repos.exams.getAttempt(last.id);
      if (cancelled || !exam || !full) return;
      const results: SubtestResult[] = exam.subtests.flatMap((s) => {
        const r = (last.results ?? {})[s.id];
        return r ? [{ kind: s.kind, percent: r.pct }] : [];
      });
      const responses: GradedResponse[] = [];
      for (const resp of full.responses) {
        if (resp.points === null) continue;
        const located = findExamItem(exam, resp.itemId, resp.subtestId);
        if (!located) continue;
        responses.push({
          itemId: resp.itemId,
          subtestKind: located.subtest.kind,
          topic: located.item.topic,
          points: resp.points,
          maxPoints: resp.maxPoints,
        });
      }
      setDetail({ results, responses });
    })();
    return () => {
      cancelled = true;
    };
  }, [last]);

  const results = React.useMemo(() => detail?.results ?? [], [detail]);
  const passed = results.length > 0 && gatePasses(results);
  const debrief = React.useMemo(() => {
    if (!detail || passed || detail.results.length === 0) return [];
    return debriefForSubtests(detail.results, missedByKind(detail.responses));
  }, [detail, passed]);

  const passedFloors = React.useMemo(
    () =>
      new Set(
        (progress.data ?? [])
          .filter((r) => r.unitId === null && r.passedAt != null)
          .map((r) => floorOfPack(r.packId))
          .filter((n): n is number => n !== null),
      ),
    [progress.data],
  );
  const markers = markedFloors(debrief, passedFloors);

  // One analytics event per finished gate attempt, once it has been read.
  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!last || !detail || reported.current === last.id) return;
    reported.current = last.id;
    const pct =
      results.length > 0
        ? Math.round(results.reduce((n, r) => n + r.percent, 0) / results.length)
        : 0;
    track('hotel_gate_attempt', { percent: pct, verdict: passed ? 'pass' : 'fail' } as never);
    if (passed) void recordHotelGatePassed();
  }, [last, detail, results, passed]);

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

  const open = () => router.push(`/exam/${GATE_PACK_ID}/${GATE_EXAM_ID}` as never);
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
        <Text className="font-ui-medium text-base">Вариант 4 · полный экзамен ТРКИ-А1</Text>
        <Text variant="caption">~2,5 часа</Text>
        <Text variant="caption">Правило СПбГУ: каждый субтест ≥ 66 %, один может быть ≥ 60 %.</Text>
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
                    backgroundColor: r.percent >= 66 ? tokens.accent : tokens.hotelGlowDim,
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
            A1 пройден
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
