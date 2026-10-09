import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { TypingCandidateRow } from '@/db/repositories/bank';
import { evaluateMotivation, onSessionEnded } from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  computeTypingStats,
  judgeTypedWord,
  pickNextWord,
  ROUND_MS,
  type TypingAttempt,
} from './engine';
import {
  finishTypingRound,
  loadTypingStats,
  startTypingRound,
  type TypingRoundResult,
  type TypingServiceDeps,
} from './service';
import type { TypingStats } from './stats';

/**
 * The typing trainer screen (T40, route `/games/typing`). A 2-minute burst:
 * a Russian word, its English gloss as context, type it, Space or Enter.
 *
 * Decisions recorded here (not in the ticket):
 * - The clock starts at the Start tap, not the first keystroke.
 * - Shown word = bank lemma (the surface form would make the drill a
 *   grammar exercise, which is what the bank's word-forms game is for).
 * - At clock zero: an empty input ends the round at once; a partly typed
 *   word may still be submitted, and the round ends at that submit or after
 *   CLOSING_GRACE_MS, whichever comes first (so a stuck screen cannot hang).
 * - Quit with ≥ 1 attempt: the round is finished and saved as typed. Quit with
 *   0 attempts: the open game_sessions row is closed with zero counts, the
 *   same way the other game modes close theirs; no stats, XP or settings move.
 * - The round is FSRS-free: nothing in this file touches cards or review_log.
 */

/** Feedback (✓ / ✗ + the expected word) stays this long; typing never waits on it. */
const FEEDBACK_MS = 600;
/** Clock-zero grace for a partly typed word, see the decision list above. */
const CLOSING_GRACE_MS = 5_000;
/** Live header refresh (remaining seconds, WPM, accuracy). */
const TICK_MS = 250;
/** Fewer single-word candidates than this and there is no drill to run. */
const MIN_CANDIDATES = 5;

/** Production deps: the app-global repos + the motivation hooks. */
const DEPS: TypingServiceDeps = {
  repos,
  evaluate: evaluateMotivation,
  onSessionEnded,
};

type Phase = 'loading' | 'empty' | 'error' | 'ready' | 'playing' | 'finishing' | 'summary';

interface Feedback {
  correct: boolean;
  expected: string;
}

export function TypingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();

  const [phase, setPhase] = React.useState<Phase>('loading');
  const [candidates, setCandidates] = React.useState<TypingCandidateRow[]>([]);
  const [bests, setBests] = React.useState<TypingStats | null>(null);
  const [current, setCurrent] = React.useState<TypingCandidateRow | null>(null);
  const [typed, setTyped] = React.useState('');
  const [attempts, setAttempts] = React.useState<TypingAttempt[]>([]);
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  const [startedAt, setStartedAt] = React.useState(0);
  const [now, setNow] = React.useState(0);
  const [result, setResult] = React.useState<TypingRoundResult | null>(null);

  // Refs read by the timer and submit paths, so they never act on stale state.
  const candidatesRef = React.useRef<TypingCandidateRow[]>([]);
  const currentRef = React.useRef<TypingCandidateRow | null>(null);
  const typedRef = React.useRef('');
  const attemptsRef = React.useRef<TypingAttempt[]>([]);
  const recentRef = React.useRef<string[]>([]);
  const shownAtRef = React.useRef(0);
  const startedAtRef = React.useRef(0);
  const sessionIdRef = React.useRef<string | null>(null);
  const finishedRef = React.useRef(false);

  // Load the candidate pool and the lifetime bests once.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [rows, stats] = await Promise.all([
          repos.bank.listTypingCandidates(),
          loadTypingStats(repos),
        ]);
        if (cancelled) return;
        candidatesRef.current = rows;
        setCandidates(rows);
        setBests(stats);
        setPhase(rows.length < MIN_CANDIDATES ? 'empty' : 'ready');
      } catch (err) {
        if (cancelled) return;
        logError('manual', err);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const serve = React.useCallback((next: TypingCandidateRow) => {
    currentRef.current = next;
    shownAtRef.current = Date.now();
    recentRef.current.push(next.id);
    setCurrent(next);
  }, []);

  const start = React.useCallback(async () => {
    try {
      const first = pickNextWord(candidatesRef.current, []);
      if (!first) return;
      const sessionId = await startTypingRound(repos);
      sessionIdRef.current = sessionId;
      finishedRef.current = false;
      attemptsRef.current = [];
      recentRef.current = [];
      typedRef.current = '';
      setAttempts([]);
      setTyped('');
      setFeedback(null);
      setResult(null);
      const t0 = Date.now();
      startedAtRef.current = t0;
      setStartedAt(t0);
      setNow(t0);
      serve(first);
      setPhase('playing');
      track('typing_round_started', { candidates: candidatesRef.current.length });
    } catch (err) {
      logError('manual', err);
      setPhase('error');
    }
  }, [serve]);

  /** Ends the round: stats, XP, settings, game_sessions row, then the summary. */
  const finish = React.useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const sessionId = sessionIdRef.current;
    const elapsedMs = Math.min(Date.now() - startedAtRef.current, ROUND_MS);
    const finalAttempts = attemptsRef.current;
    setPhase('finishing');
    if (!sessionId) {
      setPhase('error');
      return;
    }
    void finishTypingRound(DEPS, sessionId, finalAttempts, elapsedMs)
      .then((res) => {
        track('typing_round_finished', {
          wpm: res.stats.wpm,
          accuracy: Math.round(res.stats.accuracy * 100),
          words: res.stats.words,
          correct: res.stats.correctCount,
          xp: res.xp,
          newBestWpm: res.newBest.wpm,
        });
        setResult(res);
        setPhase('summary');
      })
      .catch((err: unknown) => {
        logError('manual', err);
        setPhase('error');
      });
  }, []);

  /** Submit the word on screen (Enter, or Space after a non-empty word). */
  const submit = React.useCallback(
    (raw: string) => {
      const cur = currentRef.current;
      const word = raw.trim();
      if (!cur || !word || finishedRef.current) return;
      const t = Date.now();
      const attempt: TypingAttempt = {
        expected: cur.lemma,
        typed: word,
        correct: judgeTypedWord(cur.lemma, word),
        msTaken: t - shownAtRef.current,
      };
      attemptsRef.current = [...attemptsRef.current, attempt];
      setAttempts(attemptsRef.current);
      typedRef.current = '';
      setTyped('');
      setFeedback({ correct: attempt.correct, expected: cur.lemma });

      // The clock is up: the submitted word was the last one.
      if (t - startedAtRef.current >= ROUND_MS) {
        finish();
        return;
      }
      const next = pickNextWord(candidatesRef.current, recentRef.current);
      if (next) serve(next);
    },
    [finish, serve],
  );

  // Live clock — only while a round is running.
  React.useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [phase]);

  // Feedback fades on its own; a newer feedback replaces it.
  React.useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [feedback]);

  const elapsedMs = startedAt > 0 ? Math.min(Math.max(now - startedAt, 0), ROUND_MS) : 0;
  const timeUp = phase === 'playing' && startedAt > 0 && now - startedAt >= ROUND_MS;

  // Clock zero: an empty input ends the round now; a partly typed word gets
  // the grace window (submitting it ends the round too, see submit()).
  React.useEffect(() => {
    if (!timeUp) return;
    if (typedRef.current.trim() === '') {
      finish();
      return;
    }
    const id = setTimeout(finish, CLOSING_GRACE_MS);
    return () => clearTimeout(id);
  }, [timeUp, finish]);

  /** Quit mid-round: confirm, then keep what was done (≥ 1 attempt) and leave. */
  const endEarly = React.useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const attemptCount = attemptsRef.current.length;
    const elapsed = Math.min(Date.now() - startedAtRef.current, ROUND_MS);
    track('typing_round_abandoned', { words: attemptCount, elapsedMs: elapsed });
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      const work =
        attemptCount > 0
          ? finishTypingRound(DEPS, sessionId, attemptsRef.current, elapsed)
          : repos.stats.finishGameSession(sessionId, { itemCount: 0, correctCount: 0 });
      void work.catch((err: unknown) => logError('manual', err));
    }
    router.back();
  }, [router]);

  const quit = React.useCallback(() => {
    if (phase !== 'playing') {
      router.back();
      return;
    }
    const count = attemptsRef.current.length;
    Alert.alert(
      'End round?',
      count > 0
        ? `${count} word${count === 1 ? '' : 's'} so far — those are saved.`
        : 'Nothing typed yet — nothing is saved.',
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'End round', style: 'destructive', onPress: endEarly },
      ],
    );
  }, [phase, router, endEarly]);

  React.useEffect(() => {
    if (phase !== 'playing') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      quit();
      return true;
    });
    return () => sub.remove();
  }, [phase, quit]);

  if (phase === 'loading' || phase === 'finishing') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Text className="text-center">
          Couldn&apos;t run the typing round — something went wrong reading or saving.
        </Text>
        <BackButton onPress={() => router.back()} />
      </View>
    );
  }

  if (phase === 'empty') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Text className="font-reading text-xl">Мало слов</Text>
        <Text variant="muted" className="text-center">
          Typing needs at least {MIN_CANDIDATES} single-word bank items. Save more words from your
          reading and come back.
        </Text>
        <BackButton onPress={() => router.back()} />
      </View>
    );
  }

  if (phase === 'summary' && result) {
    return (
      <SummaryPanel
        result={result}
        topInset={insets.top}
        bottomInset={insets.bottom}
        onAgain={() => void start()}
        onDone={() => router.back()}
      />
    );
  }

  if (phase === 'ready') {
    return (
      <ReadyPanel
        bests={bests}
        candidateCount={candidates.length}
        topInset={insets.top}
        bottomInset={insets.bottom}
        onStart={() => void start()}
        onClose={() => router.back()}
      />
    );
  }

  // playing
  const live = computeTypingStats(attempts, elapsedMs);
  const remaining = Math.max(0, Math.ceil((ROUND_MS - elapsedMs) / 1000));
  return (
    <View
      className="flex-1 bg-bg"
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}
    >
      <View className="flex-row items-center gap-3 px-4">
        <Pressable
          onPress={quit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="End round"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="close" size={22} color={tokens.textMuted} />
        </Pressable>
        <View className="flex-1 flex-row justify-around">
          <Stat label="time" value={`${remaining}s`} />
          <Stat label="wpm" value={live.wpm.toFixed(1)} />
          <Stat label="acc" value={live.words > 0 ? `${Math.round(live.accuracy * 100)}%` : '—'} />
        </View>
      </View>

      <View className="flex-1 justify-center gap-4 px-6">
        <Text className="text-center font-reading text-5xl" accessibilityLabel="Word to type">
          {current?.lemma ?? ''}
        </Text>
        <Text variant="caption" className="text-center">
          {current?.translation ?? ''}
        </Text>
        <View className="h-7 items-center justify-center">
          {feedback ? (
            <Text
              className="font-ui-medium text-base"
              style={{ color: feedback.correct ? tokens.success : tokens.danger }}
            >
              {feedback.correct ? '✓' : `✗ ${feedback.expected}`}
            </Text>
          ) : null}
        </View>
        <TextInput
          value={typed}
          autoFocus
          onChangeText={(text) => {
            // A trailing space after a non-empty word submits it.
            if (text.endsWith(' ') && text.trim() !== '') {
              submit(text);
              return;
            }
            typedRef.current = text;
            setTyped(text);
          }}
          onSubmitEditing={() => submit(typedRef.current)}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="no"
          keyboardType="default"
          blurOnSubmit={false}
          returnKeyType="next"
          placeholder="Печатай…"
          placeholderTextColor={tokens.textMuted}
          className="rounded-xl border border-border bg-surface px-4 py-3.5 text-center font-reading text-2xl text-text"
          accessibilityLabel="Type the word"
        />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text className="font-ui-medium text-base">{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="mt-2 min-h-12 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
    >
      <Text className="text-accent">Back</Text>
    </Pressable>
  );
}

function ReadyPanel({
  bests,
  candidateCount,
  topInset,
  bottomInset,
  onStart,
  onClose,
}: {
  bests: TypingStats | null;
  candidateCount: number;
  topInset: number;
  bottomInset: number;
  onStart: () => void;
  onClose: () => void;
}) {
  const { tokens } = useAppTheme();
  const hasRounds = (bests?.rounds ?? 0) > 0;
  return (
    <View
      className="flex-1 bg-bg px-6"
      style={{ paddingTop: topInset + 8, paddingBottom: bottomInset + 16 }}
    >
      <View className="flex-row items-center">
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="close" size={22} color={tokens.textMuted} />
        </Pressable>
      </View>
      <View className="flex-1 justify-center gap-5">
        <View className="gap-1">
          <Text variant="heading">Печать</Text>
          <Text variant="caption">Typing trainer · 2-minute burst</Text>
        </View>
        <Text variant="muted">
          A Russian word appears with its English meaning. Type it, then press Space or Enter. ё and
          е count the same. {candidateCount} words in the pool, shaky ones come up more often.
        </Text>
        <View className="gap-1 rounded-xl border border-border bg-surface p-4">
          {hasRounds ? (
            <>
              <Text className="font-ui-medium">
                Best {bests!.bestWpm.toFixed(1)} WPM
                {bests!.bestAccuracy > 0
                  ? ` · best accuracy ${Math.round(bests!.bestAccuracy * 100)}%`
                  : ''}
              </Text>
              <Text variant="caption">{bests!.rounds} rounds so far</Text>
            </>
          ) : (
            <Text variant="caption">No rounds yet — set the first mark.</Text>
          )}
        </View>
      </View>
      <Pressable
        onPress={onStart}
        accessibilityRole="button"
        className="min-h-14 items-center justify-center rounded-full bg-accent active:opacity-80"
      >
        <Text className="font-ui-bold text-base text-bg">Start</Text>
      </Pressable>
    </View>
  );
}

function SummaryPanel({
  result,
  topInset,
  bottomInset,
  onAgain,
  onDone,
}: {
  result: TypingRoundResult;
  topInset: number;
  bottomInset: number;
  onAgain: () => void;
  onDone: () => void;
}) {
  const { tokens } = useAppTheme();
  const { stats, xp, bests, newBest } = result;
  return (
    <View
      className="flex-1 bg-bg px-6"
      style={{ paddingTop: topInset + 16, paddingBottom: bottomInset + 16 }}
    >
      <View className="flex-1 justify-center gap-5">
        <Text variant="heading">Round done</Text>
        <View className="flex-row flex-wrap gap-3">
          <SummaryTile label="WPM" value={stats.wpm.toFixed(1)} highlight={newBest.wpm} />
          <SummaryTile
            label="accuracy"
            value={`${Math.round(stats.accuracy * 100)}%`}
            highlight={newBest.accuracy}
          />
          <SummaryTile label="words" value={`${stats.words}`} />
          <SummaryTile label="chars" value={`${stats.chars}`} />
          <SummaryTile label="XP" value={`+${xp}`} />
        </View>
        <View className="gap-1 rounded-xl border border-border bg-surface p-4">
          <Text className="font-ui-medium">
            Best {bests.bestWpm.toFixed(1)} WPM · best accuracy{' '}
            {Math.round(bests.bestAccuracy * 100)}%
          </Text>
          {newBest.wpm || newBest.accuracy ? (
            <Text className="font-ui-medium" style={{ color: tokens.accent }}>
              New best {newBest.wpm ? 'speed' : 'accuracy'}!
            </Text>
          ) : null}
        </View>
      </View>
      <View className="flex-row gap-3">
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          className="min-h-14 flex-1 items-center justify-center rounded-full border border-border bg-surface active:bg-surface-2"
        >
          <Text className="font-ui-medium">Done</Text>
        </Pressable>
        <Pressable
          onPress={onAgain}
          accessibilityRole="button"
          className="min-h-14 flex-1 items-center justify-center rounded-full bg-accent active:opacity-80"
        >
          <Text className="font-ui-bold text-bg">Again</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SummaryTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const { tokens } = useAppTheme();
  return (
    <View
      className="min-w-[30%] flex-1 items-center gap-0.5 rounded-xl border bg-surface p-3"
      style={{ borderColor: highlight ? tokens.accent : tokens.border }}
    >
      <Text className="font-ui-bold text-xl">{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}
