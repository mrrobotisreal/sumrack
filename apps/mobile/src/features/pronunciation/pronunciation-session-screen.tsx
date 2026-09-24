import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, View } from 'react-native';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import {
  onSessionEnded,
  recordPronunciationScore,
  recordReviewOutcome,
} from '@/features/motivation/service';
import type { SessionResult } from '@/features/review/session-screen';
import { SessionShell } from '@/features/review/session-shell';
import { SummaryView } from '@/features/review/summary-view';
import { ratingCountsAsCorrect } from '@/features/review/mapping';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

import { isAsrInstalled } from './asr-manager';
import { preloadAsr } from './asr-service';
import { PronunciationView } from './pronunciation-view';
import { pronunciationScoreToRating } from './scoring';
import { buildPronunciationSession, type PronunciationItem } from './session';

type Phase = 'loading' | 'needs-model' | 'empty' | 'playing' | 'summary' | 'error';

/**
 * The standalone 10-phrase pronunciation session (T12, design §7.3 mode 6),
 * launched from Today. Same skeleton as T06's SessionScreen: grade → persist
 * immediately (quitting loses nothing already graded), game_sessions row,
 * quit-with-confirm. Grades land on the `production` direction via the
 * standard reviews.gradeCard pipeline.
 */
export function PronunciationSessionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tokens } = useAppTheme();
  // T18 "practice now": focused sessions serve exactly these items' cards.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const focusRef = React.useRef(focus ? focus.split(',').filter(Boolean) : undefined);

  const [phase, setPhase] = React.useState<Phase>('loading');
  const [items, setItems] = React.useState<PronunciationItem[]>([]);
  const [index, setIndex] = React.useState(0);
  const [finalResults, setFinalResults] = React.useState<SessionResult[]>([]);
  const resultsRef = React.useRef<SessionResult[]>([]);
  /** Per-item best scores → game_sessions.detail (T18: the dashboard's
   *  weakest-pronunciation list reads these; T12 never recorded them). */
  const scoresRef = React.useRef<{ bankItemId: string; score: number }[]>([]);
  const gameSessionIdRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef(0);
  const finishedRef = React.useRef(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setPhase('loading');
      try {
        if (!isAsrInstalled()) {
          track('pron_session_needs_model');
          setPhase('needs-model');
          return;
        }
        preloadAsr(); // warm the recognizer while the first prompt renders
        const session = await buildPronunciationSession(repos, {
          focusItemIds: focusRef.current,
        });
        if (cancelled) return;
        if (session.length === 0) {
          track('pron_session_empty');
          setPhase('empty');
          return;
        }
        const row = await repos.stats.startGameSession('pronunciation');
        if (cancelled) return;
        gameSessionIdRef.current = row.id;
        startedAtRef.current = Date.now();
        setItems(session);
        setPhase('playing');
        track('pron_session_started', { size: session.length });
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
        detail: { scores: scoresRef.current },
      });
    }
    // Count-based achievement sweep (mastered/bank/level) once per session (T19).
    void onSessionEnded().catch((err) => console.warn('[pron] sweep failed', err));
    invalidateAfterReviews();
  }, [invalidateAfterReviews]);

  const complete = React.useCallback(
    (entry: PronunciationItem, bestScore: number, attempts: number) => {
      const rating = pronunciationScoreToRating(bestScore);
      const correct = ratingCountsAsCorrect(rating);
      resultsRef.current.push({ cardId: entry.card.id, rating, correct, mode: 'pronunciation' });
      scoresRef.current.push({ bankItemId: entry.item.id, score: bestScore });
      // recordReviewOutcome bumps reviewsDone + XP and evaluates goal/streak;
      // a perfect best score also feeds the pron-perfect achievement (T19).
      void repos.reviews
        .gradeCard(entry.card.id, rating, { source: 'pronunciation' })
        .then(() => recordReviewOutcome(rating))
        .then(() => recordPronunciationScore(bestScore))
        .catch((err) => console.error('[pron] grade failed', err));
      track('pron_item_graded', {
        rating,
        bestScore,
        attempts,
        source: entry.source,
        bankItemId: entry.item.id,
        gradeSource: 'pronunciation',
      });

      const next = index + 1;
      if (next < items.length) {
        setIndex(next);
        return;
      }
      if (finishedRef.current) return;
      finishedRef.current = true;
      track('pron_session_finished', {
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
      `${resultsRef.current.length} graded so far — those are already saved.`,
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'End session',
          style: 'destructive',
          onPress: () => {
            track('pron_session_abandoned', {
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

  if (phase === 'needs-model') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Ionicons name="cloud-download-outline" size={40} color={tokens.textMuted} />
        <Text className="text-center font-ui-medium text-lg">Speech recognition needed</Text>
        <Text variant="muted" className="text-center">
          Pronunciation practice runs fully offline, but the Russian recognition model (~60 MB) has
          to be downloaded once in Settings → Voices &amp; speech.
        </Text>
        <Pressable
          onPress={() => {
            router.back();
            router.push('/settings');
          }}
          accessibilityRole="button"
          className="mt-2 rounded-full bg-accent px-5 py-2.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-bg">Open settings</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'empty') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Text className="font-reading text-xl">Нечего произносить</Text>
        <Text variant="muted" className="text-center">
          No speaking practice is due right now. Words and phrases you collect become pronunciation
          prompts.
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
      <PronunciationView
        key={entry.card.id}
        entry={entry}
        onComplete={(bestScore, attempts) => complete(entry, bestScore, attempts)}
      />
    </SessionShell>
  );
}
