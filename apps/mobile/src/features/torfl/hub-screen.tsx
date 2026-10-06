import { Ionicons } from '@expo/vector-icons';
import type { ExamSubtestKind } from '@sumrak/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useExamAttempts, useExams } from '@/db/hooks';
import type { ExamAttempt } from '@/db/repositories/exams';
import { useStudyAmbience } from '@/features/ambient-audio/activity';
import { cn } from '@/lib/cn';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { ExamDateSheet } from './exam-date-sheet';
import { ExamRow } from './exam-row';
import { useExamDate, useExamListItems, useExamTexts } from './hooks';
import {
  MODE_LABELS,
  SPBU_RULE_LINE,
  buildTopicTiles,
  countdownLabel,
  overallPct,
  placeholderReadiness,
  ruPlural,
  type ReadinessView,
} from './hub-model';
import { ReadinessBars } from './readiness-bars';
import { TextRow } from './text-row';
import { SUBTEST_LABELS, SUBTEST_ORDER, topicLabel } from './topics';

export type HubOpenedFrom = 'library' | 'today' | 'deeplink';

const ITEMS = ['задание', 'задания', 'заданий'] as const;
/** «Тексты» preview length on the hub (the full list is `/torfl/texts`). */
const TEXTS_PREVIEW = 5;

/**
 * The «ТРКИ» hub (T69, TORFL_EXAM_PREP §5.3) — a calm study desk, top to
 * bottom: the header (title, countdown → date sheet, the SPbU rule),
 * «Готовность» (placeholders until T70), «Сегодня» (placeholder until T70),
 * «Пробные экзамены», «Тренировки» (a five-tab strip of topic tiles from
 * drill exams), «Тексты» (a five-row preview → the full browser),
 * «История» (attempts). Works with zero packs installed: every section
 * has an empty state saying what sync brings. `readiness` is T70's seam.
 */
export function TorflHubScreen({
  from,
  readiness,
}: {
  from: HubOpenedFrom;
  readiness?: readonly ReadinessView[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();
  useStudyAmbience(true, 'education');

  const exams = useExams();
  const mocks = useExamListItems('mock');
  const texts = useExamTexts();
  const attempts = useExamAttempts({ limit: 20 });
  const { date, today, setDate } = useExamDate();
  const [dateOpen, setDateOpen] = React.useState(false);
  const [tab, setTab] = React.useState<ExamSubtestKind>('lexgram');

  // Fresh data on every focus (an attempt finished in T70/T71 comes back here).
  useFocusEffect(
    React.useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['exams'] });
    }, [queryClient]),
  );
  const openedRef = React.useRef(false);
  React.useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    track('torfl_hub_opened', { from });
  }, [from]);

  const tiles = React.useMemo(() => buildTopicTiles(exams.data ?? []), [exams.data]);
  const titleOf = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const e of exams.data ?? []) map.set(`${e.packId}/${e.examId}`, e.titleRu);
    return map;
  }, [exams.data]);

  const openIntro = React.useCallback(
    (packId: string, examId: string) =>
      router.push({ pathname: '/exam/[packId]/[examId]', params: { packId, examId } }),
    [router],
  );

  if (exams.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  const nothingInstalled = (exams.data ?? []).length === 0;
  const tabTiles = tiles[tab];
  const preview = texts.groups.flatMap((g) => g.texts).slice(0, TEXTS_PREVIEW);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-7 px-4 pb-16 pt-4">
      {/* ---- header ---- */}
      <View className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4">
        <View className="flex-row items-center gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
            <Ionicons name="ribbon-outline" size={22} color={tokens.accent} />
          </View>
          <View className="flex-1">
            <Text className="font-ui-bold text-lg">ТРКИ-А1</Text>
            <Text variant="caption">Элементарный уровень · онлайн-экзамен СПбГУ</Text>
          </View>
        </View>
        <Pressable
          onPress={() => setDateOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${countdownLabel(date, today)}. Изменить дату экзамена`}
          testID="torfl-exam-date"
          className="flex-row items-center gap-2 self-start rounded-full border border-border px-3 py-1.5 active:bg-surface-2"
        >
          <Ionicons
            name="calendar-outline"
            size={15}
            color={date ? tokens.accent : tokens.textMuted}
          />
          <Text className={cn('font-ui-medium text-sm', date ? 'text-accent' : 'text-text-muted')}>
            {countdownLabel(date, today)}
          </Text>
        </Pressable>
        <Text variant="caption">{SPBU_RULE_LINE}</Text>
      </View>

      {nothingInstalled && (
        <View className="flex-row items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <Ionicons name="cloud-download-outline" size={18} color={tokens.textMuted} />
          <Text variant="muted" className="flex-1">
            Материалы ТРКИ появятся после синхронизации: пробные экзамены, тренировки по темам и
            тексты для чтения и аудирования.
          </Text>
        </View>
      )}

      {/* ---- readiness ---- */}
      <Section title="Готовность">
        <View className="rounded-xl border border-border bg-surface px-4 py-4">
          <ReadinessBars rows={readiness ?? placeholderReadiness()} />
        </View>
      </Section>

      {/* ---- today ---- */}
      <Section title="Сегодня">
        <View className="flex-row items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3">
          <Ionicons name="compass-outline" size={18} color={tokens.textMuted} />
          <Text variant="muted" className="flex-1">
            Здесь появится следующий шаг: самая слабая тема, карточки «Работы над ошибками» или
            пробный экзамен.
          </Text>
        </View>
      </Section>

      {/* ---- mocks ---- */}
      <Section title="Пробные экзамены">
        {mocks.items.length === 0 ? (
          <EmptyLine text="Пробных экзаменов пока нет — они придут с синхронизацией." />
        ) : (
          mocks.items.map((item) => (
            <ExamRow
              key={`${item.packId}/${item.examId}`}
              item={item}
              onPress={() => openIntro(item.packId, item.examId)}
            />
          ))
        )}
      </Section>

      {/* ---- drills ---- */}
      <Section title="Тренировки">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
          className="-mx-4 mb-3"
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {SUBTEST_ORDER.map((kind) => {
            const selected = kind === tab;
            const n = tiles[kind].length;
            return (
              <Pressable
                key={kind}
                onPress={() => setTab(kind)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                testID={`torfl-drill-tab-${kind}`}
                className={cn(
                  'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
                  selected ? 'border-accent bg-accent-soft' : 'border-border active:bg-surface-2',
                )}
              >
                <Ionicons
                  name={SUBTEST_LABELS[kind].icon}
                  size={14}
                  color={selected ? tokens.accent : tokens.textMuted}
                />
                <Text
                  className={cn(
                    'font-ui-medium text-sm',
                    selected ? 'text-accent' : 'text-text-muted',
                  )}
                >
                  {SUBTEST_LABELS[kind].short}
                  {n > 0 ? ` · ${n}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {tabTiles.length === 0 ? (
          <EmptyLine text={`Тренировок по разделу «${SUBTEST_LABELS[tab].ru}» пока нет.`} />
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {tabTiles.map((tile) => (
              <Pressable
                key={tile.topic}
                onPress={() => openIntro(tile.packId, tile.examId)}
                accessibilityRole="button"
                accessibilityLabel={`${topicLabel(tile.topic).ru}: ${tile.itemCount} ${ruPlural(tile.itemCount, ITEMS)}`}
                testID={`torfl-topic-${tile.topic}`}
                className="w-[48.5%] gap-1 rounded-xl border border-border bg-surface px-3 py-3 active:bg-surface-2"
              >
                <Text className="font-ui-medium" numberOfLines={2}>
                  {topicLabel(tile.topic).ru}
                </Text>
                <Text variant="caption" className="text-xs" numberOfLines={1}>
                  {topicLabel(tile.topic).en}
                </Text>
                <View className="mt-1 flex-row items-center justify-between">
                  <Text variant="caption">
                    {tile.itemCount} {ruPlural(tile.itemCount, ITEMS)}
                  </Text>
                  {/* T70 replaces this with the topic's accuracy */}
                  <Text variant="caption">—</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </Section>

      {/* ---- texts ---- */}
      <Section
        title="Тексты"
        action={
          texts.total > 0
            ? { label: `Все · ${texts.total}`, onPress: () => router.push('/torfl/texts') }
            : undefined
        }
      >
        {preview.length === 0 ? (
          <EmptyLine text="Тексты для чтения и аудирования появятся вместе с экзаменами." />
        ) : (
          preview.map((text) => (
            <TextRow key={`${text.packId}/${text.storyId}`} text={text} from="texts" />
          ))
        )}
      </Section>

      {/* ---- history ---- */}
      <Section title="История">
        {(attempts.data ?? []).length === 0 ? (
          <EmptyLine text="Попыток пока нет. Здесь будут пробные экзамены и тренировки." />
        ) : (
          (attempts.data ?? []).map((a) => (
            <AttemptRow key={a.id} attempt={a} title={titleOf.get(`${a.packId}/${a.examId}`)} />
          ))
        )}
      </Section>

      <ExamDateSheet
        key={dateOpen ? 'open' : 'closed'}
        open={dateOpen}
        current={date}
        today={today}
        onClose={() => setDateOpen(false)}
        onSave={(next) => {
          setDateOpen(false);
          void setDate(next);
        }}
      />
    </ScrollView>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  return (
    <View>
      <View className="mb-2.5 flex-row items-baseline justify-between px-1">
        <Text variant="caption" className="font-ui-medium uppercase tracking-wider">
          {title}
        </Text>
        {action && (
          <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button">
            <Text className="font-ui-medium text-sm text-accent">{action.label}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <Text variant="muted" className="px-1">
      {text}
    </Text>
  );
}

const STATUS_LABELS: Record<ExamAttempt['status'], string> = {
  active: 'идёт',
  finished: 'завершён',
  abandoned: 'прерван',
};

function AttemptRow({ attempt, title }: { attempt: ExamAttempt; title: string | undefined }) {
  const pct = overallPct(attempt.results);
  const when = new Date(attempt.startedAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
  return (
    <View className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <View className="flex-1 gap-0.5">
        <Text className="font-ui-medium" numberOfLines={1}>
          {title ?? attempt.examId}
        </Text>
        <Text variant="caption">
          {when} · {MODE_LABELS[attempt.mode]} · {STATUS_LABELS[attempt.status]}
        </Text>
      </View>
      <Text variant="caption">{pct === null ? '—' : `${pct.toLocaleString('ru-RU')} %`}</Text>
    </View>
  );
}
