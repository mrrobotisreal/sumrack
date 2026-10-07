import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useExam, useExamAttempt, useScenarios } from '@/db/hooks';
import { FeedbackView } from '@/features/ai/feedback-view';
import { AiError, friendlyAiMessage } from '@/features/ai/errors';
import { friendlyBackupMessage } from '@/features/backup/errors';
import { useClipPlayer } from '@/features/scenario/debrief/use-clip-player';
import { formatDuration } from '@/features/scenario/debrief/debrief-core';
import { downloadExamBundle } from '@/features/scenario/recordings/bundle-service';
import { attemptFile, listRunFiles, runDirBytes } from '@/features/scenario/recordings/paths';
import { formatBytes } from '@/features/tts/catalog';
import { cn } from '@/lib/cn';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { fileExists } from '../drill/drill-item';
import { requestGrading, useGradingQueue } from '../grading/queue';
import { TASK_LABEL, speakingCriterionLabel } from '../grading/speaking';
import { loadRefAudio, type ExamAudio } from '../items/exam-audio';
import { useExamAudio } from '../items/use-exam-audio';
import { getExamBundle } from '../media-state';
import type { ExamBundleEntry } from '../media-state-core';
import { PinButton } from './pin-button';
import {
  examScenarioRung,
  speakingDebriefEntries,
  transcriptChips,
  type SpeakingDebriefEntry,
} from './debrief-model';
import { ticketHref } from './tickets-model';

/**
 * The speaking debrief (T73, TORFL §8.4) — route `/exam/speaking/[attemptId]`:
 * one card per speaking item — ▶ the recording (WAV or OGG), the ASR
 * transcript as word chips (+ the Whisper line when it differs), the judge
 * verdict / coverage summary, the model answer with its audio (tasks 1–2:
 * `accept[0]` spoken by the coach track when the pack has it; task 3: the
 * model story → the reader), the criteria with the grader's comments and
 * the corrected version once the AI graded, «Повторить оценку», and
 * «Практиковать» (tasks 1–2 → the «Экзамен» scenario when installed, else
 * the drill; task 3 → «Билеты»). Subscribes to the grading queue so an AI
 * grade landing re-renders in place.
 */
export function SpeakingDebriefScreen({ attemptId }: { attemptId: string }) {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const gradedVersion = useGradingQueue((s) => s.gradedVersion);
  const sending = useGradingQueue((s) => s.sending);
  const attempt = useExamAttempt(attemptId);
  const exam = useExam(attempt.data?.packId, attempt.data?.examId);
  const scenarios = useScenarios();
  const clips = useClipPlayer();
  const [error, setError] = React.useState<string | null>(null);
  // T74 (§8.5): the attempt's recordings on disk + its media-bundle ledger entry → the media line.
  const [bundle, setBundle] = React.useState<ExamBundleEntry | null>(null);
  const [mediaTick, setMediaTick] = React.useState(0);
  const [downloading, setDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    void getExamBundle(attemptId).then((b) => {
      if (live) setBundle(b);
    });
    return () => {
      live = false;
    };
  }, [attemptId, mediaTick]);
  const localFiles = React.useMemo(
    () => listRunFiles(attemptId, 'exam').length,
    // re-read after a download / pin
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attemptId, mediaTick],
  );
  const download = React.useCallback(() => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    clips.stop();
    void downloadExamBundle(attemptId)
      .then(() => attempt.refetch())
      .catch((err) => {
        setDownloadError(friendlyBackupMessage(err));
        track('exam_debrief_download_failed', {
          code: (err as { code?: string })?.code ?? 'unknown',
        });
      })
      .finally(() => {
        setDownloading(false);
        setMediaTick((n) => n + 1);
      });
    // attempt.refetch is stable per query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, clips, downloading]);

  React.useEffect(() => {
    if (gradedVersion > 0) void attempt.refetch();
    // refetch when a grade lands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradedVersion]);

  const a = attempt.data;
  const e = exam.data;
  const subtest = e?.subtests.find((s) => s.kind === 'speaking');
  const entries = React.useMemo(
    () => (e && subtest && a ? speakingDebriefEntries(e, subtest.id, a.responses) : []),
    [e, subtest, a],
  );

  if (attempt.isPending || (a && exam.isPending)) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (!a || !e || !subtest) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <QueryError message="Говорение не найдено." onRetry={() => router.back()} />
      </View>
    );
  }

  const result = a.results?.[subtest.id];
  const pct = result?.pct ?? null;
  const provisional = result?.provisional ?? true;
  const gradedBy = result?.gradedBy ?? 'offline';
  const scenario = examScenarioRung(scenarios.data);

  const retry = async (responseId: string) => {
    setError(null);
    try {
      const ok = await requestGrading(responseId);
      if (!ok) setError('Нечего оценивать — ответ пустой.');
    } catch (err) {
      setError(
        friendlyAiMessage(err instanceof AiError ? err : new AiError('unknown', String(err))),
      );
    }
  };

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 4 }} testID="speaking-debrief">
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
        <View className="flex-1">
          <Text className="font-reading-bold text-xl">Говорение · разбор</Text>
          <Text variant="caption" testID="speaking-debrief-pct">
            {pct !== null ? `${pct.toLocaleString('ru-RU')} %` : '—'}
            {provisional ? ' · предварительно' : gradedBy === 'ai' ? ' · оценка ИИ' : ''}
          </Text>
        </View>
        <PinButton
          attemptId={a.id}
          pinned={a.pinned}
          onChanged={() => {
            void attempt.refetch();
            setMediaTick((n) => n + 1);
          }}
        />
      </View>
      <ScrollView
        contentContainerClassName="gap-5 px-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* the media line (T74 §8.5): on device · archived (Download) · deleted */}
        <View className="flex-row items-center gap-2 px-1" testID="speaking-media-line">
          <Ionicons
            name={
              localFiles > 0
                ? 'mic-outline'
                : bundle?.state === 'uploaded'
                  ? 'cloud-download-outline'
                  : 'mic-off-outline'
            }
            size={14}
            color={tokens.textMuted}
          />
          <Text variant="caption" className="flex-1">
            {downloading
              ? 'Скачиваю записи…'
              : localFiles > 0
                ? `Записи на устройстве · ${formatKb(runDirBytes(a.id, 'exam'))}${
                    bundle?.state === 'uploaded'
                      ? ' · в резервной копии'
                      : bundle?.state === 'pending'
                        ? ' · копия ждёт связи'
                        : bundle?.state === 'failed'
                          ? ' · копия не загрузилась'
                          : ''
                  }${a.pinned ? ' · закреплена' : ''}`
                : bundle?.state === 'uploaded'
                  ? 'Записи в резервной копии'
                  : entries.some((e) => e.answer)
                    ? 'Записи удалены (не было резервной копии)'
                    : 'Записей нет'}
          </Text>
          {localFiles === 0 && bundle?.state === 'uploaded' && !downloading ? (
            <Pressable
              onPress={download}
              accessibilityRole="button"
              accessibilityLabel="Скачать запись"
              testID="speaking-download"
              className="rounded-full bg-accent px-3 py-1.5 active:opacity-80"
            >
              <Text variant="caption" className="text-bg">
                Скачать запись
              </Text>
            </Pressable>
          ) : null}
        </View>
        {downloadError ? (
          <Text variant="caption" className="text-danger">
            {downloadError}
          </Text>
        ) : null}
        {error ? (
          <Text variant="caption" className="text-danger">
            {error}
          </Text>
        ) : null}
        {entries.map((entry) => (
          <EntryCard
            key={entry.item.id}
            packId={a.packId}
            attemptId={a.id}
            entry={entry}
            clips={clips}
            inFlight={entry.response ? sending[entry.response.id] === true : false}
            onRetry={entry.response ? () => void retry(entry.response!.id) : undefined}
            onPractice={() => {
              if (entry.task === 3) {
                router.push(ticketHref());
                return;
              }
              if (scenario) {
                router.push(`/scenario/${scenario.packId}/${scenario.scenarioId}`);
                return;
              }
              router.push({
                pathname: '/torfl/speak',
                params: { packId: a.packId, examId: a.examId, itemId: entry.item.id },
              });
            }}
            onModelStory={(storyId) => {
              track('torfl_text_opened', { packId: a.packId, storyId, from: 'review' });
              router.push({
                pathname: '/reader/[packId]/[storyId]',
                params: { packId: a.packId, storyId, from: 'torfl' },
              });
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function EntryCard({
  packId,
  attemptId,
  entry,
  clips,
  inFlight,
  onRetry,
  onPractice,
  onModelStory,
}: {
  packId: string;
  attemptId: string;
  entry: SpeakingDebriefEntry;
  clips: ReturnType<typeof useClipPlayer>;
  inFlight: boolean;
  onRetry?: () => void;
  onPractice: () => void;
  onModelStory: (storyId: string) => void;
}) {
  const { tokens } = useAppTheme();
  const { item, answer, response, details, criteria } = entry;
  const status = response?.gradingStatus ?? null;
  const waiting = status === 'pending-ai' && !inFlight;
  const file = answer?.recordingPath ?? null;
  const playable = !!file && attemptFile(attemptId, file, 'exam').exists;
  const key = `rec:${item.id}`;
  const isPlaying = clips.playing === key;
  const chips = transcriptChips(answer);
  const assist = answer?.assistTranscript?.trim();
  const showAssist = !!assist && assist.toLowerCase() !== answer?.transcript.trim().toLowerCase();
  const ai = response?.grading?.ai;

  // The model answer's audio (tasks 1–2: the prompt story's coach line is not stored for exams — the
  // examiner line itself is the closest audio; task 3: the model story) — played through the exam audio hook.
  const modelRef = item.kind === 'speaking-monologue' ? item.model : null;
  const modelAudio = useQuery({
    queryKey: [
      'torfl',
      'model-audio',
      packId,
      modelRef?.storyId ?? '',
      modelRef?.sentenceIds?.join(',') ?? '',
    ],
    queryFn: (): Promise<ExamAudio | null> =>
      modelRef ? loadRefAudio(repos.content, packId, modelRef, fileExists) : Promise.resolve(null),
    enabled: !!modelRef,
  });
  const promptAudio = useQuery({
    queryKey: [
      'torfl',
      'prompt-audio',
      packId,
      item.kind !== 'speaking-monologue' ? item.prompt.storyId : '',
    ],
    queryFn: (): Promise<ExamAudio | null> =>
      item.kind !== 'speaking-monologue'
        ? loadRefAudio(repos.content, packId, item.prompt, fileExists)
        : Promise.resolve(null),
    enabled: item.kind !== 'speaking-monologue',
  });
  const model = useExamAudio(modelAudio.data ?? null);
  const prompt = useExamAudio(promptAudio.data ?? null);

  const title =
    item.kind === 'speaking-monologue'
      ? item.topicTitle.ru
      : item.kind === 'speaking-situation'
        ? (item.situation?.ru ?? 'Ситуация')
        : (promptAudio.data?.transcript.map((s) => s.ru).join(' ') ?? 'Вопрос экзаменатора');

  const verdictLine = (() => {
    if (!details) return entry.unchosen ? 'Тема не выбрана' : 'Без ответа';
    if (details.task === 3) {
      return `Вопросов раскрыто ${details.covered} из ${details.total} · предложений ≈ ${details.sentences} (нужно ${details.minSentences}) · ${details.words} слов${details.wpm > 0 ? ` · ${Math.round(details.wpm)} сл/мин` : ''}`;
    }
    const v =
      details.verdict === 'matched'
        ? '✓ по заданию'
        : details.nearMiss
          ? '≈ почти'
          : details.verdict === 'no-speech'
            ? 'тишина'
            : '✗ мимо';
    return `${v} · ${details.fullAnswer ? 'полный ответ' : `короткий ответ (${details.contentTokens} из ${details.minTokens} слов)`}${details.transcriptUsed === 'assist' ? ' · по Whisper' : ''}`;
  })();

  return (
    <View
      className="gap-3 rounded-2xl border border-border bg-surface px-4 py-4"
      testID={`speaking-entry-${item.id}`}
    >
      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-0.5">
          <Text variant="caption">
            {TASK_LABEL[entry.task].ru} · {entry.number}
          </Text>
          <Text className="font-reading text-lg leading-7">{title}</Text>
        </View>
        {entry.pct !== null ? (
          <Text className="font-ui-bold" testID={`speaking-entry-pct-${item.id}`}>
            {entry.pct.toLocaleString('ru-RU')} %
          </Text>
        ) : null}
      </View>

      {/* the examiner line */}
      {promptAudio.data ? (
        <Pressable
          onPress={() => (prompt.playing ? prompt.stop() : prompt.play(1))}
          accessibilityRole="button"
          className="flex-row items-center gap-2 self-start rounded-full border border-border px-3 py-1.5 active:bg-surface-2"
        >
          <Ionicons
            name={prompt.playing ? 'pause' : 'volume-medium-outline'}
            size={14}
            color={tokens.accent}
          />
          <Text className="font-ui-medium text-sm text-accent">Экзаменатор</Text>
        </Pressable>
      ) : null}

      {/* the recording + transcript */}
      <View className="gap-2 rounded-xl border border-border bg-bg p-3">
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={() => {
              if (!playable || !file) return;
              clips.toggle(key, attemptFile(attemptId, file, 'exam').uri);
            }}
            disabled={!playable}
            accessibilityRole="button"
            accessibilityLabel={
              isPlaying ? 'Pause your recording' : playable ? 'Play your recording' : 'No recording'
            }
            testID={`speaking-play-${item.id}`}
            className={cn(
              'h-9 w-9 items-center justify-center rounded-full',
              playable ? 'bg-accent active:opacity-80' : 'bg-surface-2',
            )}
          >
            <Ionicons
              name={isPlaying ? 'pause' : playable ? 'play' : 'mic-off-outline'}
              size={16}
              color={playable ? tokens.bg : tokens.textMuted}
            />
          </Pressable>
          <View className="flex-1">
            <Text className="font-ui-medium text-sm">
              {answer ? `Твой ответ · ${formatDuration(answer.durationMs)}` : 'Нет записи'}
            </Text>
            <Text variant="caption">{verdictLine}</Text>
          </View>
        </View>
        {chips.length > 0 ? (
          <View className="flex-row flex-wrap gap-1" testID={`speaking-transcript-${item.id}`}>
            {chips.map((w, i) => (
              <View key={`${w}-${i}`} className="rounded-md bg-surface-2 px-1.5 py-0.5">
                <Text className="font-reading text-sm">{w}</Text>
              </View>
            ))}
          </View>
        ) : answer ? (
          <Text variant="caption">Ничего не распознано.</Text>
        ) : null}
        {showAssist ? <Text variant="caption">Whisper: {assist}</Text> : null}
      </View>

      {/* the model answer */}
      {entry.modelLine ? (
        <View className="gap-1 rounded-xl border border-border bg-bg p-3">
          <Text variant="caption">Образец ответа</Text>
          <Text className="font-reading text-base leading-6">{entry.modelLine}</Text>
        </View>
      ) : item.kind === 'speaking-monologue' && item.model ? (
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => onModelStory(item.model!.storyId)}
            accessibilityRole="button"
            testID={`speaking-model-${item.id}`}
            className="flex-1 flex-row items-center gap-3 rounded-xl border border-border bg-bg px-3 py-2.5 active:bg-surface-2"
          >
            <Ionicons name="reader-outline" size={16} color={tokens.accent} />
            <Text className="flex-1 font-ui-medium text-sm">Образец монолога</Text>
            <Ionicons name="chevron-forward" size={14} color={tokens.textMuted} />
          </Pressable>
          {modelAudio.data ? (
            <Pressable
              onPress={() => (model.playing ? model.stop() : model.play(1))}
              accessibilityRole="button"
              accessibilityLabel="Play the model monologue"
              className="h-10 w-10 items-center justify-center rounded-full border border-border active:bg-surface-2"
            >
              <Ionicons name={model.playing ? 'pause' : 'play'} size={16} color={tokens.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* criteria */}
      {response ? (
        <View className="overflow-hidden rounded-xl border border-border">
          {criteria.map((c, i) => (
            <View
              key={c.id}
              className={cn('gap-0.5 px-3 py-2', i > 0 && 'border-t border-border')}
              testID={`speaking-criterion-${item.id}-${c.id}`}
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 font-ui-medium text-sm">
                  {speakingCriterionLabel(c.id).ru}
                </Text>
                <Text className={cn('font-ui-bold text-sm', c.pending && 'text-text-muted')}>
                  {c.pending ? '—' : c.score.toLocaleString('ru-RU')} / {c.max}
                </Text>
              </View>
              {c.comment ? <Text variant="caption">{c.comment}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* status */}
      {response ? (
        inFlight ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" color={tokens.accent} />
            <Text variant="caption">ИИ оценивает…</Text>
          </View>
        ) : waiting ? (
          <Text variant="caption">Ждёт связи: ИИ оценит, когда появится интернет.</Text>
        ) : status === 'ai-failed' ? (
          <Text variant="caption" className="text-danger">
            Оценка ИИ не удалась{response.grading?.error ? ` (${response.grading.error.code})` : ''}
            .
          </Text>
        ) : status === 'provisional' ? (
          <Text variant="caption">Пока только офлайн-критерии; ИИ оценит грамматику.</Text>
        ) : null
      ) : null}

      {/* corrected */}
      {ai?.corrected && answer ? (
        <FeedbackView
          feedback={{
            v: 1,
            sourceRu: answer.assistTranscript?.trim() || answer.transcript || '—',
            corrected: ai.corrected,
            changes: ai.changes ?? [],
            summary: ai.tips.length > 0 ? ai.tips.join(' ') : 'No tips.',
            model: ai.model ?? 'exam-grader',
            createdAt: ai.gradedAt ?? response?.updatedAt ?? 0,
          }}
        />
      ) : null}

      {/* actions */}
      <View className="flex-row flex-wrap gap-2">
        {response &&
        (status === 'ai-failed' || status === 'provisional' || waiting) &&
        !inFlight &&
        onRetry ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            testID={`speaking-retry-${item.id}`}
            className="flex-row items-center gap-1.5 rounded-full bg-accent px-4 py-2 active:opacity-80"
          >
            <Ionicons name="refresh" size={14} color={tokens.bg} />
            <Text className="font-ui-medium text-sm text-bg">Повторить оценку</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onPractice}
          accessibilityRole="button"
          testID={`speaking-practice-${item.id}`}
          className="flex-row items-center gap-1.5 rounded-full border border-accent px-4 py-2 active:bg-accent-soft"
        >
          <Ionicons
            name={entry.task === 3 ? 'albums-outline' : 'mic-outline'}
            size={14}
            color={tokens.accent}
          />
          <Text className="font-ui-medium text-sm text-accent">
            {entry.task === 3 ? 'Билеты' : 'Практиковать'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Recordings are tens of KB — `formatBytes` would print «0.0 MB» (S25 finding, T74). */
function formatKb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return formatBytes(bytes);
}
