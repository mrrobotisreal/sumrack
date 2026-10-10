import { Ionicons } from '@expo/vector-icons';
import type {
  ExamItem,
  ExamSubtest,
  SpeakingMonologueItem,
  SpeakingTurnItem,
} from '@sumrak/schema';
import * as React from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { MicButton, type MicVisualState } from '@/features/scenario/stage/mic-button';
import { cn } from '@/lib/cn';
import { trackTorfl } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { fileExists } from '../drill/drill-item';
import { monologueWindows, type ExamRunState } from '../engine/exam-machine';
import { formatClock, timerTone } from '../engine/rules';
import { TASK_LABEL, speakingTaskOf } from '../grading/speaking';
import { loadRefAudio, type ExamAudio } from '../items/exam-audio';
import { useExamAudio } from '../items/use-exam-audio';
import type { ExamSpeakingState } from '../model';
import type { TorflLevel } from '../level-profile';
import { WritingLookupSheet } from '../writing/lookup-sheet';
import {
  chooseLine,
  recordingLine,
  sentencesLine,
  startAnswerLine,
  task3Fact,
} from './timing-copy';
import type { ExamRecorder } from './use-exam-recorder';

const TIMER_TONE_CLASS = {
  normal: 'text-text',
  amber: 'text-track-warm',
  red: 'text-danger',
} as const;

/** The 10 s warning before a task-3 answer window closes (§8.4). */
const ANSWER_WARN_MS = 10_000;

/**
 * The Говорение mock runner (T73, TORFL §8.4) — the `running` phase of a
 * speaking subtest, rendered from `state.speaking`:
 *
 * - **task 1 / 2** — the part instruction, the examiner line plays ONCE on
 *   entry (task 2 also shows the situation text), the mic opens when it
 *   ends (the recorder hook drives the level ring; tap = stop early, the
 *   endpointer / cap stop it otherwise), «Пропустить».
 * - **task 3** — `choose`: two topic cards; `prep`: the chosen topic's
 *   questions, a notes field (local only — never graded, never persisted),
 *   lookup (decision 8) and the 8:00 clock, «Готов» ends prep early;
 *   `answer`: the fixed 2:00 window with the mic ring, a 10 s warning,
 *   «Закончить».
 * - the top bar shows the subtest timer; the part / window clock sits in
 *   the body (both wall-clock, from the engine).
 *
 * No correctness, no transcript, no retries, no lifelines (decision 4).
 */
export function ExamSpeakingScreen({
  packId,
  attemptId,
  level = 'A1',
  subtest,
  run,
  remainingMs,
  windowMs,
  recorder,
  lookup,
  onAudioEnded,
  onChoose,
  onPrepDone,
  onSkip,
  onStopEarly,
  onQuit,
}: {
  packId: string;
  attemptId: string;
  /** T75 (THE LEVEL RULE): the exam's level for `exam_lookup_used`. */
  level?: TorflLevel;
  subtest: ExamSubtest;
  run: Pick<ExamRunState, 'speaking'>;
  remainingMs: number;
  /** The current window / part clock (engine `speakingWindowMs`). */
  windowMs: number;
  recorder: ExamRecorder;
  /** The dictionary rule for task-3 prep. */
  lookup: boolean;
  onAudioEnded: () => void;
  onChoose: (itemId: string) => void;
  onPrepDone: () => void;
  onSkip: () => void;
  /** The candidate ended a recording by hand (tap / «Закончить»). */
  onStopEarly: () => void;
  onQuit: () => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const sp = run.speaking;
  const tone = timerTone(remainingMs);
  void attemptId;

  if (!sp) return null;
  const part = subtest.parts[sp.partIdx ?? 0];
  const items = part?.items ?? [];
  const item = sp.itemId ? (items.find((i) => i.id === sp.itemId) ?? null) : null;
  const total = subtest.parts.reduce((n, p) => n + p.items.length, 0);
  const position = (() => {
    let n = 0;
    for (const p of subtest.parts) {
      for (const i of p.items) {
        n += 1;
        if (i.id === sp.itemId) return n;
      }
    }
    return n;
  })();

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 4 }} testID="exam-speaking">
      {/* top bar */}
      <View className="flex-row items-center gap-2 px-3 pb-2">
        <Pressable
          onPress={onQuit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Выйти из экзамена"
          testID="speaking-quit"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="close" size={22} color={tokens.textMuted} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-ui-medium" numberOfLines={1}>
            Говорение · {TASK_LABEL[sp.task as 1 | 2 | 3].ru}
          </Text>
          <Text variant="caption" className="text-xs">
            {sp.itemId ? `Задание ${position} из ${total}` : 'Выбор темы'}
          </Text>
        </View>
        <Text
          className={cn('font-ui-bold text-lg tabular-nums', TIMER_TONE_CLASS[tone])}
          testID="exam-timer"
          accessibilityLabel={`Осталось ${formatClock(remainingMs)}`}
        >
          {formatClock(remainingMs)}
        </Text>
      </View>

      {sp.task === 3 ? (
        <MonologueBody
          packId={packId}
          level={level}
          sp={sp}
          items={items}
          item={item && item.kind === 'speaking-monologue' ? item : null}
          windowMs={windowMs}
          recorder={recorder}
          lookup={lookup}
          onChoose={onChoose}
          onPrepDone={onPrepDone}
          onSkip={onSkip}
          onStopEarly={onStopEarly}
          bottom={insets.bottom}
        />
      ) : item && (item.kind === 'speaking-reply' || item.kind === 'speaking-situation') ? (
        <TurnBody
          key={item.id}
          packId={packId}
          part={part!}
          item={item}
          sp={sp}
          windowMs={windowMs}
          recorder={recorder}
          onAudioEnded={onAudioEnded}
          onSkip={onSkip}
          onStopEarly={onStopEarly}
          bottom={insets.bottom}
        />
      ) : null}
    </View>
  );
}

// --- tasks 1–2 --------------------------------------------------------------------------------

function TurnBody({
  packId,
  part,
  item,
  sp,
  windowMs,
  recorder,
  onAudioEnded,
  onSkip,
  onStopEarly,
  bottom,
}: {
  packId: string;
  part: ExamSubtest['parts'][number];
  item: SpeakingTurnItem;
  sp: ExamSpeakingState;
  windowMs: number;
  recorder: ExamRecorder;
  onAudioEnded: () => void;
  onSkip: () => void;
  onStopEarly: () => void;
  bottom: number;
}) {
  const { tokens } = useAppTheme();
  const [audio, setAudio] = React.useState<ExamAudio | null | undefined>(undefined);

  // The examiner's line / the situation: one story ref → audio span (TTS fallback is allowed here —
  // the examiner's voice is not a listening test; the «синтез» badge says so).
  React.useEffect(() => {
    let cancelled = false;
    void loadRefAudio(repos.content, packId, item.prompt, fileExists)
      .then((a) => {
        if (!cancelled) setAudio(a);
      })
      .catch(() => {
        if (!cancelled) setAudio(null);
      });
    return () => {
      cancelled = true;
    };
    // keyed on the item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId, item.id]);

  const endedRef = React.useRef(false);
  const onEnded = React.useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    onAudioEnded();
  }, [onAudioEnded]);
  const controls = useExamAudio(audio ?? null, { onEnded });

  // Play once on entry (the tester says it once). A missing story → no audio → the mic opens at once.
  const playedRef = React.useRef(false);
  React.useEffect(() => {
    if (sp.phase !== 'prompt' || playedRef.current) return;
    if (audio === undefined) return;
    playedRef.current = true;
    if (audio === null) {
      onEnded();
      return;
    }
    const t = setTimeout(() => controls.play(1), 400);
    return () => clearTimeout(t);
    // once per item once the audio resolved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, sp.phase]);

  // Entering `prompt` after a RESUME replays (the prompt is allowed to play again after a kill —
  // the candidate never heard its end).
  const recording = sp.phase === 'recording' && recorder.phase === 'recording';
  const processing = sp.phase === 'processing' || recorder.phase === 'processing';
  const micState: MicVisualState = recording
    ? 'recording'
    : processing
      ? 'processing'
      : sp.phase === 'recording'
        ? 'ready'
        : 'disabled';
  const windowTone = timerTone(windowMs + 240_000); // the part clock: amber under 1:00 only

  return (
    <>
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-6 pt-2">
        <Text variant="caption" className="px-1" testID="part-instructions">
          {part.instructions.ru}
        </Text>
        <View
          className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4"
          testID="speaking-prompt"
        >
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
              <Ionicons
                name={controls.playing ? 'volume-high' : 'person-outline'}
                size={22}
                color={tokens.accent}
              />
            </View>
            <View className="flex-1">
              <Text className="font-ui-medium">
                {sp.phase === 'prompt'
                  ? controls.playing
                    ? 'Экзаменатор говорит…'
                    : 'Слушай экзаменатора'
                  : recording
                    ? 'Говори'
                    : processing
                      ? 'Записываю ответ…'
                      : 'Ответ'}
              </Text>
              <Text variant="caption">
                {item.kind === 'speaking-reply'
                  ? 'Вопрос звучит один раз. Ответь полным предложением.'
                  : 'Прочитай ситуацию и начни диалог первым.'}
                {audio?.synthetic ? ' · синтез' : ''}
              </Text>
            </View>
          </View>
          {item.kind === 'speaking-situation' && item.situation ? (
            <Text className="font-reading text-lg leading-8" testID="speaking-situation">
              {item.situation.ru}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center justify-between px-1">
          <Text variant="caption">Время на задание</Text>
          <Text className={cn('font-ui-bold tabular-nums', TIMER_TONE_CLASS[windowTone])}>
            {formatClock(windowMs)}
          </Text>
        </View>
      </ScrollView>
      <View
        className="items-center gap-3 border-t border-border bg-bg px-4 pt-3"
        style={{ paddingBottom: bottom + 12 }}
      >
        <MicButton
          state={micState}
          level={recorder.level}
          holdPrimary={false}
          onTap={() => {
            if (recording) onStopEarly();
          }}
          onHoldStart={() => undefined}
          onHoldEnd={() => {
            if (recording) onStopEarly();
          }}
        />
        <Text variant="caption" testID="speaking-mic-hint">
          {recording
            ? `Нажми, чтобы закончить · до ${Math.round((sp.task === 2 ? 40_000 : 30_000) / 1000)} с`
            : processing
              ? 'Распознаю…'
              : 'Микрофон откроется сам'}
        </Text>
        {!processing ? (
          <Pressable
            onPress={() =>
              Alert.alert(
                'Пропустить задание?',
                'Ответа не будет — задание засчитается как пустое.',
                [
                  { text: 'Вернуться', style: 'cancel' },
                  { text: 'Пропустить', style: 'destructive', onPress: onSkip },
                ],
              )
            }
            accessibilityRole="button"
            testID="speaking-skip"
            className="py-1"
          >
            <Text className="font-ui-medium text-text-muted">Пропустить →</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

// --- task 3 -------------------------------------------------------------------------------------

function MonologueBody({
  packId,
  level,
  sp,
  items,
  item,
  windowMs,
  recorder,
  lookup,
  onChoose,
  onPrepDone,
  onSkip,
  onStopEarly,
  bottom,
}: {
  packId: string;
  level: TorflLevel;
  sp: ExamSpeakingState;
  items: readonly ExamItem[];
  item: SpeakingMonologueItem | null;
  windowMs: number;
  recorder: ExamRecorder;
  lookup: boolean;
  onChoose: (itemId: string) => void;
  onPrepDone: () => void;
  onSkip: () => void;
  onStopEarly: () => void;
  bottom: number;
}) {
  const { tokens } = useAppTheme();
  const [notes, setNotes] = React.useState('');
  const [lookupOpen, setLookupOpen] = React.useState(false);
  void packId;
  const topics = items.filter((i): i is SpeakingMonologueItem => i.kind === 'speaking-monologue');

  if (sp.phase === 'choose') {
    return (
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-10 pt-2">
        <Text variant="caption" className="px-1" testID="speaking-choose-line">
          {chooseLine(
            topics.length,
            monologueWindows(level, topics[0] ?? {}).prepSec,
            monologueWindows(level, topics[0] ?? {}).answerSec,
          )}
        </Text>
        {topics.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => onChoose(t.id)}
            accessibilityRole="button"
            testID={`speaking-topic-${t.id}`}
            className="gap-2 rounded-2xl border border-border bg-surface px-4 py-4 active:bg-surface-2"
          >
            <Text className="font-reading-bold text-xl">{t.topicTitle.ru}</Text>
            <Text variant="caption">{t.topicTitle.en}</Text>
            <Text variant="caption">
              {t.questions.length} вопрос(ов) · {t.minSentences}–{t.maxSentences} предложений
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() =>
            Alert.alert('Пропустить монолог?', 'Задание 3 засчитается как пустое.', [
              { text: 'Вернуться', style: 'cancel' },
              { text: 'Пропустить', style: 'destructive', onPress: onSkip },
            ])
          }
          accessibilityRole="button"
          testID="speaking-skip"
          className="items-center py-2"
        >
          <Text className="font-ui-medium text-text-muted">Пропустить →</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (!item) return null;

  if (sp.phase === 'prep') {
    const tone = timerTone(windowMs);
    return (
      <>
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 px-4 pb-6 pt-2"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row items-center justify-between px-1">
            <Text variant="caption">Подготовка</Text>
            <Text
              className={cn('font-ui-bold text-lg tabular-nums', TIMER_TONE_CLASS[tone])}
              testID="speaking-prep-clock"
            >
              {formatClock(windowMs)}
            </Text>
          </View>
          <View className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4">
            <Text className="font-reading-bold text-2xl" testID="speaking-topic-title">
              {item.topicTitle.ru}
            </Text>
            <View className="gap-1.5">
              {item.questions.map((q, i) => (
                <Text key={i} className="font-reading text-lg leading-7">
                  {i + 1}. {q.ru}
                </Text>
              ))}
            </View>
            <Text variant="caption">{sentencesLine(item.minSentences, item.maxSentences)}</Text>
          </View>
          <View className="gap-2">
            <View className="flex-row items-center justify-between px-1">
              <Text variant="caption">Заметки (не оцениваются)</Text>
              {lookup ? (
                <Pressable
                  onPress={() => setLookupOpen(true)}
                  accessibilityRole="button"
                  testID="speaking-lookup"
                  className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1.5 active:bg-surface-2"
                >
                  <Ionicons name="book-outline" size={14} color={tokens.accent} />
                  <Text className="font-ui-medium text-sm text-accent">Словарь</Text>
                </Pressable>
              ) : null}
            </View>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              textAlignVertical="top"
              placeholder="Ключевые слова, план ответа…"
              placeholderTextColor={tokens.textMuted}
              testID="speaking-notes"
              className="min-h-[140px] rounded-2xl border border-border bg-surface px-4 py-3 font-reading text-base leading-6 text-text"
            />
          </View>
        </ScrollView>
        <View
          className="gap-2 border-t border-border bg-bg px-4 pt-3"
          style={{ paddingBottom: bottom + 12 }}
        >
          <Pressable
            onPress={() =>
              Alert.alert(
                'Начать ответ?',
                startAnswerLine(monologueWindows(level, item).answerSec),
                [
                  { text: 'Ещё подготовлюсь', style: 'cancel' },
                  { text: 'Готов', onPress: onPrepDone },
                ],
              )
            }
            accessibilityRole="button"
            testID="speaking-prep-done"
            className="items-center rounded-full bg-accent px-5 py-3.5 active:opacity-80"
          >
            <Text className="font-ui-bold text-bg">Готов — отвечать</Text>
          </Pressable>
        </View>
        <WritingLookupSheet
          open={lookupOpen}
          initialQuery=""
          subtestKind="speaking"
          level={level}
          onClose={() => setLookupOpen(false)}
        />
      </>
    );
  }

  // answer / processing
  const recording = sp.phase === 'answer' && recorder.phase === 'recording';
  const processing = sp.phase === 'processing' || recorder.phase === 'processing';
  const warn = sp.phase === 'answer' && windowMs <= ANSWER_WARN_MS;
  return (
    <>
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-6 pt-2">
        <View className="flex-row items-center justify-between px-1">
          <Text variant="caption">Ответ</Text>
          <Text
            className={cn('font-ui-bold text-lg tabular-nums', warn ? 'text-danger' : 'text-text')}
            testID="speaking-answer-clock"
          >
            {formatClock(windowMs)}
          </Text>
        </View>
        <View className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4">
          <Text className="font-reading-bold text-2xl">{item.topicTitle.ru}</Text>
          <View className="gap-1">
            {item.questions.map((q, i) => (
              <Text key={i} variant="muted" className="font-reading leading-6">
                {i + 1}. {q.ru}
              </Text>
            ))}
          </View>
        </View>
        {warn ? (
          <Text className="px-1 font-ui-medium text-danger" testID="speaking-answer-warning">
            Осталось 10 секунд — заканчивай мысль.
          </Text>
        ) : null}
        {notes.trim().length > 0 ? (
          <View className="rounded-2xl border border-border bg-surface-2 px-4 py-3">
            <Text variant="caption" className="mb-1">
              Твои заметки
            </Text>
            <Text className="font-reading leading-6">{notes}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View
        className="items-center gap-3 border-t border-border bg-bg px-4 pt-3"
        style={{ paddingBottom: bottom + 12 }}
      >
        <MicButton
          state={recording ? 'recording' : processing ? 'processing' : 'disabled'}
          level={recorder.level}
          holdPrimary={false}
          onTap={() => undefined}
          onHoldStart={() => undefined}
          onHoldEnd={() => undefined}
        />
        <Text variant="caption">
          {recording
            ? recordingLine(monologueWindows(level, item ?? {}).answerSec)
            : processing
              ? 'Распознаю…'
              : 'Запись'}
        </Text>
        {recording ? (
          <Pressable
            onPress={() =>
              Alert.alert('Закончить ответ?', 'Запись остановится, вернуться нельзя.', [
                { text: 'Продолжить', style: 'cancel' },
                { text: 'Закончить', style: 'destructive', onPress: onStopEarly },
              ])
            }
            accessibilityRole="button"
            testID="speaking-finish"
            className="rounded-full border border-border px-5 py-2 active:bg-surface-2"
          >
            <Text className="font-ui-medium">Закончить</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

/** The speaking part instruction + item count for the instruction screen's facts (T73). */
export function speakingFacts(subtest: ExamSubtest, level: TorflLevel = 'A1'): string[] {
  const out: string[] = [];
  for (const part of subtest.parts) {
    const first = part.items[0];
    const task = first ? speakingTaskOf(first) : null;
    if (task === null) continue;
    const sec = part.timeSec ?? 0;
    const min = Math.round(sec / 60);
    if (task === 3) {
      const m = first as SpeakingMonologueItem;
      out.push(
        task3Fact(
          part.items.filter((i) => i.kind === 'speaking-monologue').length,
          monologueWindows(level, m).prepSec,
          monologueWindows(level, m).answerSec,
        ),
      );
    } else {
      out.push(
        `Задание ${task}: ${part.items.length} ${task === 1 ? 'вопрос(ов) экзаменатора' : 'ситуаций'}, ${min} мин. Ответ записывается сразу.`,
      );
    }
  }
  return out;
}

export function logSpeakingLookup(level: TorflLevel = 'A1'): void {
  trackTorfl('exam_lookup_used', { subtestKind: 'speaking', level });
}
