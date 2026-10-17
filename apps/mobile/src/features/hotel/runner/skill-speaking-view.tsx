import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { CourseItem } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { ResponseEntry } from '@/db/repositories/course';
import { MicButton } from '@/features/scenario/stage/mic-button';
import { useExamRecorder } from '@/features/torfl/speaking/use-exam-recorder';
import {
  gradeSpeakingOffline,
  speakingTaskOf,
  type OfflineSpeakingDetails,
} from '@/features/torfl/grading/speaking';
import { fileExists } from '@/features/torfl/drill/drill-item';
import { formatClock } from '@/features/torfl/engine/rules';
import { loadRefAudio, type ExamAudio } from '@/features/torfl/items/exam-audio';
import { useExamAudio } from '@/features/torfl/items/use-exam-audio';
import { useAppTheme } from '@/theme/use-app-theme';

import type { RunMode } from './runner-model';
import { speakingCorrect } from './skill-items';

type SpeakingCourseItem = Extract<CourseItem, { kind: 'speaking-reply' | 'speaking-situation' }>;

/** The offline cap for a course speaking turn (task 1 / 2), in ms. Unit runs and floor runs use the same window. */
const TURN_CAP_MS = 60_000;

/**
 * A speaking turn inside a course run (T93, coordinator addition A1; T92 D8).
 * The examiner's line plays from its story ref; the learner taps the mic to
 * start, «Готово» (or the cap) to stop. The T73 exam recorder transcribes the
 * take; the offline turn judge (`gradeSpeakingOffline`) decides the verdict:
 * correct = judge `matched` (`speakingCorrect` on the verdict). A floor or
 * экстерн run shows no verdict (exam conditions); the runner scores the stored
 * `correct` at submit.
 */
export function SpeakingItemView({
  item,
  mode,
  packId,
  stored,
  onAnswer,
}: {
  item: SpeakingCourseItem;
  mode: RunMode;
  packId: string;
  /** The response already stored for this item (a resumed sitting). */
  stored: ResponseEntry | undefined;
  onAnswer: (value: ResponseEntry) => void;
}) {
  const { tokens } = useAppTheme();
  const [transcript, setTranscript] = React.useState<string | null>(() => {
    const t = (stored?.answer as { transcript?: unknown } | undefined)?.transcript;
    return typeof t === 'string' ? t : null;
  });
  const [verdict, setVerdict] = React.useState<boolean | null>(
    stored !== undefined ? stored.correct : null,
  );

  const promptAudio = useQuery({
    queryKey: ['hotel', 'speaking-prompt-audio', packId, item.prompt.storyId, item.id],
    queryFn: (): Promise<ExamAudio | null> =>
      loadRefAudio(repos.content, packId, item.prompt, fileExists),
  });
  const prompt = useExamAudio(promptAudio.data ?? null);

  const recorder = useExamRecorder({
    onDone: (doneId, answer) => {
      if (doneId !== item.id) return;
      const task = speakingTaskOf(item) ?? 1;
      const grade = gradeSpeakingOffline(item, answer);
      const correct = speakingCorrect(grade ? judgeVerdict(grade.details) : null);
      setTranscript(answer.transcript);
      setVerdict(correct);
      onAnswer({
        answer: {
          kind: 'speaking',
          task,
          transcript: answer.transcript,
          recordingPath: answer.recordingPath,
          durationMs: answer.durationMs,
        },
        correct,
      });
    },
  });

  const recording = recorder.phase === 'recording';
  const processing = recorder.phase === 'processing';
  const answered = verdict !== null;

  const startRecording = () => {
    if (recorder.phase !== 'idle') return;
    prompt.stop();
    const task = speakingTaskOf(item) ?? 1;
    void recorder.start({
      itemId: item.id,
      task,
      capMs: TURN_CAP_MS,
      fixedWindow: false,
      attemptId: `hotel-${packId}-${item.id}`,
    });
  };

  return (
    <View className="gap-4" testID="skill-speaking">
      <View className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4">
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={() => (prompt.playing ? prompt.stop() : prompt.play(1))}
            disabled={!promptAudio.data || recording}
            accessibilityRole="button"
            accessibilityLabel="Послушать собеседника"
            testID="skill-speaking-play-prompt"
            className="h-12 w-12 items-center justify-center rounded-full bg-accent-soft"
          >
            <Ionicons
              name={prompt.playing ? 'pause' : 'volume-high'}
              size={22}
              color={tokens.accent}
            />
          </Pressable>
          <Text className="flex-1 font-reading text-lg leading-7">
            {item.situation?.ru ?? 'Ответьте вслух.'}
          </Text>
        </View>
      </View>

      <View className="items-center gap-3 py-2">
        <MicButton
          state={
            answered ? 'disabled' : recording ? 'recording' : processing ? 'processing' : 'ready'
          }
          level={recorder.level}
          holdPrimary={false}
          onTap={() => {
            if (recording) recorder.stop('done');
            else startRecording();
          }}
          onHoldStart={() => undefined}
          onHoldEnd={() => undefined}
        />
        <Text variant="caption" testID="skill-speaking-hint">
          {recording
            ? 'Говорите. Нажмите «Готово», когда закончите.'
            : processing
              ? 'Распознаём…'
              : answered
                ? 'Ответ записан.'
                : 'Нажмите микрофон и говорите.'}
        </Text>
        {recording ? (
          <>
            <Text className="font-ui-bold tabular-nums" testID="skill-speaking-clock">
              {formatClock(recorder.elapsedMs)}
            </Text>
            <Pressable
              onPress={() => recorder.stop('done')}
              accessibilityRole="button"
              testID="skill-speaking-finish"
              className="min-w-[160px] items-center rounded-full bg-accent px-6 py-3"
            >
              <Text className="font-ui-bold text-bg">Готово</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {mode === 'unit' && answered && transcript !== null ? (
        <View
          className="gap-2 rounded-2xl border border-border bg-surface px-4 py-4"
          testID="skill-speaking-result"
        >
          <Text className="font-ui-bold text-base" testID="skill-speaking-verdict">
            {verdict ? 'Ответ засчитан' : 'Пока не засчитано'}
          </Text>
          <Text variant="caption">{transcript.trim() ? transcript : 'Речь не распознана.'}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The judge verdict of an offline turn grade: `pass` on a full match, else `fail` (`speakingCorrect` reads it). */
function judgeVerdict(details: OfflineSpeakingDetails): 'pass' | 'fail' {
  if (!('verdict' in details)) return 'fail';
  return details.verdict === 'matched' && details.fullAnswer ? 'pass' : 'fail';
}
