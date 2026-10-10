import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { invalidateExams, useExams } from '@/db/hooks';
import { hasApiKey } from '@/features/ai/config';
import { useQuietStudy, useStudyAmbience } from '@/features/ambient-audio/activity';
import { useClipPlayer } from '@/features/scenario/debrief/use-clip-player';
import { useHubGates } from '@/features/scenario/hub-gates';
import { MicButton } from '@/features/scenario/stage/mic-button';
import { recordExamDrillFinished } from '@/features/motivation/service';
import { scheduleExamBundle } from '@/features/scenario/recordings/bundle-service';
import { useReduceMotion } from '@/store/motion-prefs';
import { trackTorfl } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

import { monologueWindows } from '../engine/exam-machine';
import { minutesRu } from '../minutes-ru';
import { recordingLine } from './timing-copy';
import type { TorflLevel } from '../level-profile';
import { formatClock, timerTone } from '../engine/rules';
import { pumpGradingQueue, useGradingQueue } from '../grading/queue';
import {
  gradeSpeakingOffline,
  offlineSpeakingPoints,
  responseShare,
  type OfflineSpeakingGrade,
} from '../grading/speaking';
import { initialAttemptState, type ExamGrading } from '../model';
import { WritingLookupSheet } from '../writing/lookup-sheet';
import { speakingDebriefEntries } from './debrief-model';
import { speakingGateMessage } from './gates';
import { EntryCard } from './speaking-debrief-screen';
import { drawTicket, monologueTickets, type MonologueTicket } from './tickets-model';
import { enqueueExamTranscode, useExamRecorder } from './use-exam-recorder';

const TIMER_TONE_CLASS = {
  normal: 'text-text',
  amber: 'text-track-warm',
  red: 'text-danger',
} as const;
const ANSWER_WARN_MS = 10_000;

type Phase =
  | { kind: 'deck' }
  | { kind: 'revealed'; ticket: MonologueTicket }
  | { kind: 'prep'; ticket: MonologueTicket; deadlineAt: number; attemptId: string }
  | { kind: 'answer'; ticket: MonologueTicket; deadlineAt: number; attemptId: string }
  | { kind: 'processing'; ticket: MonologueTicket; attemptId: string }
  | {
      kind: 'done';
      ticket: MonologueTicket;
      attemptId: string;
      responseId: string;
      grade: OfflineSpeakingGrade;
    };

/**
 * «Билеты» (T73, TORFL §10) — route `/torfl/tickets`: a face-down ticket
 * flips to reveal a random `speaking-monologue` topic from every installed
 * exam pack (weighted to the least practised), then the task-3 flow —
 * prep 8:00 with the questions, a notes field and lookup → the fixed 2:00
 * answer → offline score + the AI queue → the debrief card with the model
 * monologue. A `drill`-scope attempt per ticket (10 XP). `torfl_ticket_drawn`.
 */
export function TicketsScreen({ level = 'A1' }: { level?: TorflLevel }) {
  // T76: prep / answer windows = the ticket's own, else the level profile's defaults.
  const windows = React.useCallback(
    (item: { prepSec?: number; answerSec?: number }) => monologueWindows(level, item),
    [level],
  );
  const { tokens } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const exams = useExams({ level });
  const gates = useHubGates();
  const [phase, setPhase] = React.useState<Phase>({ kind: 'deck' });
  const phaseRef = React.useRef(phase);
  React.useEffect(() => {
    phaseRef.current = phase;
  });
  const [now, setNow] = React.useState(() => Date.now());
  const [notes, setNotes] = React.useState('');
  const [lookupOpen, setLookupOpen] = React.useState(false);
  const gradedVersion = useGradingQueue((s) => s.gradedVersion);
  const clips = useClipPlayer();
  useStudyAmbience(phase.kind !== 'answer', 'education');
  useQuietStudy(phase.kind === 'answer');

  // How often each ticket was answered (any scope) → the draw weights.
  const counts = useQuery({
    queryKey: ['torfl', 'ticket-counts', level, gradedVersion],
    queryFn: async () => {
      const attempts = await repos.exams.listAttempts({ status: 'finished', limit: 500, level });
      const map = new Map<string, number>();
      for (const a of attempts) {
        const d = await repos.exams.getAttempt(a.id);
        for (const r of d?.responses ?? []) {
          if (r.answer?.kind !== 'speaking-monologue') continue;
          const k = `${a.packId}:${a.examId}:${r.itemId}`;
          map.set(k, (map.get(k) ?? 0) + 1);
        }
      }
      return map;
    },
  });
  const tickets = React.useMemo(
    () => monologueTickets(exams.data ?? [], counts.data ?? new Map()),
    [exams.data, counts.data],
  );

  const response = useQuery({
    queryKey: [
      'torfl',
      'ticket-response',
      phase.kind === 'done' ? phase.responseId : '',
      gradedVersion,
    ],
    queryFn: () => repos.exams.getResponse((phase as Extract<Phase, { kind: 'done' }>).responseId),
    enabled: phase.kind === 'done',
  });

  // the flip
  const flip = useSharedValue(0);
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { rotateY: `${flip.value * 180}deg` }],
    opacity: flip.value < 0.5 ? 1 : 0,
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { rotateY: `${flip.value * 180 + 180}deg` }],
    opacity: flip.value < 0.5 ? 0 : 1,
  }));

  // The flip follows the phase: face-down on the deck, face-up once a ticket is revealed.
  const faceUp = phase.kind !== 'deck';
  React.useEffect(() => {
    flip.value = withTiming(faceUp ? 1 : 0, {
      duration: reduceMotion ? 0 : faceUp ? 650 : 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [faceUp, flip, reduceMotion]);

  const draw = React.useCallback(() => {
    const t = drawTicket(tickets);
    if (!t) return;
    trackTorfl('torfl_ticket_drawn', { topic: t.item.topic, level });
    setPhase({ kind: 'revealed', ticket: t });
  }, [tickets, level]);

  const recorder = useExamRecorder({
    onDone: (itemId, answer) => {
      void (async () => {
        const p = phaseRef.current;
        if (p.kind !== 'processing' && p.kind !== 'answer') return;
        if (p.ticket.item.id !== itemId) return;
        try {
          const exam = (exams.data ?? []).find(
            (e) => e.packId === p.ticket.packId && e.examId === p.ticket.examId,
          )?.exam;
          const subtest = exam?.subtests.find((s) => s.id === p.ticket.subtestId);
          if (!exam || !subtest) return;
          const grade = gradeSpeakingOffline(p.ticket.item, answer, { level })!;
          const share = responseShare(subtest, p.ticket.item);
          const online = await hasApiKey();
          const grading: ExamGrading = {
            v: 1,
            offline: { criteria: grade.criteria, details: { ...grade.details } },
          };
          const hasText =
            answer.transcript.trim().length > 0 ||
            (answer.assistTranscript ?? '').trim().length > 0;
          const row = await repos.exams.recordResponse({
            attemptId: p.attemptId,
            subtestId: subtest.id,
            itemId: p.ticket.item.id,
            answer,
            points: offlineSpeakingPoints(grade, share),
            maxPoints: share,
            gradingStatus: !hasText ? 'scored' : online ? 'pending-ai' : 'provisional',
            grading,
            durationMs: answer.durationMs,
          });
          if (answer.recordingPath?.endsWith('.wav')) {
            enqueueExamTranscode(p.attemptId, row.id, answer.recordingPath);
          }
          await repos.exams.finishAttempt(
            p.attemptId,
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
          trackTorfl('exam_speaking_scored', { task: 3, source: 'offline', pct: grade.pct, level });
          await recordExamDrillFinished().catch(() => 0);
          scheduleExamBundle(p.attemptId);
          void invalidateExams();
          setPhase({
            kind: 'done',
            ticket: p.ticket,
            attemptId: p.attemptId,
            responseId: row.id,
            grade,
          });
          if (online) void pumpGradingQueue();
        } catch (err) {
          logError('manual', err);
          Alert.alert('Не удалось сохранить ответ', 'Попробуй ещё раз.');
          setPhase({ kind: 'revealed', ticket: p.ticket });
        }
      })();
    },
  });

  const startPrep = React.useCallback(async () => {
    if (phase.kind !== 'revealed') return;
    const t = phase.ticket;
    try {
      const attempt = await repos.exams.startAttempt({
        packId: t.packId,
        examId: t.examId,
        scope: 'drill',
        subtestIds: [t.subtestId],
        mode: 'drill',
        state: initialAttemptState([{ id: t.subtestId, kind: 'speaking' }]),
      });
      setNotes('');
      setPhase({
        kind: 'prep',
        ticket: t,
        deadlineAt: Date.now() + windows(t.item).prepSec * 1000,
        attemptId: attempt.id,
      });
    } catch (err) {
      logError('manual', err);
    }
  }, [phase, windows]);

  const startAnswer = React.useCallback(async () => {
    const p = phaseRef.current;
    if (p.kind !== 'prep') return;
    const deadlineAt = Date.now() + windows(p.ticket.item).answerSec * 1000;
    setPhase({ kind: 'answer', ticket: p.ticket, deadlineAt, attemptId: p.attemptId });
    await recorder.start({
      itemId: p.ticket.item.id,
      task: 3,
      capMs: 0,
      fixedWindow: true,
      attemptId: p.attemptId,
    });
  }, [recorder, windows]);

  // the 1 s clock: prep deadline → answer; answer deadline → stop
  React.useEffect(() => {
    if (phase.kind !== 'prep' && phase.kind !== 'answer') return;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      const p = phaseRef.current;
      if (p.kind === 'prep' && at >= p.deadlineAt) void startAnswer();
      if (p.kind === 'answer' && at >= p.deadlineAt) {
        setPhase({ kind: 'processing', ticket: p.ticket, attemptId: p.attemptId });
        recorder.stop('manual');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase.kind, recorder, startAnswer]);

  React.useEffect(
    () => () => {
      const p = phaseRef.current;
      if ('attemptId' in p && p.kind !== 'done')
        void repos.exams.abandonAttempt(p.attemptId).catch(() => undefined);
    },
    [],
  );

  const gate = speakingGateMessage(gates);
  const sending = useGradingQueue.getState().sending;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 4 }} testID="torfl-tickets">
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
          <Text className="font-ui-medium">Билеты</Text>
          <Text variant="caption" className="text-xs">
            Задание 3 · монолог · {tickets.length} {tickets.length === 1 ? 'тема' : 'тем'}
          </Text>
        </View>
        {phase.kind === 'prep' || phase.kind === 'answer' ? (
          <Text
            className={`font-ui-bold text-lg tabular-nums ${
              phase.kind === 'answer' && phase.deadlineAt - now <= ANSWER_WARN_MS
                ? 'text-danger'
                : TIMER_TONE_CLASS[timerTone(phase.deadlineAt - now)]
            }`}
            testID="ticket-clock"
          >
            {formatClock(Math.max(0, phase.deadlineAt - now))}
          </Text>
        ) : null}
      </View>

      <ScrollView
        contentContainerClassName="gap-4 px-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {phase.kind === 'deck' || phase.kind === 'revealed' ? (
          <>
            <View className="items-center py-6">
              <View style={{ width: 280, height: 180 }}>
                <Animated.View
                  pointerEvents={faceUp ? 'none' : 'auto'}
                  style={[
                    { position: 'absolute', inset: 0, backfaceVisibility: 'hidden' },
                    frontStyle,
                  ]}
                >
                  <Pressable
                    onPress={draw}
                    disabled={tickets.length === 0 || phase.kind !== 'deck'}
                    accessibilityRole="button"
                    testID="ticket-draw"
                    className="flex-1 items-center justify-center gap-2 rounded-3xl border-2 border-accent bg-surface active:bg-surface-2"
                  >
                    <Ionicons name="albums-outline" size={36} color={tokens.accent} />
                    <Text className="font-reading-bold text-xl">Тянуть билет</Text>
                    <Text variant="caption">
                      {tickets.length === 0
                        ? 'Темы появятся вместе с экзаменами'
                        : 'Случайная тема монолога'}
                    </Text>
                  </Pressable>
                </Animated.View>
                <Animated.View
                  pointerEvents={faceUp ? 'auto' : 'none'}
                  style={[
                    { position: 'absolute', inset: 0, backfaceVisibility: 'hidden' },
                    backStyle,
                  ]}
                >
                  <View className="flex-1 justify-center gap-2 rounded-3xl border-2 border-accent bg-accent-soft px-5 py-4">
                    <Text variant="caption">Билет</Text>
                    <Text className="font-reading-bold text-2xl" testID="ticket-topic">
                      {phase.kind === 'revealed' ? phase.ticket.item.topicTitle.ru : ''}
                    </Text>
                    <Text variant="caption">
                      {phase.kind === 'revealed'
                        ? `${phase.ticket.item.questions.length} вопрос(ов) · ${phase.ticket.item.minSentences}–${phase.ticket.item.maxSentences} предложений`
                        : ''}
                    </Text>
                  </View>
                </Animated.View>
              </View>
            </View>
            {phase.kind === 'revealed' ? (
              <>
                {gate ? (
                  <View className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3">
                    <Text>{gate}</Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={() => void startPrep()}
                  disabled={!!gate}
                  accessibilityRole="button"
                  testID="ticket-start"
                  className={`items-center rounded-full px-5 py-3.5 ${gate ? 'bg-surface-2' : 'bg-accent active:opacity-80'}`}
                >
                  <Text className={`font-ui-bold ${gate ? 'text-text-muted' : 'text-bg'}`}>
                    Начать подготовку · {Math.round(windows(phase.ticket.item).prepSec / 60)} мин
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setPhase({ kind: 'deck' })}
                  accessibilityRole="button"
                  testID="ticket-redraw"
                  className="items-center py-2"
                >
                  <Text className="font-ui-medium text-text-muted">Вернуть в колоду</Text>
                </Pressable>
              </>
            ) : null}
          </>
        ) : phase.kind === 'prep' ? (
          <>
            <View className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4">
              <Text className="font-reading-bold text-2xl">{phase.ticket.item.topicTitle.ru}</Text>
              {phase.ticket.item.questions.map((q, i) => (
                <Text key={i} className="font-reading text-lg leading-7">
                  {i + 1}. {q.ru}
                </Text>
              ))}
              <Text variant="caption">
                {phase.ticket.item.minSentences}–{phase.ticket.item.maxSentences} предложений.
                Заметки не оцениваются.
              </Text>
            </View>
            <View className="flex-row items-center justify-between px-1">
              <Text variant="caption">Заметки</Text>
              <Pressable
                onPress={() => setLookupOpen(true)}
                accessibilityRole="button"
                className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1.5 active:bg-surface-2"
              >
                <Ionicons name="book-outline" size={14} color={tokens.accent} />
                <Text className="font-ui-medium text-sm text-accent">Словарь</Text>
              </Pressable>
            </View>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              textAlignVertical="top"
              placeholder="Ключевые слова, план ответа…"
              placeholderTextColor={tokens.textMuted}
              className="min-h-[140px] rounded-2xl border border-border bg-surface px-4 py-3 font-reading text-base leading-6 text-text"
            />
            <Pressable
              onPress={() =>
                Alert.alert(
                  'Начать ответ?',
                  `Запись пойдёт сразу: ${minutesRu(windows(phase.ticket.item).answerSec)}.`,
                  [
                    { text: 'Ещё подготовлюсь', style: 'cancel' },
                    { text: 'Готов', onPress: () => void startAnswer() },
                  ],
                )
              }
              accessibilityRole="button"
              testID="ticket-prep-done"
              className="items-center rounded-full bg-accent px-5 py-3.5 active:opacity-80"
            >
              <Text className="font-ui-bold text-bg">Готов — отвечать</Text>
            </Pressable>
            <WritingLookupSheet
              open={lookupOpen}
              initialQuery=""
              subtestKind="speaking"
              onClose={() => setLookupOpen(false)}
            />
          </>
        ) : phase.kind === 'answer' || phase.kind === 'processing' ? (
          <>
            <View className="gap-2 rounded-2xl border border-border bg-surface px-4 py-4">
              <Text className="font-reading-bold text-2xl">{phase.ticket.item.topicTitle.ru}</Text>
              {phase.ticket.item.questions.map((q, i) => (
                <Text key={i} variant="muted" className="font-reading leading-6">
                  {i + 1}. {q.ru}
                </Text>
              ))}
            </View>
            {notes.trim() ? (
              <View className="rounded-2xl border border-border bg-surface-2 px-4 py-3">
                <Text className="font-reading leading-6">{notes}</Text>
              </View>
            ) : null}
            <View className="items-center gap-3 py-4">
              <MicButton
                state={
                  phase.kind === 'answer' && recorder.phase === 'recording'
                    ? 'recording'
                    : 'processing'
                }
                level={recorder.level}
                holdPrimary={false}
                onTap={() => undefined}
                onHoldStart={() => undefined}
                onHoldEnd={() => undefined}
              />
              <Text variant="caption">
                {phase.kind === 'answer'
                  ? recordingLine(windows(phase.ticket.item).answerSec)
                  : 'Распознаю…'}
              </Text>
              {phase.kind === 'answer' ? (
                <Pressable
                  onPress={() => {
                    setPhase({
                      kind: 'processing',
                      ticket: phase.ticket,
                      attemptId: phase.attemptId,
                    });
                    recorder.stop('manual');
                  }}
                  accessibilityRole="button"
                  testID="ticket-finish"
                  className="rounded-full border border-border px-5 py-2 active:bg-surface-2"
                >
                  <Text className="font-ui-medium">Закончить</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : phase.kind === 'done' ? (
          (() => {
            const exam = (exams.data ?? []).find(
              (e) => e.packId === phase.ticket.packId && e.examId === phase.ticket.examId,
            )?.exam;
            const entry =
              exam && response.data
                ? (speakingDebriefEntries(exam, phase.ticket.subtestId, [response.data]).find(
                    (e) => e.item.id === phase.ticket.item.id,
                  ) ?? null)
                : null;
            return (
              <>
                {entry ? (
                  <EntryCard
                    packId={phase.ticket.packId}
                    attemptId={phase.attemptId}
                    entry={entry}
                    clips={clips}
                    inFlight={sending[phase.responseId] === true}
                    onRetry={undefined}
                    onPractice={() => setPhase({ kind: 'deck' })}
                    onModelStory={(storyId) => {
                      trackTorfl('torfl_text_opened', {
                        packId: phase.ticket.packId,
                        storyId,
                        from: 'review',
                        level,
                      });
                      router.push({
                        pathname: '/reader/[packId]/[storyId]',
                        params: { packId: phase.ticket.packId, storyId, from: 'torfl' },
                      });
                    }}
                  />
                ) : (
                  <ActivityIndicator color={tokens.accent} />
                )}
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={() => setPhase({ kind: 'deck' })}
                    accessibilityRole="button"
                    testID="ticket-again"
                    className="flex-1 items-center rounded-full border border-border px-5 py-3 active:bg-surface-2"
                  >
                    <Text className="font-ui-medium">Ещё билет</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    testID="ticket-done"
                    className="flex-1 items-center rounded-full bg-accent px-5 py-3 active:opacity-80"
                  >
                    <Text className="font-ui-bold text-bg">Готово</Text>
                  </Pressable>
                </View>
              </>
            );
          })()
        ) : null}
      </ScrollView>
    </View>
  );
}
