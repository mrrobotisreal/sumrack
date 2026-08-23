import { Ionicons } from '@expo/vector-icons';
import { ExerciseSpecSchema, type ExerciseSpec } from '@sumrak/schema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text as RNText,
  Vibration,
  View,
} from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { recordCheckpointPassed } from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { ExerciseRunner } from './exercises/exercise-runner';
import { passes, scoreOutcomes, type SpecOutcome } from './exercises/scoring';
import { getPassThreshold } from './threshold';
import { pathQueryKey } from './use-path';

type Phase = 'intro' | 'playing' | 'result';

interface CheckpointOutcome {
  scorePercent: number;
  correct: number;
  scored: number;
  skipped: number;
  passed: boolean;
  threshold: number;
  firstPass: boolean;
}

/**
 * Checkpoint runner (T17, design §7.5): the AUTHORED ExerciseSpec[] of a
 * checkpoint pack, an intro screen (stakes + best result), scoring against
 * the configurable pass threshold, a `checkpoint_results` row per attempt,
 * and a restrained ember celebration on the level milestone. Retakes are
 * always free; nothing is ever locked behind it.
 */
export function CheckpointScreen({ packId }: { packId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();
  const [phase, setPhase] = React.useState<Phase>('intro');
  const [outcome, setOutcome] = React.useState<CheckpointOutcome | null>(null);

  const data = useQuery({
    queryKey: ['checkpoint', packId],
    queryFn: async () => {
      const pack = await repos.content.getPack(packId);
      const specRows = await repos.content.listExerciseSpecs(packId);
      // Zod gate at the DB boundary: specs were validated at import, but the
      // runner trusts nothing it didn't parse (DoD).
      const specs: ExerciseSpec[] = specRows.map((r) => ExerciseSpecSchema.parse(r.spec));
      const results = await repos.stats.listCheckpointResults();
      const own = results.filter((r) => r.checkpointPackId === packId);
      const best = own.reduce<number | null>(
        (acc, r) => (acc == null || r.scorePercent > acc ? r.scorePercent : acc),
        null,
      );
      return {
        pack,
        specs,
        best,
        everPassed: own.some((r) => r.passed),
        threshold: await getPassThreshold(),
      };
    },
  });

  const finish = React.useCallback(
    async (outcomes: SpecOutcome[], durationMs: number) => {
      const score = scoreOutcomes(outcomes);
      const threshold = await getPassThreshold();
      const passedNow = passes(score, threshold);
      const previouslyPassed = data.data?.everPassed ?? false;
      await repos.stats.recordCheckpointResult({
        checkpointPackId: packId,
        scorePercent: score.scorePercent,
        passed: passedNow,
        detail: {
          threshold,
          durationMs,
          skipped: score.skipped,
          outcomes: outcomes.map((o) => ({
            specId: o.specId,
            kind: o.kind,
            correct: o.correct,
            skipped: o.skipped,
          })),
        },
      });
      track('checkpoint_finished', {
        packId,
        scorePercent: score.scorePercent,
        passed: passedNow,
        skipped: score.skipped,
        durationMs,
      });
      track(passedNow ? 'checkpoint_passed' : 'checkpoint_failed', {
        packId,
        scorePercent: score.scorePercent,
      });
      if (passedNow) {
        // T19: first-pass XP + first-checkpoint achievement (unlock is idempotent).
        void recordCheckpointPassed(!previouslyPassed);
      }
      void queryClient.invalidateQueries({ queryKey: pathQueryKey });
      setOutcome({
        scorePercent: score.scorePercent,
        correct: score.correct,
        scored: score.scored,
        skipped: score.skipped,
        passed: passedNow,
        threshold,
        firstPass: passedNow && !previouslyPassed,
      });
      setPhase('result');
    },
    [packId, queryClient, data.data?.everPassed],
  );

  if (data.isLoading || !data.data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  const { pack, specs, best, threshold } = data.data;

  if (!pack || specs.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Ionicons name="flag-outline" size={36} color={tokens.textMuted} />
        <Text variant="muted" className="text-center">
          This checkpoint isn&apos;t installed. Sync content in Библиотека first.
        </Text>
      </View>
    );
  }

  if (phase === 'intro') {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
        <Ionicons name="flag-outline" size={36} color={tokens.accent} />
        <RNText className="text-center font-reading text-3xl text-text">{pack.titleRu}</RNText>
        <Text variant="muted" className="text-center">
          {pack.titleEn} · {specs.length} exercises · pass mark {Math.round(threshold * 100)}%
        </Text>
        {best != null && <Text variant="caption">Best so far: {Math.round(best)}%</Text>}
        <Text variant="muted" className="text-center">
          Leaving mid-test discards the attempt. Retakes are always free.
        </Text>
        <Pressable
          onPress={() => {
            track('checkpoint_started', { packId, size: specs.length });
            setPhase('playing');
          }}
          accessibilityRole="button"
          className="mt-2 w-full items-center rounded-xl bg-accent py-3.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-bg">Begin</Text>
        </Pressable>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Text variant="caption">Not yet</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'result' && outcome) {
    return outcome.passed ? (
      <CheckpointPassed
        pack={{ titleRu: pack.titleRu, level: pack.level }}
        outcome={outcome}
        onDone={() => router.back()}
      />
    ) : (
      <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
        <RNText className="font-ui-bold text-6xl text-text">
          {Math.round(outcome.scorePercent)}%
        </RNText>
        <Text variant="muted" className="text-center">
          {outcome.correct}/{outcome.scored} correct
          {outcome.skipped > 0 ? ` · ${outcome.skipped} skipped` : ''} · pass mark{' '}
          {Math.round(outcome.threshold * 100)}%
        </Text>
        <Text className="text-center font-reading text-xl">
          Ещё рано. The door stays where it is — come back stronger.
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="mt-2 w-full items-center rounded-xl bg-accent py-3.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-bg">Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ExerciseRunner
      specs={specs}
      trackPrefix="checkpoint"
      onQuit={() => router.back()}
      onFinish={(outcomes, durationMs) => void finish(outcomes, durationMs)}
    />
  );
}

/**
 * The milestone moment (design §7.5 "it should feel like a moment", §10:
 * one short full-screen ember pulse — no confetti, ever).
 */
function CheckpointPassed({
  pack,
  outcome,
  onDone,
}: {
  pack: { titleRu: string; level: string };
  outcome: CheckpointOutcome;
  onDone: () => void;
}) {
  const { tokens } = useAppTheme();
  const [pulse] = React.useState(() => new Animated.Value(0));

  React.useEffect(() => {
    Vibration.vibrate(12);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]).start();
  }, [pulse]);

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
      <Animated.View
        pointerEvents="none"
        className="absolute inset-0"
        style={{
          backgroundColor: tokens.accent,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }),
        }}
      />
      <Ionicons name="flame" size={44} color={tokens.accent} />
      <Text variant="caption" className="uppercase tracking-wider">
        Milestone
      </Text>
      <RNText className="text-center font-reading text-3xl text-text">{pack.titleRu}</RNText>
      <RNText className="font-ui-bold text-6xl" style={{ color: tokens.success }}>
        {Math.round(outcome.scorePercent)}%
      </RNText>
      <Text variant="muted" className="text-center">
        {outcome.correct}/{outcome.scored} correct
        {outcome.skipped > 0 ? ` · ${outcome.skipped} skipped` : ''}
      </Text>
      <Text className="text-center font-reading text-xl">
        {outcome.firstPass
          ? `Уровень ${pack.level} пройден. The path continues in the dark.`
          : 'Пройдено снова — сильнее, чем раньше.'}
      </Text>
      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        className="mt-3 w-full items-center rounded-xl bg-accent py-3.5 active:opacity-80"
      >
        <Text className="font-ui-medium text-bg">Continue</Text>
      </Pressable>
    </View>
  );
}
