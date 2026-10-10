import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { WritingItem } from '@sumrak/schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text as RNText,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { invalidateExams, useExam } from '@/db/hooks';
import type { ExamResponse } from '@/db/repositories/exams';
import { hasApiKey } from '@/features/ai/config';
import { FeedbackView } from '@/features/ai/feedback-view';
import { useStudyAmbience } from '@/features/ambient-audio/activity';
import { recordExamDrillFinished } from '@/features/motivation/service';
import { trackTorfl } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

import { applySelfCheck } from '../grading/self-check';
import { torflLevelOf, type TorflLevel } from '../level-profile';
import { pumpGradingQueue, requestGrading, storyText, useGradingQueue } from '../grading/queue';
import {
  criterionLabel,
  gradeWritingOffline,
  offlineItemScore,
  type OfflineWritingGrade,
} from '../grading/writing';
import { findExamItem, initialAttemptState, type ExamGrading } from '../model';
import { SelfCheckSheet } from './self-check-sheet';
import { WritingEditor } from './writing-editor';
import { mergedCriteria } from './review-model';
import { writingTaskOf } from './writing-model';

type Phase =
  | { kind: 'editing' }
  | { kind: 'submitted'; attemptId: string; responseId: string; offline: OfflineWritingGrade };

/**
 * Writing practice (T72, TORFL §8.3) — route `/torfl/writing?packId&examId&
 * itemId`: the same editor UNTIMED with the bullets as a live checklist,
 * «Сдать» → an immediate offline grade + the AI grade through the queue (a
 * `drill`-scope attempt, finished at once, no verdict), then the model
 * letter one tap away and the AI feedback in the journal diff view. 10 XP
 * per finished practice letter (the drill rule).
 */
export function WritingPracticeScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useStudyAmbience(true, 'education');
  const { packId, examId, itemId } = useLocalSearchParams<{
    packId: string;
    examId: string;
    itemId: string;
  }>();
  const exam = useExam(packId, examId);
  const [phase, setPhase] = React.useState<Phase>({ kind: 'editing' });
  const [draft, setDraft] = React.useState('');
  const gradedVersion = useGradingQueue((s) => s.gradedVersion);

  const located = exam.data ? findExamItem(exam.data, itemId) : null;
  const item = located && located.item.kind === 'writing' ? (located.item as WritingItem) : null;

  const response = useQuery({
    queryKey: [
      'torfl',
      'practice-response',
      phase.kind === 'submitted' ? phase.responseId : '',
      gradedVersion,
    ],
    queryFn: () =>
      repos.exams.getResponse((phase as Extract<Phase, { kind: 'submitted' }>).responseId),
    enabled: phase.kind === 'submitted',
  });
  const model = useQuery({
    queryKey: ['torfl', 'model-letter', packId, item?.model?.storyId ?? ''],
    queryFn: () => storyText(packId, item!.model!.storyId, item!.model!.sentenceIds),
    enabled: !!item?.model,
  });

  const submit = React.useCallback(
    async (text: string) => {
      if (!exam.data || !item || !located) return;
      try {
        const subtest = located.subtest;
        const grade = gradeWritingOffline(item, text);
        const online = await hasApiKey();
        const attempt = await repos.exams.startAttempt({
          packId,
          examId,
          scope: 'drill',
          subtestIds: [subtest.id],
          mode: 'drill',
          state: initialAttemptState([{ id: subtest.id, kind: subtest.kind }]),
        });
        const grading: ExamGrading = {
          v: 1,
          offline: { criteria: grade.criteria, details: { ...grade.details } },
        };
        const row = await repos.exams.recordResponse({
          attemptId: attempt.id,
          subtestId: subtest.id,
          itemId: item.id,
          answer: { kind: 'writing', text },
          points: offlineItemScore(grade, subtest.maxPoints).points,
          maxPoints: subtest.maxPoints,
          gradingStatus: online ? 'pending-ai' : 'provisional',
          grading,
        });
        await repos.exams.finishAttempt(
          attempt.id,
          {
            [subtest.id]: {
              points: offlineItemScore(grade, subtest.maxPoints).points,
              maxPoints: subtest.maxPoints,
              pct: grade.pct,
              provisional: true,
              gradedBy: 'offline',
            },
          },
          null,
          0,
        );
        trackTorfl('exam_writing_scored', {
          source: 'offline',
          pct: grade.pct,
          sentences: grade.details.sentences,
          questions: grade.details.questions,
          pointsCovered: grade.details.pointsCovered,
          ...writingTaskOf(exam.data, subtest.id, item.id),
          level: torflLevelOf(exam.data.level),
        });
        const xp = await recordExamDrillFinished().catch(() => 0);
        void xp;
        void invalidateExams();
        setPhase({ kind: 'submitted', attemptId: attempt.id, responseId: row.id, offline: grade });
        if (online) void pumpGradingQueue();
      } catch (err) {
        logError('manual', err);
        Alert.alert('Не удалось сохранить письмо', 'Попробуй ещё раз.');
      }
    },
    [exam.data, item, located, packId, examId],
  );

  if (exam.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (!exam.data || !item || !located) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <QueryError message="Задание не найдено." onRetry={() => router.back()} />
      </View>
    );
  }

  if (phase.kind === 'editing') {
    return (
      <WritingEditor
        item={item}
        initialText={draft}
        mode="practice"
        lookup
        subtestKind="writing"
        onDraft={setDraft}
        onSubmit={(text) => {
          Alert.alert('Сдать письмо?', 'Оценка появится сразу; ИИ оценит, когда будет связь.', [
            { text: 'Вернуться', style: 'cancel' },
            { text: 'Сдать', onPress: () => void submit(text) },
          ]);
        }}
        onQuit={() => router.back()}
      />
    );
  }

  return (
    <PracticeResult
      item={item}
      offline={phase.offline}
      response={response.data ?? null}
      modelLetter={model.data ?? null}
      packId={packId}
      level={torflLevelOf(exam.data?.level)}
      meta={
        exam.data && response.data
          ? writingTaskOf(exam.data, response.data.subtestId, response.data.itemId)
          : { task: 0, topic: 'none' }
      }
      top={insets.top}
      bottom={insets.bottom}
      onAgain={() => {
        setDraft('');
        setPhase({ kind: 'editing' });
      }}
      onDone={() => router.back()}
      onRefetch={() => void response.refetch()}
    />
  );
}

function PracticeResult({
  item,
  offline,
  response,
  modelLetter,
  packId,
  level,
  meta,
  top,
  bottom,
  onAgain,
  onDone,
  onRefetch,
}: {
  item: WritingItem;
  offline: OfflineWritingGrade;
  response: ExamResponse | null;
  modelLetter: string | null;
  packId: string;
  /** T75 (THE LEVEL RULE): the exam's level for this result's analytics. */
  level: TorflLevel;
  /** T75: the writing item's task + topic for `exam_writing_scored` (self-check). */
  meta: { task: number; topic: string };
  top: number;
  bottom: number;
  onAgain: () => void;
  onDone: () => void;
  onRefetch: () => void;
}) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const [selfOpen, setSelfOpen] = React.useState(false);
  const sending = useGradingQueue((s) => s.sending);
  const status = response?.gradingStatus ?? 'provisional';
  const inFlight = response ? sending[response.id] === true : false;
  const waiting = status === 'pending-ai' && !inFlight;
  const letter = response?.answer?.kind === 'writing' ? response.answer.text : '';
  const ai = response?.grading?.ai;
  const pct =
    status === 'scored' && response?.points !== null && response
      ? Math.round((response.points / response.maxPoints) * 1000) / 10
      : status === 'self-graded' && response?.points !== null && response
        ? Math.round((response.points / response.maxPoints) * 1000) / 10
        : offline.pct;
  const criteria = response ? mergedCriteria(response) : [];

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: top + 4 }} testID="writing-practice-result">
      <View className="flex-row items-center gap-3 px-3 pb-2">
        <Pressable
          onPress={onDone}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="chevron-back" size={22} color={tokens.text} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-reading-bold text-xl">Письмо · тренировка</Text>
          <Text variant="caption" testID="practice-pct">
            {pct.toLocaleString('ru-RU')} %
            {status === 'scored'
              ? ' · оценка ИИ'
              : status === 'self-graded'
                ? ' · самопроверка'
                : ' · предварительно'}
          </Text>
        </View>
      </View>
      <ScrollView
        contentContainerClassName="gap-5 px-4"
        contentContainerStyle={{ paddingBottom: bottom + 40 }}
      >
        <View className="gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
          {inFlight ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color={tokens.accent} />
              <Text variant="muted">ИИ оценивает письмо…</Text>
            </View>
          ) : status === 'ai-failed' ? (
            <Text className="font-ui-medium text-danger">
              Оценка ИИ не удалась — предварительная осталась.
            </Text>
          ) : status === 'provisional' ? (
            <Text variant="muted">
              Пока только офлайн-критерии. ИИ оценит, когда будет связь и ключ.
            </Text>
          ) : null}
          <Text variant="caption">
            Пункты: {offline.details.pointsCovered} из {offline.details.pointsTotal} · предложений{' '}
            {offline.details.sentences} · вопросов {offline.details.questions}
            {offline.details.greeting ? ' · приветствие ✓' : ' · без приветствия'}
            {offline.details.signOff ? ' · прощание ✓' : ' · без прощания'}
          </Text>
          {(status === 'ai-failed' || status === 'provisional' || waiting) &&
            !inFlight &&
            response && (
              <View className="mt-1 flex-row flex-wrap gap-2">
                <Pressable
                  onPress={() => void requestGrading(response.id).then(onRefetch)}
                  accessibilityRole="button"
                  testID="practice-retry"
                  className="flex-row items-center gap-1.5 rounded-full bg-accent px-4 py-2 active:opacity-80"
                >
                  <Ionicons name="refresh" size={14} color={tokens.bg} />
                  <Text className="font-ui-medium text-sm text-bg">Повторить оценку</Text>
                </Pressable>
                <Pressable
                  onPress={() => setSelfOpen(true)}
                  accessibilityRole="button"
                  testID="practice-self-check"
                  className="flex-row items-center gap-1.5 rounded-full border border-accent px-4 py-2 active:bg-accent-soft"
                >
                  <Ionicons name="checkbox-outline" size={14} color={tokens.accent} />
                  <Text className="font-ui-medium text-sm text-accent">Самопроверка</Text>
                </Pressable>
              </View>
            )}
        </View>

        {criteria.length > 0 && (
          <View className="overflow-hidden rounded-2xl border border-border bg-surface">
            {criteria.map((c, i) => (
              <View
                key={c.id}
                className={`gap-0.5 px-4 py-2.5 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1 font-ui-medium text-sm">
                    {criterionLabel(c.id, item.topic).ru}
                  </Text>
                  <Text className={`font-ui-bold text-sm ${c.pending ? 'text-text-muted' : ''}`}>
                    {c.pending ? '—' : c.score.toLocaleString('ru-RU')} / {c.max}
                  </Text>
                </View>
                {c.comment ? <Text variant="caption">{c.comment}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {ai?.corrected ? (
          <FeedbackView
            feedback={{
              v: 1,
              sourceRu: letter,
              corrected: ai.corrected,
              changes: ai.changes ?? [],
              summary: ai.tips.length > 0 ? ai.tips.join(' ') : 'No tips.',
              model: ai.model ?? 'exam-grader',
              createdAt: ai.gradedAt ?? response?.updatedAt ?? 0,
            }}
          />
        ) : (
          <View className="rounded-2xl border border-border bg-surface px-4 py-4">
            <RNText
              style={{
                fontFamily: 'Literata_400Regular',
                fontSize: 17,
                lineHeight: 28,
                color: tokens.text,
              }}
            >
              {letter}
            </RNText>
          </View>
        )}

        {item.model && (
          <Pressable
            onPress={() => {
              trackTorfl('torfl_text_opened', {
                packId,
                storyId: item.model!.storyId,
                from: 'review',
                level,
              });
              router.push({
                pathname: '/reader/[packId]/[storyId]',
                params: { packId, storyId: item.model!.storyId, from: 'torfl' },
              });
            }}
            accessibilityRole="button"
            testID="practice-model-letter"
            className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 active:bg-surface-2"
          >
            <Ionicons name="reader-outline" size={18} color={tokens.accent} />
            <View className="flex-1">
              <Text className="font-ui-medium">Образец письма</Text>
              <Text variant="caption" numberOfLines={3}>
                {modelLetter ?? 'Открыть в читалке'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={tokens.textMuted} />
          </Pressable>
        )}

        <View className="flex-row gap-3">
          <Pressable
            onPress={onAgain}
            accessibilityRole="button"
            testID="practice-again"
            className="flex-1 items-center rounded-full border border-border px-5 py-3 active:bg-surface-2"
          >
            <Text className="font-ui-medium">Ещё раз</Text>
          </Pressable>
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            testID="practice-done"
            className="flex-1 items-center rounded-full bg-accent px-5 py-3 active:opacity-80"
          >
            <Text className="font-ui-bold text-bg">Готово</Text>
          </Pressable>
        </View>
      </ScrollView>

      {response && (
        <SelfCheckSheet
          open={selfOpen}
          letter={letter}
          modelLetter={modelLetter}
          onClose={() => setSelfOpen(false)}
          onSubmit={(answers) => {
            setSelfOpen(false);
            void applySelfCheck(response, answers, level, meta).then(onRefetch);
          }}
        />
      )}
    </View>
  );
}
