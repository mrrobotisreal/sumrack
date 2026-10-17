import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import type { CourseItem, CourseUnit } from '@sumrak/schema';
import * as React from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { AttemptRecord } from '@/db/repositories/course';
import { canAttempt, drawItems } from '../hotel-model';
import { formatCooldownRu } from '../gate-model';
import { recordHotelRun } from '@/features/motivation/service';
import { ChoiceItemView } from '@/features/torfl/items/choice-item-view';
import { TypedItemView } from '@/features/torfl/items/typed-item-view';
import { ExplainSheet } from '@/features/ai/explain-sheet';
import type { ExplainTarget } from '@/features/ai/explain';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { courseDrillEntry, courseDrillItem } from '../course-drill';
import { cardForTopic, topicLabel } from '../lesson/lesson-model';
import { useCourseFloor, useCourseItems, useCourseProgress } from '../hotel-hooks';
import { FeedbackPanel } from './feedback-panel';
import { hotelRunXp } from './hotel-rewards';
import { ReviewList } from './review-list';
import { reviewRows } from './review-model';
import { TriggerItemView } from './trigger-item-view';
import { WritingItemView } from './skill-items-view';
import { CoursePassageAudio } from './course-passage-audio';
import {
  allowsExplainMore,
  allowsTranslation,
  examOutcome,
  isDeferredItem,
  showsFeedback,
  unitOutcome,
  verdictOf,
  type RunMode,
} from './runner-model';
import {
  answer,
  moveTo,
  percentOf,
  startRun,
  submit,
  unanswered,
  type RunnerState,
} from './runner-state';

/** The finished run as the result screen shows it. */
interface Finished {
  percent: number;
  passed: boolean;
  missed: string[];
  cooldownMinutes: number;
  weakestUnitId: string | null;
  /** The drawn items with their responses, for the exam review (decision 5). */
  review: {
    items: CourseItem[];
    responses: RunnerState['responses'];
    points: Record<string, number>;
  };
}

/**
 * One runner for three modes (T90 decisions 2–8). `unit` shows feedback after
 * every answer; `floor` and `extern` run under exam conditions and end on a
 * review. Writes go through `repos.course` only; this screen never writes SQL.
 */
export function RunnerScreen({
  packId,
  mode,
  unitId,
}: {
  packId: string;
  mode: RunMode;
  unitId?: string;
}) {
  const { tokens: theme } = useAppTheme();
  const router = useRouter();
  const floor = useCourseFloor(packId);
  const progress = useCourseProgress();
  const course = floor.data?.course ?? null;
  const unit: CourseUnit | null =
    unitId && course ? (course.units.find((u) => u.id === unitId) ?? null) : null;
  const pool = mode === 'unit' ? (unit?.exercises.pool ?? []) : (course?.floorExam?.pool ?? []);
  const size = mode === 'unit' ? (unit?.exercises.size ?? 0) : (course?.floorExam?.size ?? 0);
  const attemptUnit = mode === 'unit' ? (unitId ?? null) : null;
  const rowKey = mode === 'unit' && unitId ? `${packId}:${unitId}` : `${packId}:floor`;
  const row = progress.data?.find((p) => p.key === rowKey);

  const [state, setState] = React.useState<RunnerState | null>(null);
  const [attemptId, setAttemptId] = React.useState<string | null>(null);
  const [finished, setFinished] = React.useState<Finished | null>(null);
  const [translate, setTranslate] = React.useState(false);
  const [retryKey, setRetryKey] = React.useState(0);
  const [explainTarget, setExplainTarget] = React.useState<ExplainTarget | null>(null);

  // The cooldown is data: a floor/экстерн row with a live cooldown blocks the start (decision 2).
  // The clock ticks every 30 s while mounted, so the countdown follows the row (carried T90 #4).
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const gate = React.useMemo(
    () => (progress.isLoading ? null : canAttempt(row, mode, now)),
    [progress.isLoading, row, mode, now],
  );
  const blockedMinutes = gate && !gate.ok ? gate.minutesLeft : null;

  // Start: resume an open sitting, else draw a fresh one (never while blocked).
  React.useEffect(() => {
    if (!course || progress.isLoading || state !== null || finished !== null) return;
    if (blockedMinutes !== null) {
      track('hotel_cooldown_blocked', { kind: mode, minutesLeft: blockedMinutes });
      return;
    }
    let cancelled = false;
    void (async () => {
      const open = await repos.course.activeAttempt(packId, attemptUnit, mode);
      if (cancelled) return;
      if (open && open.itemIds.length > 0) {
        setAttemptId(open.id);
        setState({ ...startRun(mode, [], []), itemIds: open.itemIds, responses: open.responses });
        return;
      }
      const history = (await repos.course.listAttempts({ limit: 200 })).filter(
        (a) =>
          a.packId === packId &&
          a.unitId === attemptUnit &&
          a.kind === mode &&
          a.finishedAt !== null,
      );
      const drawn = fresh(pool, size, history);
      const started = await repos.course.startAttempt({
        packId,
        unitId: attemptUnit,
        kind: mode,
        itemIds: drawn,
      });
      if (cancelled) return;
      setAttemptId(started.id);
      setState(startRun(mode, [], drawn));
    })();
    return () => {
      cancelled = true;
    };
    // The draw runs once per sitting: `state` and `finished` gate the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    course,
    progress.isLoading,
    row,
    mode,
    packId,
    attemptUnit,
    pool,
    size,
    retryKey,
    blockedMinutes,
  ]);

  const itemIds = state?.itemIds ?? [];
  const items = useCourseItems(packId, itemIds);
  const loaded = React.useMemo<CourseItem[]>(() => items.data ?? [], [items.data]);
  const byId = React.useMemo(() => new Map(loaded.map((i) => [i.id, i])), [loaded]);
  const cursorId =
    state && state.itemIds.length > 0
      ? state.itemIds[Math.min(state.cursor, state.itemIds.length - 1)]
      : undefined;
  const item = cursorId ? byId.get(cursorId) : undefined;
  const response = item && state ? state.responses[item.id] : undefined;
  const feedbackOn = showsFeedback(mode);

  const onAnswer = (value: number | string) => {
    if (!state || !item || state.phase !== 'run') return;
    const next = answer(state, item, value);
    setState(next);
    if (attemptId) {
      void repos.course.saveResponses(attemptId, next.responses).catch(() => undefined);
    }
  };

  const finish = async () => {
    if (!state || !attemptId || !course) return;
    const { percent, points } = percentOf(state, loaded);
    const alreadyPassed = row?.passedAt != null;
    const drawn = state.itemIds;
    const result = await repos.course.recordAttempt({
      attemptId,
      packId,
      unitId: attemptUnit,
      kind: mode,
      percent,
      responses: state.responses,
      items: loaded,
    });
    const units = course.units.map((u) => ({ id: u.id, items: u.exercises.pool }));
    const exam =
      mode === 'unit' ? null : examOutcome({ kind: mode, percent, drawn, points, units });
    const firstPass =
      mode === 'unit'
        ? unitOutcome({ percent, drawn, points, alreadyPassed }).firstPass
        : result.passed && !alreadyPassed;
    await recordHotelRun(hotelRunXp({ kind: mode, passed: result.passed, firstPass }));
    track(
      mode === 'unit'
        ? 'hotel_unit_attempt'
        : mode === 'floor'
          ? 'hotel_floor_exam'
          : 'hotel_extern',
      {
        packId,
        unitId: unitId ?? '',
        percent,
        passed: result.passed,
        weakestUnitId: exam?.weakestUnitId ?? '',
      } as never,
    );
    setFinished({
      percent,
      passed: result.passed,
      missed: drawn.filter((id) => (points[id] ?? 0) < 1),
      cooldownMinutes: exam ? exam.cooldownMinutes : 0,
      weakestUnitId: exam?.weakestUnitId ?? null,
      review: { items: loaded, responses: state.responses, points },
    });
    setState(submit(state));
  };

  if (!course) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-6">
        <Text variant="muted">{floor.isLoading ? 'Загрузка…' : 'Этаж не найден.'}</Text>
      </View>
    );
  }

  if (blockedMinutes !== null) {
    return (
      <View
        className="flex-1 items-center justify-center gap-4 bg-bg px-6"
        testID="runner-cooldown"
      >
        <Stack.Screen options={{ title: 'Упражнения' }} />
        <Ionicons name="time-outline" size={36} color={theme.textMuted} />
        <Text className="font-ui-medium text-base">{`Можно снова через ${formatCooldownRu(blockedMinutes)}`}</Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="rounded-xl border border-border px-5 py-3"
        >
          <Text className="font-ui-medium">Назад</Text>
        </Pressable>
      </View>
    );
  }

  if (finished) {
    return (
      <ScrollView
        className="flex-1 bg-bg"
        contentContainerClassName="gap-4 px-4 py-6"
        testID="runner-result"
      >
        <Stack.Screen options={{ title: 'Результат' }} />
        <Text
          className="font-ui-bold text-3xl"
          testID="runner-percent"
        >{`${finished.percent}%`}</Text>
        <Text className="font-ui-medium text-base" testID="runner-verdict">
          {finished.passed
            ? mode === 'unit'
              ? 'Урок пройден ✓'
              : 'Этаж пройден'
            : 'Пока не сдано'}
        </Text>
        {mode !== 'unit' && !finished.passed ? (
          <Text
            variant="muted"
            testID="runner-cooldown-note"
          >{`Следующая попытка через ${formatCooldownRu(finished.cooldownMinutes)}`}</Text>
        ) : null}
        {finished.weakestUnitId ? (
          <Pressable
            onPress={() => router.push(`/hotel/${packId}/${finished.weakestUnitId}` as never)}
            accessibilityRole="button"
            testID="runner-weakest"
            className="items-center rounded-xl border border-border py-3.5"
          >
            <Text className="font-ui-medium">Повторить урок</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            setFinished(null);
            setState(null);
            setAttemptId(null);
            setRetryKey((k) => k + 1);
          }}
          accessibilityRole="button"
          testID="runner-retry"
          className="items-center rounded-xl bg-accent py-3.5"
        >
          <Text className="font-ui-medium text-bg">Повторить</Text>
        </Pressable>
        {mode !== 'unit' ? (
          <View className="gap-3">
            <Text className="font-ui-medium text-base">Разбор</Text>
            <ReviewList
              rows={reviewRows(
                finished.review.items,
                finished.review.responses,
                (id) => finished.review.points[id] ?? 0,
              )}
              onExplainMore={
                allowsExplainMore(mode, 'review')
                  ? (item, chosen) => {
                      const target = explainTargetFor(packId, item, chosen);
                      if (!target) return;
                      track('hotel_explain_more', {
                        context: 'item',
                        packId,
                        id: item.id,
                        model: 'grammar',
                      } as never);
                      setExplainTarget(target);
                    }
                  : undefined
              }
            />
          </View>
        ) : null}
        {mode === 'unit' && unitId ? (
          <Pressable
            onPress={() => router.replace(`/hotel/${packId}/${unitId}` as never)}
            accessibilityRole="button"
            testID="runner-reread"
            className="items-center rounded-xl border border-border py-3.5"
          >
            <Text className="font-ui-medium">Перечитать урок</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    );
  }

  const cursorNo = state ? Math.min(state.cursor + 1, Math.max(1, state.itemIds.length)) : 0;
  const drill = item ? courseDrillItem(item) : null;
  // Floor-14 items carry a passage or audio ref: they render it above the question (T92d).
  const hasRef =
    !!item && (item.kind === 'choice' || item.kind === 'typed') && !!(item.passage || item.audio);
  const passageEntry = item && hasRef ? courseDrillEntry(packId, item, 'lexgram') : null;
  const stateChoiceIndex = typeof response?.answer === 'number' ? response.answer : null;
  const stateText = typeof response?.answer === 'string' ? response.answer : '';

  return (
    <View className="flex-1 bg-bg" testID="runner-screen">
      <ExplainSheet target={explainTarget} onClose={() => setExplainTarget(null)} />
      <Stack.Screen options={{ title: unit?.title.ru ?? course.title.ru }} />
      <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
        <Text className="font-ui-medium text-sm text-text-muted">
          {state ? `${cursorNo} из ${state.itemIds.length}` : ''}
        </Text>
        {allowsTranslation(mode) ? (
          <Pressable
            onPress={() => setTranslate((t) => !t)}
            accessibilityRole="button"
            testID="runner-translate"
            className="rounded-lg px-3 py-1.5"
          >
            <Text className="font-ui-medium text-sm text-accent">
              {translate ? 'скрыть перевод' : 'перевод'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerClassName="gap-5 px-4 pb-10" testID="runner-items">
        {passageEntry ? (
          <CoursePassageAudio entry={passageEntry} mode={mode} answered={response !== undefined} />
        ) : null}
        {item && drill && drill.kind === 'choice' ? (
          <View className="gap-2">
            {translate && item.kind === 'choice' && item.stemEn ? (
              <Text variant="caption">{item.stemEn}</Text>
            ) : null}
            <ChoiceItemView
              key={item.id}
              item={drill}
              feedback={feedbackOn ? 'instant' : 'none'}
              initialIndex={stateChoiceIndex}
              onAnswer={onAnswer}
            />
          </View>
        ) : null}
        {item && item.kind === 'trigger' ? (
          <TriggerItemView
            key={item.id}
            item={{
              id: item.id,
              sentence: item.sentence,
              tokens: item.tokens,
              answer: item.answer,
            }}
            feedback={feedbackOn ? 'instant' : 'none'}
            initialIndex={stateChoiceIndex}
            onAnswer={onAnswer}
          />
        ) : null}
        {item && item.kind === 'writing' ? (
          <WritingItemView
            key={item.id}
            item={item}
            mode={mode}
            stored={response}
            onAnswer={(entry) => {
              if (!state || state.phase !== 'run') return;
              const next = { ...state, responses: { ...state.responses, [item.id]: entry } };
              setState(next);
              if (attemptId) {
                void repos.course.saveResponses(attemptId, next.responses).catch(() => undefined);
              }
            }}
          />
        ) : null}
        {item && drill && drill.kind === 'typed' ? (
          <TypedItemView
            key={item.id}
            item={drill}
            feedback={feedbackOn ? 'instant' : 'none'}
            initialText={stateText}
            onSubmit={onAnswer}
          />
        ) : null}

        {feedbackOn && item && response ? (
          <FeedbackPanel
            verdict={verdictOf(response.correct ? 1 : response.half ? 0.5 : 0)}
            chosenText={
              item.kind === 'choice' && typeof response.answer === 'number'
                ? item.options[response.answer]
                : undefined
            }
            correctSentence={correctSentenceOf(item)}
            explain={item.explain ?? ''}
            onExplainMore={
              allowsExplainMore(mode, 'run')
                ? () => {
                    const chosen =
                      item.kind === 'choice' && typeof response.answer === 'number'
                        ? item.options[response.answer]
                        : undefined;
                    const target = explainTargetFor(packId, item, chosen);
                    if (!target) return;
                    track('hotel_explain_more', {
                      context: 'item',
                      packId,
                      id: item.id,
                      model: 'grammar',
                    } as never);
                    setExplainTarget(target);
                  }
                : undefined
            }
            onOpenCard={
              unit
                ? () =>
                    router.replace(
                      `/hotel/${packId}/${unit.id}?card=${teachingCardIndex(unit, item) ?? 0}` as never,
                    )
                : undefined
            }
            onNext={() => state && setState(moveTo(state, state.cursor + 1))}
          />
        ) : null}
      </ScrollView>

      {!feedbackOn && state ? (
        <View className="flex-row items-center justify-between gap-3 border-t border-border px-4 py-3">
          <Pressable
            onPress={() => setState(moveTo(state, state.cursor - 1))}
            accessibilityRole="button"
            testID="runner-prev"
            className="rounded-xl border border-border px-4 py-2.5"
          >
            <Text className="font-ui-medium">←</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const left = unanswered(state).length;
              if (left === 0) void finish();
              else
                Alert.alert('Сдать?', `Без ответа: ${left}`, [
                  { text: 'Нет', style: 'cancel' },
                  { text: 'Сдать', onPress: () => void finish() },
                ]);
            }}
            accessibilityRole="button"
            testID="runner-submit"
            className="flex-1 items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="font-ui-medium text-bg">Сдать</Text>
          </Pressable>
          <Pressable
            onPress={() => setState(moveTo(state, state.cursor + 1))}
            accessibilityRole="button"
            testID="runner-next"
            className="rounded-xl border border-border px-4 py-2.5"
          >
            <Text className="font-ui-medium">→</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** A fresh draw for a new sitting: retries lead with last time's misses (D13), never identical to the last. */
function fresh(pool: readonly string[], size: number, history: readonly AttemptRecord[]): string[] {
  const last = history[0];
  const missed = last ? last.itemIds.filter((id) => last.responses[id]?.correct !== true) : [];
  const previous = last?.itemIds ?? [];
  return drawItems(pool, size, { missedLastTime: missed, previous, seed: Date.now() % 2147483647 });
}

function correctSentenceOf(item: CourseItem): string {
  if (item.kind === 'choice') return item.stem.replace('…', item.options[item.answer] ?? '');
  if (item.kind === 'trigger') return item.sentence;
  if (item.kind === 'typed' || item.kind === 'transform') return item.accept[0] ?? '';
  return '';
}

/** The lesson card that teaches this item's topic (decision 4): index into the unit's cards, null when none. */
function teachingCardIndex(unit: CourseUnit, item: CourseItem): number | null {
  return cardForTopic(unit.cards, topicLabel(item))?.cardIndex ?? null;
}

/**
 * «Объясни ещё ✦» target for an answered item (T90 decision 6). The caller only
 * offers it in unit feedback, never mid-exam. Offline is handled by the
 * sheet («Нужен интернет»), not by throwing here.
 */
function explainTargetFor(
  packId: string,
  item: CourseItem,
  chosen: string | undefined,
): ExplainTarget | null {
  if (isDeferredItem(item)) return null;
  let stem: string;
  let options: string[] | undefined;
  if (item.kind === 'choice') {
    stem = item.stem;
    options = item.options;
  } else if (item.kind === 'trigger') {
    stem = item.sentence;
    options = item.tokens;
  } else if (item.kind === 'typed' || item.kind === 'transform') {
    stem = item.prompt;
  } else {
    return null;
  }
  return {
    kind: 'course-item',
    id: `${packId}/${item.id}`,
    stem,
    options,
    chosen,
    correct: correctSentenceOf(item),
    explain: item.explain ?? '',
    topic: item.topic,
  };
}
