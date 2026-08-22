import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Alert, BackHandler } from 'react-native';

import { repos } from '@/db';
import type { CardRow, Grade } from '@/db/repositories/reviews';
import { track } from '@/services/analytics';

import { ratingCountsAsCorrect } from '../mapping';
import type { SessionResult } from '../session-screen';

export type GamePhase = 'loading' | 'empty' | 'playing' | 'summary';

/**
 * The shared standalone-game session flow (T13) — the same skeleton T06's
 * SessionScreen and T12's pronunciation screen carry inline: build → play →
 * grade-and-persist immediately (quitting loses nothing already graded) →
 * game_sessions row → summary, with quit-confirm and hardware-back wiring.
 * Extracted rather than duplicated a third and fourth time; the older
 * screens are left as-is (T06/T12 verified code).
 */
export function useGameSession<T>(opts: {
  /** game_sessions.mode. */
  mode: string;
  /** Narrow analytics prefix — keeps the template-literal event names inside AnalyticsEvent. */
  trackPrefix: 'cloze' | 'sb';
  resultMode: SessionResult['mode'];
  build: () => Promise<T[]>;
}) {
  const { mode, trackPrefix, resultMode, build } = opts;
  const router = useRouter();
  const queryClient = useQueryClient();

  const [phase, setPhase] = React.useState<GamePhase>('loading');
  const [items, setItems] = React.useState<T[]>([]);
  const [index, setIndex] = React.useState(0);
  const [finalResults, setFinalResults] = React.useState<SessionResult[]>([]);
  const resultsRef = React.useRef<SessionResult[]>([]);
  const gameSessionIdRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef(0);
  const finishedRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await build();
      if (cancelled) return;
      if (session.length === 0) {
        track(`${trackPrefix}_session_empty`);
        setPhase('empty');
        return;
      }
      const row = await repos.stats.startGameSession(mode);
      if (cancelled) return;
      gameSessionIdRef.current = row.id;
      startedAtRef.current = Date.now();
      setItems(session);
      setPhase('playing');
      track(`${trackPrefix}_session_started`, { size: session.length });
    })();
    return () => {
      cancelled = true;
    };
    // build is stable per mount (screens pass a module fn or memoized closure).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistSessionEnd = React.useCallback(() => {
    const results = resultsRef.current;
    const sessionId = gameSessionIdRef.current;
    if (sessionId) {
      void repos.stats.finishGameSession(sessionId, {
        itemCount: results.length,
        correctCount: results.filter((r) => r.correct).length,
      });
    }
    void queryClient.invalidateQueries({ queryKey: ['due-count'] });
    void queryClient.invalidateQueries({ queryKey: ['daily-activity'] });
    void queryClient.invalidateQueries({ queryKey: ['review-state'] });
  }, [queryClient]);

  /** Grade the current item's card and advance (or finish). */
  const grade = React.useCallback(
    (card: CardRow, rating: Grade, extraProps: Record<string, string | number | boolean>) => {
      const correct = ratingCountsAsCorrect(rating);
      resultsRef.current.push({ cardId: card.id, rating, correct, mode: resultMode });
      void repos.reviews
        .gradeCard(card.id, rating)
        .then(() => repos.stats.bumpDailyActivity({ reviewsDone: 1 }))
        .catch((err) => console.error(`[${mode}] grade failed`, err));
      track(`${trackPrefix}_item_graded`, { rating, ...extraProps });

      const next = index + 1;
      if (next < items.length) {
        setIndex(next);
        return;
      }
      if (finishedRef.current) return;
      finishedRef.current = true;
      track(`${trackPrefix}_session_finished`, {
        itemCount: resultsRef.current.length,
        correctCount: resultsRef.current.filter((r) => r.correct).length,
        durationMs: Date.now() - startedAtRef.current,
      });
      persistSessionEnd();
      setFinalResults([...resultsRef.current]);
      setPhase('summary');
    },
    [index, items.length, mode, trackPrefix, resultMode, persistSessionEnd],
  );

  const quit = React.useCallback(() => {
    if (phase !== 'playing') {
      router.back();
      return;
    }
    Alert.alert(
      'End session?',
      `${resultsRef.current.length} graded so far — those are already saved.`,
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'End session',
          style: 'destructive',
          onPress: () => {
            track(`${trackPrefix}_session_abandoned`, {
              completed: resultsRef.current.length,
              total: items.length,
            });
            persistSessionEnd();
            router.back();
          },
        },
      ],
    );
  }, [phase, items.length, trackPrefix, persistSessionEnd, router]);

  React.useEffect(() => {
    if (phase !== 'playing') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      quit();
      return true;
    });
    return () => sub.remove();
  }, [phase, quit]);

  return { phase, items, index, entry: items[index], finalResults, grade, quit, router };
}
