import type { ExerciseSpec } from '@sumrak/schema';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { recordUnitQuizFirstPass } from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { ExerciseRunner } from './exercises/exercise-runner';
import { scoreOutcomes, passes, type SpecOutcome } from './exercises/scoring';
import { buildUnitQuizForPack } from './exercises/unit-quiz';
import { getPassThreshold } from './threshold';
import { pathQueryKey } from './use-path';

type Phase = 'loading' | 'empty' | 'playing' | 'result';

interface QuizResult {
  scorePercent: number;
  correct: number;
  scored: number;
  passed: boolean;
  threshold: number;
}

/**
 * Unit quiz (T17): ~10 exercises GENERATED from the unit's own sentences,
 * served through the shared ExerciseRunner. Score-only — no FSRS writes
 * (recorded decision); outcome lands in unit_progress (best score + first
 * pass) and a game_sessions row for the record.
 */
export function QuizScreen({ packId }: { packId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [specs, setSpecs] = React.useState<ExerciseSpec[]>([]);
  const [result, setResult] = React.useState<QuizResult | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const built = await buildUnitQuizForPack(repos, packId);
      if (cancelled) return;
      if (built.length < 4) {
        setPhase('empty');
        return;
      }
      const row = await repos.stats.startGameSession('unit-quiz');
      if (cancelled) return;
      sessionIdRef.current = row.id;
      setSpecs(built);
      setPhase('playing');
      track('unit_quiz_started', { packId, size: built.length });
    })();
    return () => {
      cancelled = true;
    };
  }, [packId]);

  const finish = React.useCallback(
    async (outcomes: SpecOutcome[], durationMs: number) => {
      const score = scoreOutcomes(outcomes);
      const threshold = await getPassThreshold();
      const passedQuiz = passes(score, threshold);
      const before = await repos.path.getUnitProgress(packId);
      await repos.path.recordQuizResult(packId, score.scorePercent, passedQuiz);
      if (passedQuiz && before?.quizPassedAt == null) {
        void recordUnitQuizFirstPass(); // T19 XP, first pass only
      }
      if (sessionIdRef.current) {
        await repos.stats.finishGameSession(sessionIdRef.current, {
          itemCount: score.scored,
          correctCount: score.correct,
          detail: { packId, scorePercent: score.scorePercent, passed: passedQuiz, durationMs },
        });
      }
      track('unit_quiz_finished', {
        packId,
        scorePercent: score.scorePercent,
        passed: passedQuiz,
        durationMs,
      });
      void queryClient.invalidateQueries({ queryKey: pathQueryKey });
      setResult({
        scorePercent: score.scorePercent,
        correct: score.correct,
        scored: score.scored,
        passed: passedQuiz,
        threshold,
      });
      setPhase('result');
    },
    [packId, queryClient],
  );

  if (phase === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (phase === 'empty') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Text className="text-center font-reading text-xl">Не из чего собрать квиз</Text>
        <Text variant="muted" className="text-center">
          This unit&apos;s content isn&apos;t installed (or has too few annotated words) to build a
          quiz.
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="mt-2 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
        >
          <Text className="text-accent">Back</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'result' && result) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
        <Text variant="caption" className="uppercase tracking-wider">
          Unit quiz
        </Text>
        <RNText
          className="font-ui-bold text-6xl"
          style={{ color: result.passed ? tokens.success : tokens.text }}
        >
          {Math.round(result.scorePercent)}%
        </RNText>
        <Text variant="muted" className="text-center">
          {result.correct}/{result.scored} correct · pass mark {Math.round(result.threshold * 100)}%
        </Text>
        <Text className="text-center font-reading text-xl">
          {result.passed
            ? 'Пройдено. The unit remembers you now.'
            : 'Не в этот раз — reread, review, return.'}
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="mt-2 w-full items-center rounded-xl bg-accent py-3.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-bg">Done</Text>
        </Pressable>
        {!result.passed && (
          <Pressable
            onPress={() => {
              setResult(null);
              setSpecs([]);
              setPhase('loading');
              void buildUnitQuizForPack(repos, packId).then(async (built) => {
                const row = await repos.stats.startGameSession('unit-quiz');
                sessionIdRef.current = row.id;
                setSpecs(built);
                setPhase('playing');
                track('unit_quiz_started', { packId, size: built.length, retake: true });
              });
            }}
            accessibilityRole="button"
            className="w-full items-center rounded-xl border border-border bg-surface py-3 active:bg-surface-2"
          >
            <Text className="text-accent">Try again</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <ExerciseRunner
      specs={specs}
      trackPrefix="unit_quiz"
      onQuit={() => router.back()}
      onFinish={(outcomes, durationMs) => void finish(outcomes, durationMs)}
    />
  );
}
