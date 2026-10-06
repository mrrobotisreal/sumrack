import { Ionicons } from '@expo/vector-icons';
import type { Exam } from '@sumrak/schema';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useActiveExamAttempt, useExam } from '@/db/hooks';
import { useStudyAmbience } from '@/features/ambient-audio/activity';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  MODE_LABELS,
  examTopics,
  formatMinutes,
  introSubtestRows,
  mockRules,
  ruPlural,
} from './hub-model';
import { SUBTEST_LABELS, topicLabel } from './topics';

const ITEMS = ['задание', 'задания', 'заданий'] as const;

/** What «Начать» starts: the whole mock, one of its subtests, or a drill set. */
export type ExamStartScope =
  { scope: 'full' } | { scope: 'subtest'; subtestId: string } | { scope: 'drill' };

/**
 * The start seam (T69): T70 wires drills, T71 mocks. While a handler is
 * absent the button renders disabled with «скоро» — nothing else changes
 * when they land.
 */
export interface ExamStartHandlers {
  onStartDrill?: (exam: Exam, packId: string) => void;
  onStartMock?: (exam: Exam, packId: string, scope: ExamStartScope) => void;
  /** T71: continue the active attempt of this exam («Продолжить»). */
  onResumeMock?: (attemptId: string) => void;
  /** T71: abandon the active attempt and begin the chosen scope fresh («Начать заново»). */
  onRestartMock?: (exam: Exam, packId: string, scope: ExamStartScope) => void;
}

/**
 * The exam intro (T69, TORFL §8.2 first bullet): title, mode, the subtests
 * in order with time / items / points / dictionary; a mock offers the scope
 * choice («Весь экзамен · Σ» / one subtest) and the rules (no feedback,
 * timer, audio twice, the dictionary rule — decision 8); a drill lists its
 * topics. A resume banner shows when this exam has an active attempt (T71
 * wires the action).
 */
export function ExamIntroScreen({
  packId,
  examId,
  onStartDrill,
  onStartMock,
  onResumeMock,
  onRestartMock,
}: { packId: string; examId: string } & ExamStartHandlers) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  useStudyAmbience(true, 'education');
  const exam = useExam(packId, examId);
  const active = useActiveExamAttempt();
  const [scope, setScope] = React.useState<ExamStartScope>({ scope: 'full' });

  if (exam.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (!exam.data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-10">
        <Ionicons name="alert-circle-outline" size={36} color={tokens.textMuted} />
        <Text className="font-reading-bold text-xl">Экзамен не найден</Text>
        <Text variant="muted" className="text-center">
          Этот экзамен больше не установлен — возможно, его пакет удалён.
        </Text>
      </View>
    );
  }

  const data = exam.data;
  const mock = data.mode === 'mock';
  const rows = introSubtestRows(data);
  const totalMin = rows.reduce((n, r) => n + r.durationMin, 0);
  const resumable =
    active.data?.status === 'active' &&
    active.data.packId === packId &&
    active.data.examId === examId;
  const startHandler = mock ? onStartMock : onStartDrill;
  // A mock with an active attempt of THIS exam resumes through the banner; the Start button
  // stays for a different scope (it offers resume / restart in the route's conflict dialog).
  const start = () => {
    if (mock) onStartMock?.(data, packId, scope);
    else onStartDrill?.(data, packId);
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="gap-6 px-4 pb-32 pt-4">
        <View className="gap-2">
          <View
            className={cn(
              'self-start rounded-full px-2.5 py-0.5',
              mock ? 'bg-accent-soft' : 'bg-surface-2',
            )}
          >
            <Text
              className={cn('font-ui-medium text-xs', mock ? 'text-accent' : 'text-text-muted')}
            >
              {MODE_LABELS[data.mode]} · ТРКИ-{data.level}
            </Text>
          </View>
          <Text className="font-reading-bold text-2xl leading-9">{data.title.ru}</Text>
          <Text variant="muted" className="font-reading-italic">
            {data.title.en}
          </Text>
          {data.blurb ? <Text variant="caption">{data.blurb}</Text> : null}
        </View>

        {resumable && (
          <View
            testID="exam-resume-banner"
            className="gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3"
          >
            <View className="flex-row items-center gap-3">
              <Ionicons name="play-circle-outline" size={20} color={tokens.accent} />
              <Text className="flex-1">
                Есть незаконченная попытка. Таймер идёт по часам — продолжай с того же места.
              </Text>
            </View>
            {onResumeMock && active.data ? (
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => onResumeMock(active.data!.id)}
                  accessibilityRole="button"
                  testID="exam-resume"
                  className="flex-1 items-center rounded-full bg-accent py-2.5 active:opacity-80"
                >
                  <Text className="font-ui-bold text-bg">Продолжить</Text>
                </Pressable>
                {onRestartMock && (
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        'Начать заново?',
                        'Незаконченная попытка будет прервана; её ответы останутся в истории.',
                        [
                          { text: 'Отмена', style: 'cancel' },
                          {
                            text: 'Начать заново',
                            style: 'destructive',
                            onPress: () => onRestartMock(data, packId, scope),
                          },
                        ],
                      )
                    }
                    accessibilityRole="button"
                    testID="exam-restart"
                    className="flex-1 items-center rounded-full border border-border py-2.5 active:bg-surface-2"
                  >
                    <Text className="font-ui-medium">Начать заново</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
          </View>
        )}

        <View className="gap-2">
          <Text variant="caption" className="px-1 font-ui-medium uppercase tracking-wider">
            {mock ? 'Субтесты' : 'Состав'}
          </Text>
          <View className="overflow-hidden rounded-xl border border-border bg-surface">
            {rows.map((r, i) => (
              <View
                key={r.id}
                className={cn(
                  'flex-row items-center gap-3 px-4 py-3',
                  i > 0 && 'border-t border-border',
                )}
              >
                <Ionicons name={SUBTEST_LABELS[r.kind].icon} size={18} color={tokens.textMuted} />
                <View className="flex-1 gap-0.5">
                  <Text className="font-ui-medium">{r.titleRu}</Text>
                  <Text variant="caption">
                    {r.itemCount} {ruPlural(r.itemCount, ITEMS)} ·{' '}
                    {r.points === null ? 'оценка по критериям' : `${r.points} б.`}
                    {r.audioPlays ? ` · аудио ×${r.audioPlays}` : ''}
                  </Text>
                </View>
                <View className="items-end gap-0.5">
                  <Text className="font-ui-medium">{formatMinutes(r.durationMin)}</Text>
                  <View
                    className="flex-row items-center gap-1"
                    accessibilityLabel={r.dictionary ? 'Словарь можно' : 'Без словаря'}
                    accessible
                  >
                    <Ionicons
                      name={r.dictionary ? 'book-outline' : 'close-circle-outline'}
                      size={12}
                      color={tokens.textMuted}
                    />
                    <Text variant="caption" className="text-xs">
                      {r.dictionary ? 'словарь' : 'без словаря'}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

        {mock ? (
          <>
            <View className="gap-2">
              <Text variant="caption" className="px-1 font-ui-medium uppercase tracking-wider">
                Что сдаём
              </Text>
              <ScopeOption
                selected={scope.scope === 'full'}
                onPress={() => setScope({ scope: 'full' })}
                title={`Весь экзамен · ${formatMinutes(totalMin)}`}
                caption="Все субтесты по порядку СПбГУ, с перерывами между ними"
              />
              {rows.map((r) => (
                <ScopeOption
                  key={r.id}
                  selected={scope.scope === 'subtest' && scope.subtestId === r.id}
                  onPress={() => setScope({ scope: 'subtest', subtestId: r.id })}
                  title={`Один субтест: ${r.titleRu}`}
                  caption={formatMinutes(r.durationMin)}
                />
              ))}
            </View>
            <View className="gap-2">
              <Text variant="caption" className="px-1 font-ui-medium uppercase tracking-wider">
                Правила
              </Text>
              <View className="gap-2.5 rounded-xl border border-border bg-surface px-4 py-3.5">
                {mockRules(data).map((rule) => (
                  <View key={rule} className="flex-row gap-2.5">
                    <Text className="text-accent">•</Text>
                    <Text className="flex-1 text-sm leading-5">{rule}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : (
          <View className="gap-2">
            <Text variant="caption" className="px-1 font-ui-medium uppercase tracking-wider">
              Темы
            </Text>
            <View className="overflow-hidden rounded-xl border border-border bg-surface">
              {examTopics(data).map((t, i) => (
                <View
                  key={t.topic}
                  className={cn(
                    'flex-row items-center gap-3 px-4 py-3',
                    i > 0 && 'border-t border-border',
                  )}
                >
                  <View className="flex-1">
                    <Text className="font-ui-medium">{topicLabel(t.topic).ru}</Text>
                    <Text variant="caption">{topicLabel(t.topic).en}</Text>
                  </View>
                  <Text variant="caption">
                    {t.itemCount} {ruPlural(t.itemCount, ITEMS)}
                  </Text>
                </View>
              ))}
            </View>
            <Text variant="caption" className="px-1">
              Без таймера: после каждого ответа — проверка и объяснение; ошибки уходят в «Работу над
              ошибками».
            </Text>
          </View>
        )}
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 right-0 border-t border-border bg-bg px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <Pressable
          onPress={start}
          disabled={!startHandler}
          accessibilityRole="button"
          accessibilityState={{ disabled: !startHandler }}
          testID="exam-start"
          className={cn(
            'items-center rounded-full px-5 py-3.5',
            startHandler ? 'bg-accent active:opacity-80' : 'bg-surface-2',
          )}
        >
          <Text className={cn('font-ui-bold', startHandler ? 'text-bg' : 'text-text-muted')}>
            {mock ? 'Начать экзамен' : 'Начать тренировку'}
            {startHandler ? '' : ' · скоро'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ScopeOption({
  selected,
  onPress,
  title,
  caption,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  caption: string;
}) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={cn(
        'flex-row items-center gap-3 rounded-xl border px-4 py-3',
        selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface active:bg-surface-2',
      )}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={18}
        color={selected ? tokens.accent : tokens.textMuted}
      />
      <View className="flex-1 gap-0.5">
        <Text className="font-ui-medium">{title}</Text>
        <Text variant="caption">{caption}</Text>
      </View>
    </Pressable>
  );
}
