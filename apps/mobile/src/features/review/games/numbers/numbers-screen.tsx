import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { evaluateMotivation, onSessionEnded } from '@/features/motivation/service';
import { SessionShell } from '@/features/review/session-shell';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';
import { getSpeechService } from '@/services/speech';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  BAND_LABEL,
  generateRound,
  isCorrectAnswer,
  NUMBERS_BANDS,
  NUMBERS_TIERS,
  TIER_INFO,
  type BandTally,
  type NumbersAttempt,
  type NumbersItem,
  type NumbersTier,
} from './engine';
import {
  finishNumbersRound,
  loadNumbersStats,
  startNumbersRound,
  type NumbersLifetime,
  type NumbersRoundResult,
  type NumbersServiceDeps,
} from './service';

/**
 * The numbers drill (T34, route `/games/numbers`). Pick a tier → 10 items:
 * the TTS speaks the RENDERED WORDS (lib/ru-numbers; never digits), you
 * pick from 4 (tier 1) or type digits on the in-app numpad. Replay is free
 * and unlimited; there is no slow replay (ticket).
 *
 * Decisions recorded here:
 * - The numpad is in-app (not the system keyboard): digits plus «.» and «:»
 *   separators, ⌫, and Check — no keyboard switching, works identically on
 *   every device.
 * - Feedback holds until «Next» (a wrong answer shows the right digits AND
 *   the words, so the miss teaches). The item auto-plays on appear.
 * - Quitting with ≥ 1 answer keeps the band tallies (partial round, no XP);
 *   quitting with none closes the row empty — the T40 convention.
 * - `?tier=` deep-links a tier (quest launch); `?from=quest` tags analytics.
 */

const DEPS: NumbersServiceDeps = { repos, evaluate: evaluateMotivation, onSessionEnded };

type Phase = 'loading' | 'pick' | 'playing' | 'finishing' | 'summary' | 'error';

interface Feedback {
  correct: boolean;
  given: string;
}

function parseTier(raw: unknown): NumbersTier | null {
  const n = Number(raw);
  return (NUMBERS_TIERS as readonly number[]).includes(n) ? (n as NumbersTier) : null;
}

export function NumbersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tier?: string; from?: string }>();
  const from = params.from === 'quest' ? 'quest' : 'menu';

  const [phase, setPhase] = React.useState<Phase>('loading');
  const [lifetime, setLifetime] = React.useState<NumbersLifetime | null>(null);
  const [tier, setTier] = React.useState<NumbersTier>(1);
  const [items, setItems] = React.useState<NumbersItem[]>([]);
  const [index, setIndex] = React.useState(0);
  const [typed, setTyped] = React.useState('');
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  const [result, setResult] = React.useState<NumbersRoundResult | null>(null);

  const attemptsRef = React.useRef<NumbersAttempt[]>([]);
  const playsRef = React.useRef(0);
  const shownAtRef = React.useRef(0);
  const sessionIdRef = React.useRef<string | null>(null);
  const finishedRef = React.useRef(false);

  const reload = React.useCallback(async () => {
    const stats = await loadNumbersStats(repos);
    setLifetime(stats);
    return stats;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void loadNumbersStats(repos)
      .then((stats) => {
        if (cancelled) return;
        setLifetime(stats);
        setTier(parseTier(params.tier) ?? stats.suggested);
        setPhase('pick');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logError('manual', err);
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
    // The deep-linked tier is read once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = items[index] ?? null;
  const suggested = lifetime?.suggested ?? 1;

  const play = React.useCallback((item: NumbersItem | null) => {
    if (!item) return;
    playsRef.current += 1;
    const speech = getSpeechService();
    void speech.stop().then(() => speech.speak(item.spoken));
  }, []);

  // Auto-play each item once when it appears.
  React.useEffect(() => {
    if (phase !== 'playing' || !current) return;
    playsRef.current = 0;
    shownAtRef.current = Date.now();
    play(current);
  }, [phase, current, play]);

  // Never leave TTS talking over another screen.
  React.useEffect(() => () => void getSpeechService().stop(), []);

  const start = React.useCallback(
    async (chosen: NumbersTier) => {
      try {
        const round = generateRound(chosen);
        const id = await startNumbersRound(repos, chosen);
        sessionIdRef.current = id;
        finishedRef.current = false;
        attemptsRef.current = [];
        setTier(chosen);
        setItems(round);
        setIndex(0);
        setTyped('');
        setFeedback(null);
        setResult(null);
        setPhase('playing');
        track('numbers_round_started', {
          tier: chosen,
          suggested,
          mode: from === 'quest' ? 'quest' : chosen === suggested ? 'suggested' : 'manual',
        });
      } catch (err) {
        logError('manual', err);
        setPhase('error');
      }
    },
    [from, suggested],
  );

  const finish = React.useCallback(
    (completed: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const sessionId = sessionIdRef.current;
      const attempts = attemptsRef.current;
      void getSpeechService().stop();
      if (!sessionId) return;
      if (!completed) {
        track('numbers_round_abandoned', { tier, answered: attempts.length });
        const work =
          attempts.length > 0
            ? finishNumbersRound(DEPS, sessionId, tier, attempts)
            : repos.stats.finishGameSession(sessionId, { itemCount: 0, correctCount: 0 });
        void work.catch((err: unknown) => logError('manual', err));
        router.back();
        return;
      }
      setPhase('finishing');
      void finishNumbersRound(DEPS, sessionId, tier, attempts)
        .then(async (res) => {
          track('numbers_round_finished', {
            tier,
            correct: res.correct,
            total: res.total,
            xp: res.xp,
            replays: attempts.reduce((a, x) => a + Math.max(0, x.plays - 1), 0),
          });
          void queryClient.invalidateQueries({ queryKey: ['quest'] });
          await reload();
          setResult(res);
          setPhase('summary');
        })
        .catch((err: unknown) => {
          logError('manual', err);
          setPhase('error');
        });
    },
    [tier, router, reload, queryClient],
  );

  const answer = React.useCallback(
    (given: string) => {
      if (!current || feedback) return;
      const correct = isCorrectAnswer(current, given);
      attemptsRef.current = [
        ...attemptsRef.current,
        { band: current.band, kind: current.kind, correct, plays: Math.max(1, playsRef.current) },
      ];
      track('numbers_item_answered', {
        tier,
        kind: current.kind,
        band: current.band,
        correct,
        plays: Math.max(1, playsRef.current),
        answerMode: current.mode,
        ms: Date.now() - shownAtRef.current,
      });
      setFeedback({ correct, given });
    },
    [current, feedback, tier],
  );

  const next = React.useCallback(() => {
    if (index + 1 >= items.length) {
      finish(true);
      return;
    }
    setIndex((i) => i + 1);
    setTyped('');
    setFeedback(null);
  }, [index, items.length, finish]);

  const quit = React.useCallback(() => {
    if (phase !== 'playing') {
      router.back();
      return;
    }
    const answered = attemptsRef.current.length;
    Alert.alert(
      'End round?',
      answered > 0
        ? `${answered} answered — those count toward your stats, but a partial round earns no XP.`
        : 'Nothing answered yet — nothing is saved.',
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'End round', style: 'destructive', onPress: () => finish(false) },
      ],
    );
  }, [phase, router, finish]);

  React.useEffect(() => {
    if (phase !== 'playing') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      quit();
      return true;
    });
    return () => sub.remove();
  }, [phase, quit]);

  if (phase === 'loading' || phase === 'finishing') return <Centered spinner />;

  if (phase === 'error') {
    return (
      <Centered>
        <Text className="text-center">
          Couldn&apos;t run the numbers drill — something went wrong saving.
        </Text>
        <OutlineButton label="Back" onPress={() => router.back()} />
      </Centered>
    );
  }

  if (phase === 'pick') {
    return (
      <TierPicker
        lifetime={lifetime}
        selected={tier}
        onSelect={setTier}
        onStart={() => void start(tier)}
        onClose={() => router.back()}
      />
    );
  }

  if (phase === 'summary' && result) {
    return (
      <Summary
        tier={tier}
        result={result}
        lifetime={lifetime}
        onAgain={() => void start(tier)}
        onPickTier={() => setPhase('pick')}
        onDone={() => router.back()}
      />
    );
  }

  if (!current) return <Centered spinner />;

  return (
    <SessionShell current={index} total={items.length} onQuit={quit} ambientTheme="education">
      <View className="flex-1 justify-between px-5 pt-6">
        <View className="items-center gap-4">
          <Text variant="caption" className="uppercase tracking-wider">
            {TIER_INFO[tier].title} · {kindLabel(current)}
          </Text>
          <ReplayButton
            onPress={() => {
              play(current);
              track('numbers_item_replayed', { tier, kind: current.kind });
            }}
          />
          {feedback ? (
            <FeedbackPanel item={current} feedback={feedback} />
          ) : current.mode === 'typed' ? (
            <AnswerDisplay value={typed} hint={current.hint} />
          ) : (
            <Text variant="muted">What did you hear?</Text>
          )}
        </View>

        <View className="pb-2">
          {feedback ? (
            <PrimaryButton label={index + 1 >= items.length ? 'Finish' : 'Next'} onPress={next} />
          ) : current.mode === 'choice' ? (
            <ChoiceGrid options={current.options ?? []} onPick={answer} />
          ) : (
            <Numpad
              value={typed}
              onChange={setTyped}
              onSubmit={() => typed.trim() !== '' && answer(typed)}
              separators={
                current.kind === 'time'
                  ? [':']
                  : current.kind === 'number' || current.kind === 'year' || current.kind === 'age'
                    ? []
                    : ['.']
              }
            />
          )}
        </View>
      </View>
    </SessionShell>
  );
}

function kindLabel(item: NumbersItem): string {
  switch (item.kind) {
    case 'number':
      return 'number';
    case 'price':
      return 'price';
    case 'time':
      return 'time';
    case 'date':
      return 'date';
    case 'year':
      return 'year';
    case 'age':
      return 'age';
  }
}

function Centered({
  children,
  spinner = false,
}: {
  children?: React.ReactNode;
  spinner?: boolean;
}) {
  const { tokens } = useAppTheme();
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
      {spinner ? <ActivityIndicator color={tokens.accent} /> : children}
    </View>
  );
}

function ReplayButton({ onPress }: { onPress: () => void }) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Play again"
      className="h-24 w-24 items-center justify-center rounded-full border border-border bg-surface active:bg-surface-2"
    >
      <Ionicons name="volume-high" size={36} color={tokens.accent} />
    </Pressable>
  );
}

function AnswerDisplay({ value, hint }: { value: string; hint?: string }) {
  return (
    <View className="items-center gap-1">
      <Text className="font-ui-bold text-5xl tracking-wider" accessibilityLabel="Your answer">
        {value === '' ? ' ' : value}
      </Text>
      <Text variant="caption">{hint ? `as ${hint}` : 'type the digits'}</Text>
    </View>
  );
}

function FeedbackPanel({ item, feedback }: { item: NumbersItem; feedback: Feedback }) {
  const { tokens } = useAppTheme();
  return (
    <View className="items-center gap-2">
      <Text
        className="font-ui-bold text-4xl"
        style={{ color: feedback.correct ? tokens.success : tokens.danger }}
      >
        {feedback.correct ? `✓ ${item.answer}` : `✗ ${item.answer}`}
      </Text>
      {!feedback.correct ? <Text variant="caption">you answered {feedback.given}</Text> : null}
      <Text className="text-center font-reading text-xl">{item.spoken}</Text>
    </View>
  );
}

function ChoiceGrid({ options, onPick }: { options: string[]; onPick: (o: string) => void }) {
  return (
    <View className="flex-row flex-wrap gap-3">
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onPick(o)}
          accessibilityRole="button"
          accessibilityLabel={`Answer: ${o}`}
          className="min-h-16 w-[47%] flex-grow items-center justify-center rounded-xl border border-border bg-surface active:bg-surface-2"
        >
          <Text className="font-ui-bold text-3xl">{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const MAX_TYPED = 9;

function Numpad({
  value,
  onChange,
  onSubmit,
  separators,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  separators: string[];
}) {
  const { tokens } = useAppTheme();
  const press = (key: string) => {
    if (value.length >= MAX_TYPED) return;
    onChange(value + key);
  };
  const sep = separators[0] ?? null;
  const rows: (string | null)[][] = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [sep, '0', '⌫'],
  ];
  return (
    <View className="gap-2.5">
      {rows.map((row, ri) => (
        <View key={ri} className="flex-row gap-2.5">
          {row.map((key, ki) =>
            key == null ? (
              <View key={ki} className="h-14 flex-1" />
            ) : (
              <Pressable
                key={ki}
                onPress={() => (key === '⌫' ? onChange(value.slice(0, -1)) : press(key))}
                accessibilityRole="button"
                accessibilityLabel={key === '⌫' ? 'Delete' : `Key ${key}`}
                className="h-14 flex-1 items-center justify-center rounded-xl bg-surface active:bg-surface-2"
              >
                {key === '⌫' ? (
                  <Ionicons name="backspace-outline" size={24} color={tokens.textMuted} />
                ) : (
                  <Text className="font-ui-medium text-2xl">{key}</Text>
                )}
              </Pressable>
            ),
          )}
        </View>
      ))}
      <PrimaryButton label="Check" onPress={onSubmit} disabled={value.trim() === ''} />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`min-h-14 items-center justify-center rounded-full bg-accent active:opacity-80 ${disabled ? 'opacity-40' : ''}`}
    >
      <Text className="font-ui-bold text-base text-bg">{label}</Text>
    </Pressable>
  );
}

function OutlineButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="min-h-14 flex-1 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
    >
      <Text className="font-ui-medium">{label}</Text>
    </Pressable>
  );
}

function TierPicker({
  lifetime,
  selected,
  onSelect,
  onStart,
  onClose,
}: {
  lifetime: NumbersLifetime | null;
  selected: NumbersTier;
  onSelect: (t: NumbersTier) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();
  return (
    <View
      className="flex-1 bg-bg"
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center px-4">
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
      <ScrollView contentContainerClassName="gap-3 px-5 pb-6">
        <View className="gap-1">
          <Text variant="heading">Числа</Text>
          <Text variant="caption">
            Numbers drill · 10 items · listen, then answer. Replay as often as you like.
          </Text>
        </View>
        {NUMBERS_TIERS.map((t) => {
          const isSel = t === selected;
          const suggested = lifetime?.suggested === t;
          return (
            <Pressable
              key={t}
              onPress={() => onSelect(t)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSel }}
              accessibilityLabel={`Tier ${t}: ${TIER_INFO[t].title}`}
              className="flex-row items-center gap-3 rounded-xl border bg-surface p-4 active:bg-surface-2"
              style={{ borderColor: isSel ? tokens.accent : tokens.border }}
            >
              <Text
                className="w-6 font-ui-bold text-lg"
                style={{ color: isSel ? tokens.accent : tokens.textMuted }}
              >
                {t}
              </Text>
              <View className="flex-1 gap-0.5">
                <Text className="font-ui-medium">{TIER_INFO[t].title}</Text>
                <Text variant="caption">{TIER_INFO[t].subtitle}</Text>
              </View>
              {suggested ? (
                <Text variant="caption" className="text-accent">
                  suggested
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        {lifetime && lifetime.rounds > 0 ? (
          <BandStats bands={lifetime.bands} title="All-time accuracy" />
        ) : null}
      </ScrollView>
      <View className="px-5">
        <PrimaryButton label={`Start tier ${selected}`} onPress={onStart} />
      </View>
    </View>
  );
}

function BandStats({ bands, title }: { bands: BandTally; title: string }) {
  const rows = NUMBERS_BANDS.filter((b) => (bands[b]?.seen ?? 0) > 0);
  if (rows.length === 0) return null;
  return (
    <View className="gap-2 rounded-xl border border-border bg-surface p-4">
      <Text variant="caption" className="uppercase tracking-wider">
        {title}
      </Text>
      {rows.map((b) => {
        const t = bands[b]!;
        const pct = Math.round((t.correct / t.seen) * 100);
        return (
          <View key={b} className="gap-1">
            <View className="flex-row justify-between">
              <Text variant="caption">{BAND_LABEL[b]}</Text>
              <Text variant="caption">
                {pct}% · {t.correct}/{t.seen}
              </Text>
            </View>
            <View className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <View className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Summary({
  tier,
  result,
  lifetime,
  onAgain,
  onPickTier,
  onDone,
}: {
  tier: NumbersTier;
  result: NumbersRoundResult;
  lifetime: NumbersLifetime | null;
  onAgain: () => void;
  onPickTier: () => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-bg"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
    >
      <ScrollView contentContainerClassName="gap-4 px-5 pb-6">
        <Text variant="heading">Round done</Text>
        <Text variant="muted">
          Tier {tier} · {result.correct} / {result.total} right · +{result.xp} XP
        </Text>
        <BandStats bands={result.bands} title="This round" />
        {lifetime ? <BandStats bands={lifetime.bands} title="All-time accuracy" /> : null}
        {lifetime && lifetime.suggested !== tier ? (
          <Pressable onPress={onPickTier} accessibilityRole="button">
            <Text variant="caption" className="text-accent">
              Suggested next: tier {lifetime.suggested} — {TIER_INFO[lifetime.suggested].title} ›
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View className="flex-row gap-3 px-5">
        <OutlineButton label="Done" onPress={onDone} />
        <View className="flex-1">
          <PrimaryButton label="Again" onPress={onAgain} />
        </View>
      </View>
    </View>
  );
}
