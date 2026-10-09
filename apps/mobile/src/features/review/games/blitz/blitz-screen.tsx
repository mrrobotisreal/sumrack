import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useStudyAmbience } from '@/features/ambient-audio/activity';
import { evaluateMotivation, onSessionEnded } from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  BLITZ_DURATION_MS,
  createBoard,
  MIN_BLITZ_POOL,
  remainingMs,
  tryMatch,
  VISIBLE_PAIRS,
  WRONG_PENALTY_MS,
  type BlitzBoard,
  type BlitzPair,
} from './engine';
import {
  finishBlitzRound,
  loadBlitzPool,
  loadBlitzStats,
  startBlitzRound,
  type BlitzRoundResult,
  type BlitzServiceDeps,
} from './service';
import type { BlitzStats } from './stats';

/**
 * Match blitz «Молния» (T34, route `/games/blitz`). 60 s: tap a Russian
 * word on the left, then its gloss on the right (or the other way round).
 * FSRS-free — nothing here grades a card (see service.ts).
 *
 * Decisions recorded here:
 * - Either side may be tapped first; tapping the selected tile again
 *   deselects; tapping another tile on the same side moves the selection.
 * - Input is locked for MATCH_MS after a match (the pair glows, then refills
 *   in place) and for SHAKE_MS after a miss (both tiles shake) — T13's
 *   rapid-tap reflow lesson: a tap never lands on a tile that is changing.
 * - The clock is a thin bar that drains in the accent colour and a quiet
 *   seconds caption — no red, no flashing, no ticking (UI_DESIGN §5). A
 *   penalty shows as a brief «−2 s» caption, nothing louder.
 * - Ember-restrained juice: a matched pair's border glows accent for MATCH_MS.
 *   No confetti, no haptic storm.
 */

const DEPS: BlitzServiceDeps = { repos, evaluate: evaluateMotivation, onSessionEnded };

const MATCH_MS = 220;
const SHAKE_MS = 260;
const TICK_MS = 200;
const PENALTY_NOTE_MS = 900;

type Phase = 'loading' | 'empty' | 'error' | 'ready' | 'playing' | 'finishing' | 'summary';
type Side = 'left' | 'right';

interface Selection {
  side: Side;
  slot: number;
}

export function BlitzScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();

  const [phase, setPhase] = React.useState<Phase>('loading');
  const [pool, setPool] = React.useState<BlitzPair[]>([]);
  const [stats, setStats] = React.useState<BlitzStats | null>(null);
  const [board, setBoard] = React.useState<BlitzBoard | null>(null);
  const [selected, setSelected] = React.useState<Selection | null>(null);
  const [glow, setGlow] = React.useState<{ left: number; right: number } | null>(null);
  const [shake, setShake] = React.useState<{ left: number; right: number; key: number } | null>(
    null,
  );
  const [pairs, setPairs] = React.useState(0);
  const [misses, setMisses] = React.useState(0);
  const [penaltyMs, setPenaltyMs] = React.useState(0);
  const [penaltyNote, setPenaltyNote] = React.useState(0);
  const [now, setNow] = React.useState(0);
  const [startedAt, setStartedAt] = React.useState(0);
  const [result, setResult] = React.useState<BlitzRoundResult | null>(null);

  useStudyAmbience(phase === 'playing');

  const byId = React.useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const allIds = React.useMemo(() => pool.map((p) => p.id), [pool]);

  const startedAtRef = React.useRef(0);
  const sessionIdRef = React.useRef<string | null>(null);
  const finishedRef = React.useRef(false);
  const lockedRef = React.useRef(false);
  const counters = React.useRef({ pairs: 0, misses: 0, penaltyMs: 0 });
  /** The lifetime best, for the start event (kept off the start callback's deps). */
  const bestRef = React.useRef(0);
  React.useEffect(() => {
    bestRef.current = stats?.best ?? 0;
  }, [stats]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [p, s] = await Promise.all([loadBlitzPool(repos), loadBlitzStats(repos)]);
        if (cancelled) return;
        setPool(p);
        setStats(s);
        setPhase(p.length < MIN_BLITZ_POOL ? 'empty' : 'ready');
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

  const start = React.useCallback(async () => {
    try {
      const id = await startBlitzRound(repos, pool.length);
      sessionIdRef.current = id;
      finishedRef.current = false;
      lockedRef.current = false;
      counters.current = { pairs: 0, misses: 0, penaltyMs: 0 };
      setBoard(createBoard(pool));
      setSelected(null);
      setGlow(null);
      setShake(null);
      setPairs(0);
      setMisses(0);
      setPenaltyMs(0);
      setResult(null);
      const t0 = Date.now();
      startedAtRef.current = t0;
      setStartedAt(t0);
      setNow(t0);
      setPhase('playing');
      track('blitz_round_started', { poolSize: pool.length, best: bestRef.current });
    } catch (err) {
      logError('manual', err);
      setPhase('error');
    }
  }, [pool]);

  const finish = React.useCallback(
    (completed: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const sessionId = sessionIdRef.current;
      const c = counters.current;
      if (!sessionId) return;
      const input = { ...c, poolSize: pool.length, completed };
      if (!completed) {
        track('blitz_round_abandoned', {
          pairs: c.pairs,
          misses: c.misses,
          elapsedMs: Date.now() - startedAtRef.current,
        });
        void finishBlitzRound(DEPS, sessionId, input).catch((err: unknown) =>
          logError('manual', err),
        );
        router.back();
        return;
      }
      setPhase('finishing');
      void finishBlitzRound(DEPS, sessionId, input)
        .then(async (res) => {
          track('blitz_round_finished', {
            pairs: res.pairs,
            misses: c.misses,
            penaltyMs: c.penaltyMs,
            xp: res.xp,
            newBest: res.newBest,
            best: res.best,
          });
          void queryClient.invalidateQueries({ queryKey: ['quest'] });
          void queryClient.invalidateQueries({ queryKey: ['blitz-stats'] });
          setStats(await loadBlitzStats(repos));
          setResult(res);
          setPhase('summary');
        })
        .catch((err: unknown) => {
          logError('manual', err);
          setPhase('error');
        });
    },
    [pool.length, router, queryClient],
  );

  // Clock.
  React.useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      // Clock zero (penalties included) ends the sprint from the tick itself.
      if (remainingMs(t - startedAtRef.current, counters.current.penaltyMs) <= 0) finish(true);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, finish]);

  const left = remainingMs(now - startedAt, penaltyMs);

  const tap = React.useCallback(
    (side: Side, slot: number) => {
      if (phase !== 'playing' || lockedRef.current || !board) return;
      if (board[side][slot] == null) return;
      if (!selected || selected.side === side) {
        setSelected(
          selected && selected.side === side && selected.slot === slot ? null : { side, slot },
        );
        return;
      }
      const leftSlot = side === 'left' ? slot : selected.slot;
      const rightSlot = side === 'right' ? slot : selected.slot;
      setSelected(null);
      const outcome = tryMatch(board, leftSlot, rightSlot, allIds);
      lockedRef.current = true;
      if (outcome.kind === 'match') {
        counters.current.pairs += 1;
        setPairs(counters.current.pairs);
        setGlow({ left: leftSlot, right: rightSlot });
        setTimeout(() => {
          setBoard(outcome.board);
          setGlow(null);
          lockedRef.current = false;
        }, MATCH_MS);
      } else {
        counters.current.misses += 1;
        counters.current.penaltyMs += WRONG_PENALTY_MS;
        setMisses(counters.current.misses);
        setPenaltyMs(counters.current.penaltyMs);
        setPenaltyNote(Date.now());
        setShake({ left: leftSlot, right: rightSlot, key: Date.now() });
        track('blitz_match_missed', { elapsedMs: Date.now() - startedAtRef.current });
        setTimeout(() => {
          setShake(null);
          lockedRef.current = false;
        }, SHAKE_MS);
      }
    },
    [phase, board, selected, allIds],
  );

  const quit = React.useCallback(() => {
    if (phase !== 'playing') {
      router.back();
      return;
    }
    Alert.alert('End sprint?', 'A sprint that is cut short earns no XP and sets no best.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'End sprint', style: 'destructive', onPress: () => finish(false) },
    ]);
  }, [phase, router, finish]);

  React.useEffect(() => {
    if (phase !== 'playing') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      quit();
      return true;
    });
    return () => sub.remove();
  }, [phase, quit]);

  const pad = { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 };

  if (phase === 'loading' || phase === 'finishing') {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (phase === 'error' || phase === 'empty') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        {phase === 'empty' ? (
          <>
            <Text className="font-reading text-xl">Мало слов</Text>
            <Text variant="muted" className="text-center">
              Молния uses words you already know a little — at least {MIN_BLITZ_POOL} bank words at
              young or mature strength (stable for a week or more). Keep reviewing and come back.
            </Text>
          </>
        ) : (
          <Text className="text-center">Couldn&apos;t run the sprint — something went wrong.</Text>
        )}
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="mt-2 min-h-12 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
        >
          <Text className="text-accent">Back</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'ready' || (phase === 'summary' && result)) {
    return (
      <View className="flex-1 bg-bg px-6" style={pad}>
        <View className="flex-row items-center">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
          >
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>
        <View className="flex-1 justify-center gap-5">
          {result ? (
            <>
              <Text variant="heading">Sprint done</Text>
              <View className="flex-row gap-3">
                <Tile label="pairs" value={`${result.pairs}`} highlight={result.newBest} />
                <Tile label="misses" value={`${misses}`} />
                <Tile label="XP" value={`+${result.xp}`} />
              </View>
              <Text
                className="font-ui-medium"
                style={{ color: result.newBest ? tokens.accent : tokens.text }}
              >
                {result.newBest ? `New best — ${result.best} pairs` : `Best ${result.best} pairs`}
              </Text>
            </>
          ) : (
            <>
              <View className="gap-1">
                <Text variant="heading">Молния</Text>
                <Text variant="caption">Match blitz · 60 seconds</Text>
              </View>
              <Text variant="muted">
                Match each Russian word to its meaning. A wrong pair costs {WRONG_PENALTY_MS / 1000}{' '}
                s. Pure speed — nothing here touches your review schedule. {pool.length} words in
                play.
              </Text>
              <View className="rounded-xl border border-border bg-surface p-4">
                <Text className="font-ui-medium">
                  {stats && stats.rounds > 0
                    ? `Best ${stats.best} pairs · ${stats.rounds} sprints`
                    : 'No sprints yet — set the first mark.'}
                </Text>
              </View>
            </>
          )}
        </View>
        <View className="flex-row gap-3">
          {result ? (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              className="min-h-14 flex-1 items-center justify-center rounded-full border border-border bg-surface active:bg-surface-2"
            >
              <Text className="font-ui-medium">Done</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => void start()}
            accessibilityRole="button"
            className="min-h-14 flex-1 items-center justify-center rounded-full bg-accent active:opacity-80"
          >
            <Text className="font-ui-bold text-bg">{result ? 'Again' : 'Start'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // playing
  const fraction = left / BLITZ_DURATION_MS;
  // `now` ticks every TICK_MS, so the note fades on the next tick past the window.
  const showPenalty = now - penaltyNote < PENALTY_NOTE_MS;
  return (
    <View className="flex-1 bg-bg" style={pad}>
      <View className="flex-row items-center gap-3 px-4">
        <Pressable
          onPress={quit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="End sprint"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="close" size={22} color={tokens.textMuted} />
        </Pressable>
        <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <View className="h-full rounded-full bg-accent" style={{ width: `${fraction * 100}%` }} />
        </View>
        <Text variant="caption" className="min-w-10 text-right" accessibilityLabel="Seconds left">
          {Math.ceil(left / 1000)}s
        </Text>
      </View>
      <View className="flex-row items-center justify-between px-5 pt-3">
        <Text className="font-ui-bold text-2xl" accessibilityLabel="Pairs matched">
          {pairs}
        </Text>
        <Text variant="caption">
          {showPenalty ? `−${WRONG_PENALTY_MS / 1000} s` : misses > 0 ? `${misses} missed` : ' '}
        </Text>
      </View>
      <View className="flex-1 flex-row gap-3 px-4 pt-4">
        {(['left', 'right'] as const).map((side) => (
          <View key={side} className="flex-1 justify-center gap-3">
            {Array.from({ length: VISIBLE_PAIRS }, (_, slot) => {
              const id = board?.[side][slot] ?? null;
              const pair = id ? byId.get(id) : undefined;
              return (
                <BlitzTile
                  key={slot}
                  text={pair ? (side === 'left' ? pair.ru : pair.en) : ''}
                  russian={side === 'left'}
                  selected={selected?.side === side && selected.slot === slot}
                  glowing={glow?.[side] === slot}
                  shakeKey={shake && shake[side] === slot ? shake.key : null}
                  onPress={() => tap(side, slot)}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function Tile({
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
      className="flex-1 items-center gap-0.5 rounded-xl border bg-surface p-3"
      style={{ borderColor: highlight ? tokens.accent : tokens.border }}
    >
      <Text className="font-ui-bold text-xl">{value}</Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

function BlitzTile({
  text,
  russian,
  selected,
  glowing,
  shakeKey,
  onPress,
}: {
  text: string;
  russian: boolean;
  selected: boolean;
  glowing: boolean;
  shakeKey: number | null;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  const [offset] = React.useState(() => new Animated.Value(0));

  React.useEffect(() => {
    if (shakeKey == null) return;
    offset.setValue(0);
    Animated.sequence(
      [6, -6, 4, -4, 0].map((toValue) =>
        Animated.timing(offset, {
          toValue,
          duration: 50,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [shakeKey, offset]);

  const border = glowing || selected ? tokens.accent : tokens.border;
  return (
    <Animated.View style={{ transform: [{ translateX: offset }] }}>
      <Pressable
        onPress={onPress}
        disabled={text === ''}
        accessibilityRole="button"
        accessibilityLabel={`${russian ? 'Russian' : 'Meaning'}: ${text}`}
        accessibilityState={{ selected }}
        className="min-h-16 items-center justify-center rounded-xl border-2 px-2 py-2 active:bg-surface-2"
        style={{
          borderColor: border,
          backgroundColor: selected ? tokens.surface2 : tokens.surface,
          opacity: glowing ? 0.6 : 1,
        }}
      >
        <Text
          className={russian ? 'text-center font-reading text-lg' : 'text-center text-sm'}
          numberOfLines={2}
          adjustsFontSizeToFit
        >
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
