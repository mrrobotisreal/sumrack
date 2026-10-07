import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text as RNText,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useJournalEntry } from '@/db/hooks';
import { useQuietStudy, useStudyAmbience } from '@/features/ambient-audio/activity';
import { isAsrInstalled } from '@/features/pronunciation/asr-manager';
import { preloadAsr, transcribeWav } from '@/features/pronunciation/asr-service';
import { RecordButton, type RecordButtonState } from '@/features/pronunciation/record-button';
import {
  cancelAttemptRecording,
  MAX_ATTEMPT_MS,
  requestMicPermission,
  startAttemptRecording,
  stopAttemptRecording,
} from '@/features/pronunciation/recorder';
import {
  PRONUNCIATION_PASS_SCORE,
  scoreAttempt,
  type PronunciationScore,
} from '@/features/pronunciation/scoring';
import { cn } from '@/lib/cn';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { speak } from '@/services/speech';
import { useAppTheme } from '@/theme/use-app-theme';

import SherpaSpeech from '../../../../modules/sherpa-speech';
import {
  rehearsalText,
  summarizeRehearsal,
  type RehearsalPass,
  type RehearsalSummary,
  type SentenceResult,
} from './answers-model';

type AttemptPhase = 'idle' | 'recording' | 'processing' | 'feedback' | 'mic-denied' | 'error';

type Screen =
  | { kind: 'loading' }
  | { kind: 'needs-model' }
  | { kind: 'empty' }
  | { kind: 'rehearsing'; pass: RehearsalPass; index: number }
  | { kind: 'summary'; summary: RehearsalSummary };

const PASS_LABEL: Record<RehearsalPass, { title: string; hint: string }> = {
  'with-text': {
    title: 'С текстом',
    hint: 'Прочитай предложение вслух. Слушай, где слова не узнаются.',
  },
  'without-text': {
    title: 'Без текста',
    hint: 'Теперь по памяти — как на экзамене. Подсказка откроется по кнопке.',
  },
};

/**
 * «Отрепетировать вслух» (T74, TORFL §9) — route `/torfl/rehearse?entryId&
 * topic`: one journal answer (the AI-corrected text when present, labelled
 * «исправленный текст») walked sentence by sentence through the T12
 * pronunciation loop — show → record → `transcribeWav` → `scoreAttempt` →
 * per-word ✓/✗ and a score — first «С текстом», then again «Без текста»
 * (the sentence hidden; a «Показать» peek is allowed and remembered on the
 * card, not in the score). One `game_sessions` row (`torfl-rehearsal`, no
 * FSRS) and `torfl_rehearsal_finished {topic, score}` at the end; a quit
 * mid-way still closes the row with what was recorded. Retrying a sentence
 * is free — the best attempt counts (the T12 rule).
 */
export function RehearseScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useStudyAmbience(true, 'education');
  useQuietStudy();
  const { entryId, topic } = useLocalSearchParams<{ entryId: string; topic?: string }>();
  const entry = useJournalEntry(entryId);

  const [screen, setScreen] = React.useState<Screen>({ kind: 'loading' });
  const text = React.useMemo(() => (entry.data ? rehearsalText(entry.data) : null), [entry.data]);
  const sentences = text?.sentences ?? [];

  const withTextRef = React.useRef<SentenceResult[]>([]);
  const withoutTextRef = React.useRef<SentenceResult[]>([]);
  const sessionIdRef = React.useRef<string | null>(null);
  const finishedRef = React.useRef(false);
  const topicSlug = topic && topic.length > 0 ? topic : 'other';

  // Start: ASR gate → the game_sessions row → pass 1. Runs once the entry is
  // loaded; the gate decisions are async so the state updates happen off the
  // effect body (the lint rule), with the row started only when rehearsal can run.
  React.useEffect(() => {
    if (entry.isPending || !entry.data || !text) return;
    const data = entry.data;
    const sentenceCount = text.sentences.length;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (sentenceCount === 0) {
        setScreen({ kind: 'empty' });
        return;
      }
      if (!isAsrInstalled()) {
        setScreen({ kind: 'needs-model' });
        return;
      }
      preloadAsr();
      try {
        const row = await repos.stats.startGameSession('torfl-rehearsal', {
          entryId: data.id,
          topic: topicSlug,
        });
        if (cancelled) return;
        sessionIdRef.current = row.id;
      } catch (err) {
        logError('manual', err);
      }
      if (!cancelled) setScreen({ kind: 'rehearsing', pass: 'with-text', index: 0 });
    })();
    return () => {
      cancelled = true;
    };
    // the entry id is the only input; `text` derives from it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.isPending, entry.data?.id]);

  const persistEnd = React.useCallback(
    (summary: RehearsalSummary) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const a = withTextRef.current;
      const b = withoutTextRef.current;
      const all = [...a, ...b];
      const id = sessionIdRef.current;
      if (id) {
        void repos.stats.finishGameSession(id, {
          itemCount: all.length,
          correctCount: all.filter((r) => r.score >= PRONUNCIATION_PASS_SCORE).length,
          detail: {
            entryId,
            topic: topicSlug,
            sentences: sentences.length,
            withText: summary.withText,
            withoutText: summary.withoutText,
            weakest: summary.weakest,
          },
        });
      }
      if (all.length > 0) {
        track('torfl_rehearsal_finished', {
          topic: topicSlug,
          score: summary.score,
          sentences: sentences.length,
          withText: summary.withText ?? -1,
          withoutText: summary.withoutText ?? -1,
        });
      }
    },
    [entryId, sentences.length, topicSlug],
  );

  // Quitting mid-way still closes the row with what was recorded.
  React.useEffect(
    () => () => {
      if (!finishedRef.current && (withTextRef.current.length || withoutTextRef.current.length)) {
        persistEnd(summarizeRehearsal(withTextRef.current, withoutTextRef.current));
      }
    },
    [persistEnd],
  );

  const advance = React.useCallback(
    (pass: RehearsalPass, index: number, score: number) => {
      const bucket = pass === 'with-text' ? withTextRef.current : withoutTextRef.current;
      bucket.push({ index, score });
      if (index + 1 < sentences.length) {
        setScreen({ kind: 'rehearsing', pass, index: index + 1 });
        return;
      }
      if (pass === 'with-text') {
        setScreen({ kind: 'rehearsing', pass: 'without-text', index: 0 });
        return;
      }
      const summary = summarizeRehearsal(withTextRef.current, withoutTextRef.current);
      persistEnd(summary);
      setScreen({ kind: 'summary', summary });
    },
    [persistEnd, sentences.length],
  );

  const skipToSummary = React.useCallback(() => {
    const summary = summarizeRehearsal(withTextRef.current, withoutTextRef.current);
    persistEnd(summary);
    setScreen({ kind: 'summary', summary });
  }, [persistEnd]);

  const quit = React.useCallback(() => router.back(), [router]);

  if (entry.isPending || screen.kind === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (!entry.data || !text) {
    return (
      <View className="flex-1 justify-center bg-bg px-6">
        <QueryError message="Запись не найдена." onRetry={quit} />
      </View>
    );
  }

  const total = sentences.length * 2;
  const done =
    screen.kind === 'rehearsing'
      ? (screen.pass === 'with-text' ? 0 : sentences.length) + screen.index
      : total;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 8 }} testID="torfl-rehearse">
      {/* header: quit + progress + pass label */}
      <View className="flex-row items-center gap-3 px-4">
        <Pressable
          onPress={quit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Закончить репетицию"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="close" size={22} color={tokens.textMuted} />
        </Pressable>
        <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <View
            className="h-full rounded-full bg-accent"
            style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
          />
        </View>
        <Text variant="caption" className="font-ui-medium">
          {screen.kind === 'rehearsing'
            ? `${PASS_LABEL[screen.pass].title} · ${screen.index + 1}/${sentences.length}`
            : 'Итог'}
        </Text>
      </View>

      {screen.kind === 'needs-model' && (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Ionicons name="mic-off-outline" size={40} color={tokens.textMuted} />
          <Text className="text-center font-ui-medium">Нет модели распознавания речи</Text>
          <Text variant="muted" className="text-center">
            Репетиция оценивает произношение на устройстве. Установи «Russian speech recognition» в
            настройках и вернись.
          </Text>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            className="mt-1 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
          >
            <Text className="text-accent">Открыть настройки</Text>
          </Pressable>
        </View>
      )}

      {screen.kind === 'empty' && (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <Text variant="muted" className="text-center">
            В этой записи нет предложений для репетиции.
          </Text>
        </View>
      )}

      {screen.kind === 'rehearsing' && (
        <SentenceView
          key={`${screen.pass}-${screen.index}`}
          pass={screen.pass}
          sentence={sentences[screen.index]!}
          corrected={text.corrected}
          bottomInset={insets.bottom}
          onDone={(score) => advance(screen.pass, screen.index, score)}
          onSkipPass={screen.pass === 'without-text' ? skipToSummary : undefined}
        />
      )}

      {screen.kind === 'summary' && (
        <SummaryCard
          summary={screen.summary}
          sentences={sentences}
          bottomInset={insets.bottom}
          onDone={quit}
        />
      )}
    </View>
  );
}

function SentenceView({
  pass,
  sentence,
  corrected,
  bottomInset,
  onDone,
  onSkipPass,
}: {
  pass: RehearsalPass;
  sentence: string;
  corrected: boolean;
  /** Safe-area bottom (the S25's nav bar covered «Дальше» on the first device walk). */
  bottomInset: number;
  onDone: (bestScore: number) => void;
  onSkipPass?: () => void;
}) {
  const { tokens } = useAppTheme();
  const [phase, setPhase] = React.useState<AttemptPhase>('idle');
  const [level, setLevel] = React.useState(0);
  const [result, setResult] = React.useState<PronunciationScore | null>(null);
  const [heard, setHeard] = React.useState('');
  const [errorMsg, setErrorMsg] = React.useState('');
  const [peeked, setPeeked] = React.useState(false);
  const bestRef = React.useRef(0);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = React.useRef(phase);
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  React.useEffect(() => {
    // The level meter rides the native module's event, like the T12 view.
    const sub = SherpaSpeech.addListener('onRecordingLevel', ({ level: l }) => setLevel(l));
    return () => {
      sub.remove();
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      if (phaseRef.current === 'recording') void cancelAttemptRecording();
    };
  }, []);

  const finishRecording = React.useCallback(async () => {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    setPhase('processing');
    try {
      const { path } = await stopAttemptRecording();
      const transcript = await transcribeWav(path);
      const scored = scoreAttempt(sentence, transcript.text);
      bestRef.current = Math.max(bestRef.current, scored.score);
      setResult(scored);
      setHeard(transcript.text.trim());
      setPhase('feedback');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'не удалось обработать запись');
      setPhase('error');
    }
  }, [sentence]);

  const startRecording = React.useCallback(async () => {
    const permission = await requestMicPermission();
    if (permission !== 'granted') {
      setPhase('mic-denied');
      return;
    }
    try {
      await startAttemptRecording();
      setLevel(0);
      setPhase('recording');
      autoStopRef.current = setTimeout(() => {
        if (phaseRef.current === 'recording') void finishRecording();
      }, MAX_ATTEMPT_MS);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'запись не началась');
      setPhase('error');
    }
  }, [finishRecording]);

  const showText = pass === 'with-text' || peeked || phase === 'feedback';
  const passed = (result?.score ?? 0) >= PRONUNCIATION_PASS_SCORE;
  const buttonState: RecordButtonState =
    phase === 'recording' ? 'recording' : phase === 'processing' ? 'processing' : 'idle';

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="flex-grow px-6 pt-6"
      contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
    >
      <View className="items-center gap-3">
        <Text variant="caption" className="uppercase tracking-wider">
          {PASS_LABEL[pass].title}
          {corrected ? ' · исправленный текст' : ''}
        </Text>
        {showText ? (
          <RNText
            className="text-center font-reading text-2xl leading-snug text-text"
            testID="rehearse-sentence"
          >
            {sentence}
          </RNText>
        ) : (
          <Pressable
            onPress={() => setPeeked(true)}
            accessibilityRole="button"
            accessibilityLabel="Показать предложение"
            testID="rehearse-peek"
            className="items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-5 active:bg-surface-2"
          >
            <Ionicons name="eye-off-outline" size={26} color={tokens.textMuted} />
            <Text variant="muted" className="text-center">
              Текст скрыт — скажи по памяти.{'\n'}Нажми, чтобы подсмотреть.
            </Text>
          </Pressable>
        )}
        <Text variant="muted" className="text-center text-sm">
          {PASS_LABEL[pass].hint}
        </Text>
        {showText && (
          <Pressable
            onPress={() => void speak(sentence)}
            accessibilityRole="button"
            accessibilityLabel="Послушать предложение"
            className="mt-1 flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 active:bg-surface-2"
          >
            <Ionicons name="volume-medium-outline" size={18} color={tokens.accent} />
            <Text variant="caption" className="text-accent">
              Послушать
            </Text>
          </Pressable>
        )}
      </View>

      {phase === 'feedback' && result && (
        <View className="mt-6 items-center gap-4" testID="rehearse-feedback">
          <View className="flex-row flex-wrap justify-center gap-2">
            {result.words.map((w, i) => (
              <View
                key={`${i}-${w.target}`}
                className={cn(
                  'rounded-lg px-2.5 py-1.5',
                  w.matched ? 'bg-success/20' : 'bg-danger/25',
                )}
              >
                <RNText
                  className="font-reading text-xl"
                  style={{ color: w.matched ? tokens.success : tokens.danger }}
                >
                  {w.display}
                </RNText>
              </View>
            ))}
          </View>
          <View className="items-center gap-1">
            <RNText
              className="font-ui-bold text-4xl"
              style={{ color: passed ? tokens.success : tokens.text }}
              testID="rehearse-score"
            >
              {result.score}%
            </RNText>
            <Text variant="muted">
              {passed
                ? 'Отлично.'
                : result.score > 0
                  ? 'Красные слова — ещё раз.'
                  : 'Не расслышал — попробуй медленнее.'}
            </Text>
            {heard.length > 0 && (
              <Text variant="caption" className="mt-1 text-center">
                Услышал: «{heard}»
              </Text>
            )}
          </View>
        </View>
      )}

      {phase === 'mic-denied' && (
        <View className="mt-8 items-center gap-3 px-4">
          <Ionicons name="mic-off-outline" size={40} color={tokens.textMuted} />
          <Text className="text-center font-ui-medium">Нужен доступ к микрофону</Text>
          <Text variant="muted" className="text-center">
            Произношение оценивается на устройстве — ничего не отправляется. Разреши запись звука в
            настройках системы.
          </Text>
          <Pressable
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            className="mt-1 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
          >
            <Text className="text-accent">Открыть настройки</Text>
          </Pressable>
          <Pressable onPress={() => setPhase('idle')} accessibilityRole="button" hitSlop={8}>
            <Text variant="caption">Ещё раз</Text>
          </Pressable>
        </View>
      )}

      {phase === 'error' && (
        <View className="mt-8 items-center gap-3 px-4">
          <Ionicons name="alert-circle-outline" size={36} color={tokens.danger} />
          <Text variant="muted" className="text-center">
            {errorMsg}
          </Text>
          <Pressable
            onPress={() => setPhase('idle')}
            accessibilityRole="button"
            className="rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
          >
            <Text className="text-accent">Ещё раз</Text>
          </Pressable>
        </View>
      )}

      <View className="flex-1 items-center justify-end pb-6">
        {phase === 'recording' && (
          <Text variant="caption" className="mb-2 text-danger">
            Запись — нажми, чтобы остановить
          </Text>
        )}
        {(phase === 'idle' || phase === 'recording' || phase === 'processing') && (
          <RecordButton
            state={buttonState}
            level={level}
            onPress={() => {
              if (phase === 'recording') void finishRecording();
              else if (phase === 'idle') void startRecording();
            }}
          />
        )}
        {phase === 'idle' && onSkipPass && (
          <Pressable
            onPress={onSkipPass}
            accessibilityRole="button"
            hitSlop={8}
            className="mt-4"
            testID="rehearse-skip-pass"
          >
            <Text variant="caption">Закончить без второго прохода</Text>
          </Pressable>
        )}
        {phase === 'feedback' && (
          <View className="w-full gap-3">
            <View className="flex-row justify-center gap-3">
              <Pressable
                onPress={() => void startRecording()}
                accessibilityRole="button"
                accessibilityLabel="Записать ещё раз"
                className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 active:bg-surface-2"
              >
                <Ionicons name="mic-outline" size={16} color={tokens.accent} />
                <Text variant="caption" className="text-accent">
                  Ещё раз
                </Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => onDone(bestRef.current)}
              accessibilityRole="button"
              testID="rehearse-next"
              className="flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3.5 active:opacity-80"
            >
              <Text className="font-ui-medium text-bg">Дальше</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function SummaryCard({
  summary,
  sentences,
  bottomInset,
  onDone,
}: {
  summary: RehearsalSummary;
  sentences: readonly string[];
  bottomInset: number;
  onDone: () => void;
}) {
  const { tokens } = useAppTheme();
  const fmt = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('ru-RU')} %`);
  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="flex-grow gap-5 px-6 pt-8"
      contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
      testID="rehearse-summary"
    >
      <View className="items-center gap-1">
        <Text variant="caption" className="uppercase tracking-wider">
          Репетиция закончена
        </Text>
        <RNText
          className="font-ui-bold text-5xl"
          style={{
            color: summary.score >= PRONUNCIATION_PASS_SCORE ? tokens.success : tokens.text,
          }}
          testID="rehearse-summary-score"
        >
          {summary.score}%
        </RNText>
        <Text variant="muted">по памяти · {sentences.length} предл.</Text>
      </View>
      <View className="flex-row gap-3">
        <Stat label="С текстом" value={fmt(summary.withText)} />
        <Stat label="Без текста" value={fmt(summary.withoutText)} />
      </View>
      {summary.weakest.length > 0 ? (
        <View className="gap-2 rounded-2xl border border-border bg-surface px-4 py-4">
          <Text className="font-ui-medium">Слабые места</Text>
          {summary.weakest.slice(0, 5).map((i) => (
            <Text key={i} className="font-reading text-base leading-6">
              {i + 1}. {sentences[i]}
            </Text>
          ))}
        </View>
      ) : (
        <View className="rounded-2xl border border-border bg-surface px-4 py-4">
          <Text variant="muted">Все предложения узнаны — можно идти на экзамен.</Text>
        </View>
      )}
      <View className="flex-1" />
      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        className="flex-row items-center justify-center rounded-xl bg-accent py-3.5 active:opacity-80"
      >
        <Text className="font-ui-medium text-bg">Готово</Text>
      </Pressable>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center gap-0.5 rounded-xl border border-border bg-surface px-3 py-3">
      <Text variant="caption">{label}</Text>
      <Text className="font-ui-bold text-lg">{value}</Text>
    </View>
  );
}
