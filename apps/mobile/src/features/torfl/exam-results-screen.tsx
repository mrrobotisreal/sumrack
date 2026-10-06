import { Ionicons } from '@expo/vector-icons';
import type { Exam } from '@sumrak/schema';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { useExam, useExamAttempt } from '@/db/hooks';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { drillHref } from './drill/drill-model';
import { MODE_LABELS } from './hub-model';
import { BAND_BAR_CLASS, BAND_TEXT_CLASS, BORDERLINE_PCT, PASS_PCT, bandFor } from './readiness';
import {
  buildResultRows,
  formatUsed,
  missingVerdictLine,
  pctsFromRows,
  provisionalFromRows,
  topicBreakdown,
  type ResultRow,
} from './results-model';
import { SUBTEST_LABELS, topicLabel } from './topics';
import { verdict as computeVerdict, verdictHeadline } from './verdict';

/**
 * The mock results (T71, TORFL §8.2) — route `/exam/results/[attemptId]`: the
 * verdict card in SPbU terms (or «Вердикт — после …» while a subtest is
 * missing), the five subtest rows with 60 / 66 ticks, points / max, time used
 * and «пропущено» for skipped ones, the topic breakdown with «Тренировать»
 * links into T70's drill, and «Разбор» into the item review.
 */
export function ExamResultsScreen({ attemptId }: { attemptId: string }) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const attempt = useExamAttempt(attemptId);
  const exam = useExam(attempt.data?.packId, attempt.data?.examId);

  if (attempt.isPending || (attempt.data && exam.isPending)) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (!attempt.data || !exam.data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <QueryError message="Результат не найден." onRetry={() => router.back()} />
      </View>
    );
  }
  return (
    <ResultsBody
      attemptId={attemptId}
      exam={exam.data}
      attempt={attempt.data}
      bottom={insets.bottom}
    />
  );
}

function ResultsBody({
  attemptId,
  exam,
  attempt,
  bottom,
}: {
  attemptId: string;
  exam: Exam;
  attempt: NonNullable<ReturnType<typeof useExamAttempt>['data']>;
  bottom: number;
}) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const rows = buildResultRows(exam, attempt);
  const pcts = pctsFromRows(rows);
  const full = attempt.scope === 'full';
  const v = full ? computeVerdict(pcts, provisionalFromRows(rows)) : null;
  const scoredIds = rows.filter((r) => r.status === 'scored').map((r) => r.subtestId);
  const responses = attempt.responses;
  const answers = React.useMemo(() => {
    const out: Record<string, NonNullable<(typeof responses)[number]['answer']>> = {};
    for (const r of responses) if (r.answer) out[r.itemId] = r.answer;
    return out;
  }, [responses]);
  const topics = topicBreakdown(exam, scoredIds, answers);
  const weak = topics.filter((t) => t.accuracy < 1).slice(0, 6);
  const active = attempt.status === 'active';

  const when = new Date(attempt.finishedAt ?? attempt.startedAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="gap-6 px-4 pt-3"
      contentContainerStyle={{ paddingBottom: bottom + 40 }}
      testID="exam-results"
    >
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="chevron-back" size={22} color={tokens.text} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-reading-bold text-xl" numberOfLines={2}>
            {exam.title.ru}
          </Text>
          <Text variant="caption">
            {MODE_LABELS[attempt.mode]} · {when}
            {attempt.status === 'abandoned' ? ' · прервана' : ''}
          </Text>
        </View>
      </View>

      {full && v ? <VerdictCard v={v} xp={attempt.xpAwarded} /> : null}
      {!full ? (
        <View className="rounded-2xl border border-border bg-surface px-4 py-3">
          <Text variant="muted">
            Один субтест — вердикт СПбГУ считается по всем пяти, поэтому здесь только проценты.
          </Text>
          {attempt.xpAwarded > 0 ? (
            <Text className="mt-1 font-ui-medium text-accent">+{attempt.xpAwarded} XP</Text>
          ) : null}
        </View>
      ) : null}

      <View className="gap-3">
        <SectionTitle>Субтесты</SectionTitle>
        <View className="gap-4 rounded-2xl border border-border bg-surface px-4 py-4">
          {rows.map((r) => (
            <SubtestRow key={r.subtestId} row={r} />
          ))}
        </View>
        <Text variant="caption" className="px-1">
          Черточки на полосе — 60 % (один субтест может быть здесь) и 66 % (порог сдачи).
        </Text>
      </View>

      {weak.length > 0 && (
        <View className="gap-3">
          <SectionTitle>Слабые темы</SectionTitle>
          <View className="overflow-hidden rounded-2xl border border-border bg-surface">
            {weak.map((t, i) => (
              <View
                key={`${t.kind}-${t.topic}`}
                className={cn(
                  'flex-row items-center gap-3 px-4 py-3',
                  i > 0 && 'border-t border-border',
                )}
              >
                <View className="flex-1">
                  <Text className="font-ui-medium">{topicLabel(t.topic).ru}</Text>
                  <Text variant="caption">
                    {SUBTEST_LABELS[t.kind].short} · {t.correct} из {t.total} верно
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    router.push(
                      drillHref({
                        source: 'set',
                        packId: attempt.packId,
                        examId: attempt.examId,
                        topic: t.topic,
                      }),
                    );
                  }}
                  accessibilityRole="button"
                  testID={`train-${t.topic}`}
                  className="rounded-full border border-accent px-3 py-1.5 active:bg-accent-soft"
                >
                  <Text className="font-ui-medium text-sm text-accent">Тренировать</Text>
                </Pressable>
              </View>
            ))}
          </View>
          <Text variant="caption" className="px-1">
            «Тренировать» открывает задания этой темы из тренировочных наборов, если они
            установлены.
          </Text>
        </View>
      )}

      {!active && scoredIds.length > 0 && (
        <Pressable
          onPress={() =>
            router.push({ pathname: '/exam/review/[attemptId]', params: { attemptId } })
          }
          accessibilityRole="button"
          testID="results-review"
          className="flex-row items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 active:opacity-80"
        >
          <Ionicons name="list-outline" size={18} color={tokens.bg} />
          <Text className="font-ui-bold text-bg">Разбор заданий</Text>
        </Pressable>
      )}
      <Text variant="caption" className="px-1 text-center">
        Ошибки уже в «Работе над ошибками» — повторяй их в хабе ТРКИ.
      </Text>
    </ScrollView>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="caption" className="px-1 font-ui-medium uppercase tracking-wider">
      {children}
    </Text>
  );
}

function VerdictCard({ v, xp }: { v: ReturnType<typeof computeVerdict>; xp: number }) {
  const { tokens } = useAppTheme();
  if (v.verdict === null) {
    return (
      <View
        className="gap-2 rounded-2xl border border-border bg-surface px-5 py-5"
        testID="verdict-card"
      >
        <View className="flex-row items-center gap-2">
          <Ionicons name="hourglass-outline" size={20} color={tokens.textMuted} />
          <Text className="font-ui-bold text-lg" testID="verdict-pending">
            {missingVerdictLine(v.missing)}
          </Text>
        </View>
        <Text variant="muted">
          СПбГУ выдаёт вердикт по всем пяти субтестам. Проценты по трём уже готовы — ниже.
        </Text>
        {xp > 0 ? <Text className="font-ui-medium text-accent">+{xp} XP</Text> : null}
      </View>
    );
  }
  const pass = v.verdict !== 'fail';
  return (
    <View
      className={cn(
        'gap-2 rounded-2xl border px-5 py-5',
        pass ? 'border-success bg-success/10' : 'border-danger bg-danger/10',
      )}
      testID="verdict-card"
    >
      <View className="flex-row items-center gap-2">
        <Ionicons
          name={pass ? 'ribbon' : 'refresh-circle'}
          size={22}
          color={pass ? tokens.success : tokens.danger}
        />
        <Text className="flex-1 font-ui-bold text-lg" testID="verdict-headline">
          {verdictHeadline(v.verdict, v.retake)}
        </Text>
      </View>
      {v.verdict === 'fail' && v.retake.length > 0 ? (
        <Text testID="verdict-retake">
          Пересдать: {v.retake.map((k) => SUBTEST_LABELS[k].ru).join(', ')}
        </Text>
      ) : null}
      {v.provisional ? (
        <View className="self-start rounded-full bg-track-warm-soft px-2.5 py-0.5">
          <Text className="font-ui-medium text-xs text-track-warm">
            предварительно — ждёт оценки ИИ
          </Text>
        </View>
      ) : null}
      {xp > 0 ? <Text className="font-ui-medium text-accent">+{xp} XP</Text> : null}
    </View>
  );
}

function SubtestRow({ row }: { row: ResultRow }) {
  const band = row.pct !== null ? bandFor(row.pct) : null;
  const used = formatUsed(row.timeUsedSec);
  return (
    <View className="gap-1.5" testID={`result-${row.kind}`}>
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-ui-medium" numberOfLines={1}>
          {row.titleRu}
        </Text>
        {row.status === 'scored' && row.pct !== null ? (
          <Text className={cn('font-ui-bold', band && BAND_TEXT_CLASS[band])}>
            {row.pct.toLocaleString('ru-RU')} %
          </Text>
        ) : (
          <Text variant="caption" testID={`result-${row.kind}-skipped`}>
            {row.status === 'skipped' ? 'пропущено · скоро' : 'не сдано'}
          </Text>
        )}
      </View>
      <Bar pct={row.pct} band={band} />
      <View className="flex-row items-center justify-between">
        <Text variant="caption" className="text-xs">
          {row.status === 'scored' && row.points !== null
            ? `${Math.round(row.points * 10) / 10} из ${row.maxPoints} б.`
            : `${row.maxPoints} б.`}
          {row.provisional ? ' · предварительно' : ''}
        </Text>
        <Text variant="caption" className="text-xs">
          {used}
          {row.autoSubmitted ? ' · сдано по таймеру' : ''}
        </Text>
      </View>
    </View>
  );
}

function Bar({ pct, band }: { pct: number | null; band: ReturnType<typeof bandFor> | null }) {
  return (
    <View className="h-2 overflow-hidden rounded-full bg-surface-2">
      {pct !== null && (
        <View
          className={cn(
            'absolute bottom-0 left-0 top-0 rounded-full',
            band ? BAND_BAR_CLASS[band] : 'bg-text-muted',
          )}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      )}
      {[BORDERLINE_PCT, PASS_PCT].map((t) => (
        <View
          key={t}
          className="absolute bottom-0 top-0 w-px bg-text-muted"
          style={{ left: `${t}%` }}
        />
      ))}
    </View>
  );
}
