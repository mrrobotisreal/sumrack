import { Ionicons } from '@expo/vector-icons';
import type { Exam, ExamSubtest } from '@sumrak/schema';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { invalidateExams, useExam, useExamAttempt } from '@/db/hooks';
import { cn } from '@/lib/cn';
import { trackTorfl } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

import { torflLevelOf, type TorflLevel } from './level-profile';
import { examItemKey, type ExamAnswer } from './model';
import { outcomeCounts, reviewEntries, type ReviewEntry } from './results-model';
import { SUBTEST_LABELS, topicLabel } from './topics';

/**
 * The item review (T71, TORFL §8.2) — route `/exam/review/[attemptId]`,
 * available only after a mock is finished: per subtest every item with the
 * chosen vs the correct option, the author's `explain`, a link to the
 * passage / transcript story (`torfl_text_opened {from: 'review'}`) and
 * «В колоду» (every miss already entered the deck as Again at finish; this
 * adds the ones answered right). `exam_review_opened {scope}` once.
 */
export function ExamReviewScreen({ attemptId }: { attemptId: string }) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const attempt = useExamAttempt(attemptId);
  const exam = useExam(attempt.data?.packId, attempt.data?.examId);
  const [subtestId, setSubtestId] = React.useState<string | null>(null);

  const openedRef = React.useRef(false);
  const scope = attempt.data?.scope;
  const level = torflLevelOf(exam.data?.level);
  React.useEffect(() => {
    if (openedRef.current || !scope || !exam.data) return;
    openedRef.current = true;
    trackTorfl('exam_review_opened', { scope, level });
  }, [scope, exam.data, level]);

  const cards = useQuery({
    queryKey: ['exams', 'review-cards', attempt.data?.packId ?? '', attempt.data?.examId ?? ''],
    queryFn: async () => {
      const a = attempt.data!;
      const out = new Set<string>();
      const exm = exam.data;
      if (!exm) return out;
      for (const it of exm.subtests.flatMap((s) => s.parts.flatMap((p) => p.items))) {
        const key = examItemKey(a.packId, a.examId, it.id);
        if (await repos.exams.getCard(key)) out.add(key);
      }
      return out;
    },
    enabled: !!attempt.data && !!exam.data,
  });

  if (attempt.isPending || exam.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (!attempt.data || !exam.data || attempt.data.status === 'active') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <QueryError
          message={
            attempt.data?.status === 'active'
              ? 'Разбор откроется после сдачи.'
              : 'Разбор не найден.'
          }
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  const a = attempt.data;
  const e = exam.data;
  const scored = e.subtests.filter(
    (s) =>
      (s.kind === 'lexgram' || s.kind === 'reading' || s.kind === 'listening') &&
      (a.subtestIds ?? []).includes(s.id) &&
      a.results?.[s.id] !== undefined,
  );
  const active = scored.find((s) => s.id === subtestId) ?? scored[0];
  const answers: Record<string, ExamAnswer> = {};
  for (const r of a.responses) if (r.answer) answers[r.itemId] = r.answer;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 4 }} testID="exam-review">
      <View className="flex-row items-center gap-3 px-3 pb-2">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="chevron-back" size={22} color={tokens.text} />
        </Pressable>
        <Text className="flex-1 font-reading-bold text-xl">Разбор</Text>
      </View>
      {scored.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="max-h-12 grow-0"
          contentContainerClassName="gap-2 px-4"
        >
          {scored.map((s) => {
            const selected = s.id === active?.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSubtestId(s.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                testID={`review-tab-${s.kind}`}
                className={cn(
                  'rounded-full border px-3 py-1.5',
                  selected ? 'border-accent bg-accent-soft' : 'border-border',
                )}
              >
                <Text
                  className={cn(
                    'font-ui-medium text-sm',
                    selected ? 'text-accent' : 'text-text-muted',
                  )}
                >
                  {SUBTEST_LABELS[s.kind].short}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {active ? (
        <ReviewList
          packId={a.packId}
          examId={a.examId}
          exam={e}
          level={level}
          subtest={active}
          answers={answers}
          inDeck={cards.data ?? new Set<string>()}
          bottom={insets.bottom}
        />
      ) : (
        <View className="flex-1 items-center justify-center px-8">
          <Text variant="muted" className="text-center">
            В этой попытке нет заданий для разбора.
          </Text>
        </View>
      )}
    </View>
  );
}

function ReviewList({
  packId,
  examId,
  exam,
  level,
  subtest,
  answers,
  inDeck,
  bottom,
}: {
  packId: string;
  examId: string;
  exam: Exam;
  level: TorflLevel;
  subtest: ExamSubtest;
  answers: Record<string, ExamAnswer>;
  inDeck: ReadonlySet<string>;
  bottom: number;
}) {
  const entries = React.useMemo(() => reviewEntries(subtest, answers), [subtest, answers]);
  const counts = outcomeCounts(entries);
  const [added, setAdded] = React.useState<ReadonlySet<string>>(new Set());
  const addToDeck = async (entry: ReviewEntry, kind: string) => {
    try {
      await repos.exams.ensureCard({
        packId,
        examId,
        itemId: entry.item.id,
        subtestKind: kind,
        topic: entry.item.topic,
      });
      setAdded((s) => new Set(s).add(entry.item.id));
      void invalidateExams();
    } catch (err) {
      logError('manual', err);
    }
  };
  void exam;
  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-3 px-4 pt-3"
      contentContainerStyle={{ paddingBottom: bottom + 32 }}
    >
      <Text variant="caption" className="px-1" testID="review-counts">
        Верно {counts.full} · неверно {counts.wrong} · без ответа {counts.blank}
        {counts.half > 0 ? ` · почти ${counts.half}` : ''}
      </Text>
      {entries.map((entry) => (
        <ReviewCard
          key={entry.item.id}
          entry={entry}
          packId={packId}
          level={level}
          inDeck={
            inDeck.has(examItemKey(packId, examId, entry.item.id)) || added.has(entry.item.id)
          }
          onAdd={() => void addToDeck(entry, subtest.kind)}
        />
      ))}
    </ScrollView>
  );
}

function ReviewCard({
  entry,
  packId,
  level,
  inDeck,
  onAdd,
}: {
  entry: ReviewEntry;
  packId: string;
  level: TorflLevel;
  inDeck: boolean;
  onAdd: () => void;
}) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const ok = entry.outcome === 'full';
  const open = (storyId: string) => {
    trackTorfl('torfl_text_opened', { packId, storyId, from: 'review', level });
    router.push({
      pathname: '/reader/[packId]/[storyId]',
      params: { packId, storyId, from: 'torfl' },
    });
  };
  return (
    <View
      className={cn(
        'gap-2.5 rounded-2xl border px-4 py-4',
        ok ? 'border-success/50 bg-surface' : 'border-danger/50 bg-surface',
      )}
      testID={`review-item-${entry.item.id}`}
    >
      <View className="flex-row items-center gap-2">
        <Ionicons
          name={
            ok ? 'checkmark-circle' : entry.outcome === 'half' ? 'remove-circle' : 'close-circle'
          }
          size={20}
          color={ok ? tokens.success : entry.outcome === 'half' ? tokens.trackWarm : tokens.danger}
        />
        <Text className="font-ui-bold">Задание {entry.number}</Text>
        <Text variant="caption" className="flex-1" numberOfLines={1}>
          {topicLabel(entry.item.topic).ru}
        </Text>
        {entry.outcome === 'blank' ? <Text variant="caption">без ответа</Text> : null}
      </View>
      <Text className="font-reading text-lg leading-8">{entry.stem}</Text>
      {entry.options.map((o) => (
        <View
          key={o.letter}
          className={cn(
            'flex-row items-center gap-2 rounded-lg border px-3 py-2',
            o.correct
              ? 'border-success bg-success/15'
              : o.chosen
                ? 'border-danger bg-danger/15'
                : 'border-border',
          )}
          testID={`review-option-${entry.item.id}-${o.letter}`}
        >
          <Text className="w-5 font-ui-bold text-text-muted">{o.letter}</Text>
          <Text className="flex-1 font-reading text-base">{o.text}</Text>
          {o.chosen ? <Text variant="caption">твой ответ</Text> : null}
          {o.correct ? <Text variant="caption">верно</Text> : null}
        </View>
      ))}
      {entry.typed ? (
        <View className="gap-1">
          <Text>
            Твой ответ: <Text className="font-ui-bold">{entry.typed.given.trim() || '—'}</Text>
          </Text>
          <Text>
            Верно: <Text className="font-ui-bold">{entry.typed.accepted}</Text>
          </Text>
        </View>
      ) : null}
      {entry.explain ? (
        <Text variant="muted" className="leading-6" testID={`review-explain-${entry.item.id}`}>
          {entry.explain}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-2">
        {entry.passageStoryId ? (
          <LinkChip
            icon="reader-outline"
            label="Текст"
            onPress={() => open(entry.passageStoryId!)}
          />
        ) : null}
        {entry.audioStoryId ? (
          <LinkChip
            icon="document-text-outline"
            label="Транскрипт"
            onPress={() => open(entry.audioStoryId!)}
          />
        ) : null}
        <View className="flex-1" />
        {inDeck ? (
          <View className="flex-row items-center gap-1">
            <Ionicons name="albums" size={14} color={tokens.accent} />
            <Text className="text-xs text-accent">в колоде</Text>
          </View>
        ) : (
          <Pressable
            onPress={onAdd}
            accessibilityRole="button"
            testID={`review-deck-${entry.item.id}`}
            className="flex-row items-center gap-1.5 rounded-full border border-accent px-3 py-1.5 active:bg-accent-soft"
          >
            <Ionicons name="add" size={14} color={tokens.accent} />
            <Text className="font-ui-medium text-sm text-accent">В колоду</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function LinkChip({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1.5 active:bg-surface-2"
    >
      <Ionicons name={icon} size={14} color={tokens.textMuted} />
      <Text className="text-sm">{label}</Text>
    </Pressable>
  );
}
