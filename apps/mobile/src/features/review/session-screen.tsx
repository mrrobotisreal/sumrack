import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { Grade } from '@/db/repositories/reviews';
import type { ReviewSource } from '@/db/schema';
import { onSessionEnded, recordReviewOutcome } from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

import { FlashcardView } from './flashcard-view';
import { mcOutcomeToRating, ratingCountsAsCorrect } from './mapping';
import { McView } from './mc-view';
import { buildSession, type SessionItem } from './session';
import { SessionShell } from './session-shell';
import { SummaryView } from './summary-view';

export interface SessionResult {
  cardId: string;
  rating: Grade;
  correct: boolean;
  /**
   * T06 modes plus 'pronunciation' (T12), the T13 games, and 'listening' (T14) — SummaryView is mode-agnostic.
   * Every value is also a `ReviewSource` (T50): the mode is written to `review_log.source` verbatim.
   */
  mode: SessionItem['mode'] | 'pronunciation' | 'cloze' | 'sentence-builder' | 'listening';
}

// T50 compile-time guard: a mode that is not a ReviewSource must be mapped, not passed through.
const _sessionModeIsReviewSource: SessionResult['mode'] extends ReviewSource ? true : never = true;
void _sessionModeIsReviewSource;

type Phase = 'loading' | 'empty' | 'playing' | 'summary' | 'error';

/**
 * The daily review session (T06: mixed flashcards + MC; T13/T14 add modes).
 * Owns the present → grade → reschedule → persist loop: every grade goes
 * through reviews.gradeCard (FSRS + review_log) and bumps
 * daily_activity.reviewsDone immediately, so quitting mid-session loses
 * nothing already graded.
 */
export function SessionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();

  const [phase, setPhase] = React.useState<Phase>('loading');
  const [items, setItems] = React.useState<SessionItem[]>([]);
  const [index, setIndex] = React.useState(0);
  /** Rendered by the summary; resultsRef is the accumulator event handlers use. */
  const [finalResults, setFinalResults] = React.useState<SessionResult[]>([]);
  const resultsRef = React.useRef<SessionResult[]>([]);
  const gameSessionIdRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef(0);
  const finishedRef = React.useRef(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setPhase('loading');
      try {
        const session = await buildSession(repos);
        if (cancelled) return;
        if (session.length === 0) {
          track('review_session_empty');
          setPhase('empty');
          return;
        }
        const row = await repos.stats.startGameSession('review-mixed');
        if (cancelled) return;
        gameSessionIdRef.current = row.id;
        startedAtRef.current = Date.now();
        setItems(session);
        setPhase('playing');
        track('review_session_started', {
          size: session.length,
          mc: session.filter((s) => s.mode === 'mc').length,
        });
      } catch (err) {
        if (cancelled) return;
        logError('manual', err);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = React.useCallback(() => setAttempt((a) => a + 1), []);

  const invalidateAfterReviews = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['due-count'] });
    void queryClient.invalidateQueries({ queryKey: ['daily-activity'] });
    void queryClient.invalidateQueries({ queryKey: ['review-state'] });
  }, [queryClient]);

  const persistSessionEnd = React.useCallback(() => {
    const results = resultsRef.current;
    const sessionId = gameSessionIdRef.current;
    if (sessionId) {
      void repos.stats.finishGameSession(sessionId, {
        itemCount: results.length,
        correctCount: results.filter((r) => r.correct).length,
      });
    }
    // Count-based achievement sweep (mastered/bank/level) once per session (T19).
    void onSessionEnded().catch((err) => console.warn('[review] sweep failed', err));
    invalidateAfterReviews();
  }, [invalidateAfterReviews]);

  const grade = React.useCallback(
    (entry: SessionItem, rating: Grade, correct: boolean, durationMs: number) => {
      resultsRef.current.push({ cardId: entry.card.id, rating, correct, mode: entry.mode });
      // Fire-and-forget: grading must never stall the flow (offline, local DB).
      // recordReviewOutcome bumps reviewsDone + XP and evaluates goal/streak (T19).
      void repos.reviews
        .gradeCard(entry.card.id, rating, { durationMs, source: entry.mode })
        .then(() => recordReviewOutcome(rating))
        .catch((err) => console.error('[review] grade failed', err));
      track('review_graded', {
        direction: entry.direction,
        mode: entry.mode,
        rating,
        durationMs,
        // T50: the activity that produced the grade (= review_log.source).
        gradeSource: entry.mode,
      });

      const next = index + 1;
      if (next < items.length) {
        setIndex(next);
        return;
      }
      if (finishedRef.current) return;
      finishedRef.current = true;
      track('review_session_finished', {
        itemCount: resultsRef.current.length,
        correctCount: resultsRef.current.filter((r) => r.correct).length,
        durationMs: Date.now() - startedAtRef.current,
      });
      persistSessionEnd();
      setFinalResults([...resultsRef.current]);
      setPhase('summary');
    },
    [index, items.length, persistSessionEnd],
  );

  const quit = React.useCallback(() => {
    if (phase !== 'playing') {
      router.back();
      return;
    }
    Alert.alert(
      'End session?',
      `${resultsRef.current.length} graded so far — those reviews are already saved.`,
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'End session',
          style: 'destructive',
          onPress: () => {
            track('review_session_abandoned', {
              completed: resultsRef.current.length,
              total: items.length,
            });
            persistSessionEnd();
            router.back();
          },
        },
      ],
    );
  }, [phase, items.length, persistSessionEnd, router]);

  // Android hardware back = the same confirm, never a silent pop.
  React.useEffect(() => {
    if (phase !== 'playing') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      quit();
      return true;
    });
    return () => sub.remove();
  }, [phase, quit]);

  if (phase === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <QueryError
          message="Couldn't build this session — something went wrong reading the database."
          onRetry={retry}
        />
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="min-h-12 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
        >
          <Text className="text-accent">Back</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'empty') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Text className="font-reading text-xl">Всё повторено</Text>
        <Text variant="muted" className="text-center">
          Nothing is due right now. Read something — new words become reviews.
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

  if (phase === 'summary') {
    return <SummaryView results={finalResults} onDone={() => router.back()} />;
  }

  const entry = items[index]!;
  return (
    <SessionShell current={index} total={items.length} onQuit={quit}>
      {entry.mode === 'mc' && entry.choices ? (
        <McView
          key={entry.card.id}
          entry={entry}
          onAnswer={(correct, durationMs) =>
            grade(entry, mcOutcomeToRating(correct, durationMs), correct, durationMs)
          }
        />
      ) : (
        <FlashcardView
          key={entry.card.id}
          entry={entry}
          onGrade={(rating, durationMs) =>
            grade(entry, rating, ratingCountsAsCorrect(rating), durationMs)
          }
        />
      )}
    </SessionShell>
  );
}
