import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { SpeakingMonologueItem, SpeakingTurnItem } from '@sumrak/schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { invalidateExams, useExam } from '@/db/hooks';
import type { ExamResponse } from '@/db/repositories/exams';
import { hasApiKey } from '@/features/ai/config';
import { useQuietStudy, useStudyAmbience } from '@/features/ambient-audio/activity';
import { useClipPlayer } from '@/features/scenario/debrief/use-clip-player';
import { useHubGates } from '@/features/scenario/hub-gates';
import { MicButton } from '@/features/scenario/stage/mic-button';
import { recordExamDrillFinished } from '@/features/motivation/service';
import { scheduleExamBundle } from '@/features/scenario/recordings/bundle-service';
import { trackTorfl } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

import { fileExists } from '../drill/drill-item';
import { speakingCapMsFor } from '../engine/exam-machine';
import { torflLevelOf } from '../level-profile';
import { formatClock } from '../engine/rules';
import { pumpGradingQueue, useGradingQueue } from '../grading/queue';
import {
  TASK_LABEL,
  gradeSpeakingOffline,
  offlineSpeakingPoints,
  responseShare,
  speakingTaskOf,
  type OfflineSpeakingGrade,
} from '../grading/speaking';
import { loadRefAudio, type ExamAudio } from '../items/exam-audio';
import { useExamAudio } from '../items/use-exam-audio';
import { findExamItem, initialAttemptState, type ExamGrading } from '../model';
import { speakingDebriefEntries } from './debrief-model';
import { speakingGateMessage } from './gates';
import { EntryCard } from './speaking-debrief-screen';
import { useExamRecorder, enqueueExamTranscode } from './use-exam-recorder';
import { ticketHref } from './tickets-model';

type Phase =
  | { kind: 'ready' }
  | { kind: 'recording' }
  | { kind: 'processing' }
  | { kind: 'done'; attemptId: string; responseId: string; grade: OfflineSpeakingGrade };

/**
 * Speaking practice (T73, TORFL §8.4 practice) — route `/torfl/speak?packId&
 * examId&itemId`: ONE task-1 / task-2 item untimed — the examiner line
 * can be replayed, the mic opens on tap (the same endpointer + cap as the
 * mock), the answer is recorded / transcribed / scored offline at once
 * and shown with the model answer through the debrief card, then the AI
 * grade through the queue. A `drill`-scope attempt finished immediately
 * (10 XP, the drill rule). «Ещё раз» records a new attempt.
 *
 * Task 3 practice is «Билеты» (`/torfl/tickets`): the monologue needs the
 * prep / answer windows, which that screen runs.
 */
export function SpeakingPracticeScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { packId, examId, itemId } = useLocalSearchParams<{
    packId: string;
    examId: string;
    itemId: string;
  }>();
  const exam = useExam(packId, examId);
  const gates = useHubGates();
  const [phase, setPhase] = React.useState<Phase>({ kind: 'ready' });
  const phaseRef = React.useRef(phase);
  React.useEffect(() => {
    phaseRef.current = phase;
  });
  const gradedVersion = useGradingQueue((s) => s.gradedVersion);
  const clips = useClipPlayer();
  useStudyAmbience(phase.kind !== 'recording', 'education');
  useQuietStudy(phase.kind === 'recording');

  const located = exam.data ? findExamItem(exam.data, itemId) : null;
  const item =
    located &&
    (located.item.kind === 'speaking-reply' || located.item.kind === 'speaking-situation')
      ? (located.item as SpeakingTurnItem)
      : null;
  const task = item ? (speakingTaskOf(item) as 1 | 2) : 1;

  const promptAudio = useQuery({
    queryKey: ['torfl', 'prompt-audio', packId, item?.prompt.storyId ?? '', item?.id ?? ''],
    queryFn: (): Promise<ExamAudio | null> =>
      item ? loadRefAudio(repos.content, packId, item.prompt, fileExists) : Promise.resolve(null),
    enabled: !!item,
  });
  const prompt = useExamAudio(promptAudio.data ?? null);

  const response = useQuery({
    queryKey: [
      'torfl',
      'practice-response',
      phase.kind === 'done' ? phase.responseId : '',
      gradedVersion,
    ],
    queryFn: () => repos.exams.getResponse((phase as Extract<Phase, { kind: 'done' }>).responseId),
    enabled: phase.kind === 'done',
  });

  // The practice attempt is created when a recording finishes (one per answer).
  const attemptIdRef = React.useRef<string | null>(null);
  const recorder = useExamRecorder({
    onDone: (doneItemId, answer) => {
      void (async () => {
        if (!located || !item || doneItemId !== item.id) return;
        try {
          const attemptId = attemptIdRef.current;
          if (!attemptId) return;
          const subtest = located.subtest;
          const grade = gradeSpeakingOffline(item, answer, { level: exam.data?.level })!;
          const share = responseShare(subtest, item);
          const online = await hasApiKey();
          const grading: ExamGrading = {
            v: 1,
            offline: { criteria: grade.criteria, details: { ...grade.details } },
          };
          const hasText =
            answer.transcript.trim().length > 0 ||
            (answer.assistTranscript ?? '').trim().length > 0;
          const row = await repos.exams.recordResponse({
            attemptId,
            subtestId: subtest.id,
            itemId: item.id,
            answer,
            points: offlineSpeakingPoints(grade, share),
            maxPoints: share,
            gradingStatus: !hasText ? 'scored' : online ? 'pending-ai' : 'provisional',
            grading,
            durationMs: answer.durationMs,
          });
          if (answer.recordingPath && answer.recordingPath.endsWith('.wav')) {
            enqueueExamTranscode(attemptId, row.id, answer.recordingPath);
          }
          await repos.exams.finishAttempt(
            attemptId,
            {
              [subtest.id]: {
                points: offlineSpeakingPoints(grade, share),
                maxPoints: share,
                pct: grade.pct,
                provisional: true,
                gradedBy: 'offline',
              },
            },
            null,
            0,
          );
          trackTorfl('exam_speaking_scored', {
            task,
            source: 'offline',
            pct: grade.pct,
            level: torflLevelOf(exam.data?.level),
          });
          await recordExamDrillFinished().catch(() => 0);
          scheduleExamBundle(attemptId);
          void invalidateExams();
          setPhase({ kind: 'done', attemptId, responseId: row.id, grade });
          if (online) void pumpGradingQueue();
        } catch (err) {
          logError('manual', err);
          Alert.alert('Не удалось сохранить ответ', 'Попробуй ещё раз.');
          setPhase({ kind: 'ready' });
        }
      })();
    },
  });

  const startRecording = React.useCallback(async () => {
    if (!located || !item) return;
    try {
      prompt.stop();
      const attempt = await repos.exams.startAttempt({
        packId,
        examId,
        scope: 'drill',
        subtestIds: [located.subtest.id],
        mode: 'drill',
        state: initialAttemptState([{ id: located.subtest.id, kind: located.subtest.kind }]),
      });
      attemptIdRef.current = attempt.id;
      setPhase({ kind: 'recording' });
      await recorder.start({
        itemId: item.id,
        task,
        capMs: speakingCapMsFor(exam.data?.level, task),
        fixedWindow: false,
        attemptId: attempt.id,
        level: torflLevelOf(exam.data?.level),
      });
    } catch (err) {
      logError('manual', err);
      setPhase({ kind: 'ready' });
    }
  }, [located, item, packId, examId, recorder, task, prompt, exam.data]);

  React.useEffect(() => {
    if (recorder.phase === 'processing' && phaseRef.current.kind === 'recording') {
      setPhase({ kind: 'processing' });
    }
  }, [recorder.phase]);

  // Abandon an attempt left open by a quit mid-recording.
  React.useEffect(
    () => () => {
      const id = attemptIdRef.current;
      if (id && phaseRef.current.kind !== 'done')
        void repos.exams.abandonAttempt(id).catch(() => undefined);
    },
    [],
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
  const gate = speakingGateMessage(gates);
  const entry =
    phase.kind === 'done' && response.data
      ? (speakingDebriefEntries(exam.data, located.subtest.id, [response.data]).find(
          (e) => e.item.id === item.id,
        ) ?? null)
      : null;
  const sending = useGradingQueue.getState().sending;

  return (
    <View
      className="flex-1 bg-bg"
      style={{ paddingTop: insets.top + 4 }}
      testID="speaking-practice"
    >
      <View className="flex-row items-center gap-3 px-3 pb-2">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="arrow-back" size={22} color={tokens.textMuted} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-ui-medium" numberOfLines={1}>
            Говорение · тренировка
          </Text>
          <Text variant="caption" className="text-xs">
            {TASK_LABEL[task].ru} · без таймера
          </Text>
        </View>
      </View>
      <ScrollView
        contentContainerClassName="gap-4 px-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {phase.kind !== 'done' ? (
          <>
            <View className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4">
              <View className="flex-row items-center gap-3">
                <Pressable
                  onPress={() => (prompt.playing ? prompt.stop() : prompt.play(1))}
                  disabled={!promptAudio.data || phase.kind === 'recording'}
                  accessibilityRole="button"
                  accessibilityLabel="Play the examiner line"
                  testID="practice-play-prompt"
                  className="h-12 w-12 items-center justify-center rounded-full bg-accent-soft"
                >
                  <Ionicons
                    name={prompt.playing ? 'pause' : 'volume-high'}
                    size={22}
                    color={tokens.accent}
                  />
                </Pressable>
                <View className="flex-1">
                  <Text className="font-ui-medium">
                    {task === 1 ? 'Вопрос экзаменатора' : 'Ситуация'}
                  </Text>
                  <Text variant="caption">
                    Можно слушать сколько угодно
                    {promptAudio.data?.synthetic ? ' · синтез' : ''}
                  </Text>
                </View>
              </View>
              {item.kind === 'speaking-situation' && item.situation ? (
                <Text className="font-reading text-lg leading-8">{item.situation.ru}</Text>
              ) : promptAudio.data ? (
                <Text className="font-reading text-lg leading-8">
                  {promptAudio.data.transcript.map((s) => s.ru).join(' ')}
                </Text>
              ) : null}
            </View>
            {gate ? (
              <View className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3">
                <Text>{gate}</Text>
              </View>
            ) : null}
            <View className="items-center gap-3 py-4">
              <MicButton
                state={
                  gate
                    ? 'disabled'
                    : phase.kind === 'recording'
                      ? 'recording'
                      : phase.kind === 'processing'
                        ? 'processing'
                        : 'ready'
                }
                level={recorder.level}
                holdPrimary={false}
                onTap={() => {
                  if (phase.kind === 'recording') recorder.stop('manual');
                  else if (phase.kind === 'ready') void startRecording();
                }}
                onHoldStart={() => {
                  if (phase.kind === 'ready') void startRecording();
                }}
                onHoldEnd={() => {
                  if (phase.kind === 'recording') recorder.stop('hold');
                }}
              />
              <Text variant="caption" testID="practice-mic-hint">
                {phase.kind === 'recording'
                  ? `Говори · нажми, чтобы закончить · до ${formatClock(speakingCapMsFor(exam.data?.level, task))}`
                  : phase.kind === 'processing'
                    ? 'Распознаю…'
                    : 'Нажми и отвечай'}
              </Text>
            </View>
          </>
        ) : entry ? (
          <>
            <EntryCard
              packId={packId}
              attemptId={phase.attemptId}
              entry={entry}
              clips={clips}
              inFlight={sending[phase.responseId] === true}
              onRetry={undefined}
              onPractice={() => {
                setPhase({ kind: 'ready' });
                attemptIdRef.current = null;
              }}
              onModelStory={() => undefined}
            />
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => {
                  setPhase({ kind: 'ready' });
                  attemptIdRef.current = null;
                }}
                accessibilityRole="button"
                testID="practice-again"
                className="flex-1 items-center rounded-full border border-border px-5 py-3 active:bg-surface-2"
              >
                <Text className="font-ui-medium">Ещё раз</Text>
              </Pressable>
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                testID="practice-done"
                className="flex-1 items-center rounded-full bg-accent px-5 py-3 active:opacity-80"
              >
                <Text className="font-ui-bold text-bg">Готово</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <ActivityIndicator color={tokens.accent} />
        )}
      </ScrollView>
    </View>
  );
}

export type { SpeakingMonologueItem, ExamResponse };
export { ticketHref };
