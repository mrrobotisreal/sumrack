import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { useStudyAmbience, useQuietStudy } from '@/features/ambient-audio/activity';
import { useAppTheme } from '@/theme/use-app-theme';

import { currentSubtest, isPlaceholderKind, itemTotal } from './engine/exam-machine';
import { devDurationOverrideSec } from './engine/rules';
import { useExamRun } from './engine/use-exam-run';
import { ExamBreakScreen, ExamPlaceholderScreen } from './exam-break-screen';
import { ExamInstructionScreen } from './exam-instruction-screen';
import { ExamObjectiveScreen } from './exam-objective-screen';

/**
 * The mock runner route body (T71) — `/exam/run/[attemptId]`, full-screen,
 * gesture disabled. A thin switch over `useExamRun`: it renders the phase the
 * pure engine is in (instructions → objective runner → break → placeholder)
 * and forwards user intent as engine events. Quit = confirm → «Сохранить и
 * выйти» (stays resumable) / «Завершить попытку» (abandon).
 */
export function ExamRunScreen() {
  const { attemptId, devDurationSec } = useLocalSearchParams<{
    attemptId: string;
    devDurationSec?: string;
  }>();
  const router = useRouter();
  const { tokens } = useAppTheme();
  const run = useExamRun(attemptId, devDurationSec);
  // A mock never plays the ambient bed while the candidate listens; reading/lexgram keep the quiet education bed.
  const state = run.state;
  const subtest =
    run.exam && state ? currentSubtest({ exam: run.exam, breakBetween: false }, state) : undefined;
  const listeningNow = subtest?.kind === 'listening' && state?.phase === 'running';
  useStudyAmbience(!listeningNow, 'education');
  useQuietStudy(!!listeningNow);

  const quit = React.useCallback(() => {
    Alert.alert('Выйти из экзамена?', 'Прогресс сохранится, таймер продолжит идти по часам.', [
      { text: 'Продолжить', style: 'cancel' },
      {
        text: 'Сохранить и выйти',
        onPress: () => router.back(),
      },
      {
        text: 'Завершить попытку',
        style: 'destructive',
        onPress: () => {
          run.send({ type: 'ABANDON' });
          router.back();
        },
      },
    ]);
  }, [router, run]);

  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      quit();
      return true;
    });
    return () => sub.remove();
  }, [quit]);

  if (run.load.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (run.load.status === 'error' || !run.exam || !state || !run.attempt) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <QueryError
          message={run.load.status === 'error' ? run.load.message : 'Не удалось открыть экзамен.'}
          onRetry={() => router.back()}
        />
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
        >
          <Text className="text-accent">Назад</Text>
        </Pressable>
      </View>
    );
  }
  if (run.finishing || state.phase === 'done') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg" testID="exam-finishing">
        <ActivityIndicator color={tokens.accent} />
        <Text variant="muted">Считаем результат…</Text>
      </View>
    );
  }
  if (state.phase === 'abandoned') return <View className="flex-1 bg-bg" />;

  const cur = state.subtests[state.current]!;
  const def = subtest!;

  if (state.phase === 'break') {
    const next = state.subtests[state.current + 1];
    const nextDef = run.exam.subtests.find((s) => s.id === next?.id);
    if (next && nextDef) {
      return (
        <ExamBreakScreen
          nextKind={next.kind}
          nextTitle={nextDef.title.ru}
          nextMin={nextDef.durationMin}
          onContinue={() => run.send({ type: 'BREAK_DONE' })}
          onQuit={quit}
        />
      );
    }
  }
  if (state.phase === 'placeholder' || isPlaceholderKind(cur.kind)) {
    return (
      <ExamPlaceholderScreen
        titleRu={def.title.ru}
        kind={cur.kind}
        onSkip={() => run.send({ type: 'SUBMIT_SUBTEST', now: Date.now() })}
        onQuit={quit}
      />
    );
  }
  if (state.phase === 'instructions') {
    const missing =
      def.kind === 'listening' && run.listening !== null && run.audioMissing.length > 0;
    const checking = def.kind === 'listening' && run.listening === null;
    return (
      <ExamInstructionScreen
        subtest={def}
        itemCount={itemTotal(def)}
        showEnglish={run.prefs.showEnglishInstructions}
        durationOverrideSec={devDurationOverrideSec(
          devDurationSec,
          typeof __DEV__ !== 'undefined' && __DEV__,
        )}
        blocked={
          missing
            ? 'Скачай аудио по Wi-Fi: без файла экзамен не звучит. Подключись к Wi-Fi, синхронизируй пакет и вернись.'
            : checking
              ? 'Проверяем аудио…'
              : null
        }
        onBegin={() => run.send({ type: 'BEGIN', now: Date.now() })}
        onSkip={() => run.send({ type: 'SUBMIT_SUBTEST', now: Date.now() })}
        onQuit={quit}
      />
    );
  }

  return (
    <ExamObjectiveScreen
      key={cur.id}
      packId={run.attempt.packId}
      subtest={def}
      run={state}
      cursor={cur}
      remainingMs={run.remainingMs}
      prefs={run.prefs}
      audioByKey={run.listening?.byKey ?? null}
      onAnswer={(itemId, answer) => run.send({ type: 'ANSWER', itemId, answer, now: Date.now() })}
      onFlag={(itemId) => run.send({ type: 'FLAG', itemId })}
      onGoto={(flat) => run.send({ type: 'GOTO', flat })}
      onNext={() => run.send({ type: 'NEXT', now: Date.now() })}
      onAudioEnded={() => run.send({ type: 'AUDIO_ENDED', now: Date.now() })}
      onSubmit={() => run.send({ type: 'SUBMIT_SUBTEST', now: Date.now() })}
      onQuit={quit}
      onLookup={() => undefined}
    />
  );
}
