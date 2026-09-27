import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { useScenario, useScenarioStamps, useScenarios } from '@/db/hooks';
import type { TokenRow } from '@/db/repositories/content';
import { DIALOGUE_READING_STYLE } from '@/features/dialogue/transcript';
import { preloadAsr } from '@/features/pronunciation/asr-service';
import { TokenText } from '@/features/reader/token-text';
import { WordPopup, type WordPopupTarget } from '@/features/reader/word-popup';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { EndingCard } from './ending-card';
import { haptics } from './haptics';
import { nextRung } from './hub-selection';
import { IntroCard } from './intro-card';
import {
  hostOf,
  mouthLineFor,
  ScenarioScene,
  sceneSpecFor,
  useMouthTrack,
  useSceneBed,
  type ScenePose,
} from './scene';
import { CommandsSheet } from './stage/commands-sheet';
import { LifelineChip } from './stage/lifeline-chip';
import { MicButton, type MicVisualState } from './stage/mic-button';
import { StateLine } from './stage/state-line';
import { useSubtitleKaraoke } from './stage/use-subtitle-karaoke';
import { useScenarioPrefs } from './store/scenario-prefs';
import { useScenarioRun } from './use-scenario-run';

/**
 * The run screen (T62, SPEAKING_SCENARIOS §9.3; portrait-locked by the
 * route): top chip + visited-turn dots + close; the `SceneBox` at ~62 %;
 * the glass stage — state line · mic (level ring, halo, tap/hold) · «?» ·
 * lifeline · ⟳ (long-press = slower) · «Пропустить →» · subtitles. The
 * screen renders state and dispatches events — every rule is the T60
 * reducer's; the executor (`use-scenario-run.ts`) runs the effects.
 *
 * Phases before/after the run: the intro card (§9.2) while the machine sits
 * in `intro`, the ending card (§9.4) once the FINISH effect has completed.
 */

/** «(принято)» badge hold after a rescued answer (§9.3). */
const RESCUED_BADGE_MS = 1000;

/** Stable style objects — a fresh `{flex:1}` per render would defeat the scene's memo (T61 probe). */
const FILL = { flex: 1 } as const;

export function ScenarioRunScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens: theme } = useAppTheme();
  const { packId, scenarioId } = useLocalSearchParams<{ packId: string; scenarioId: string }>();
  const prefs = useScenarioPrefs((s) => s.prefs);
  const setPrefs = useScenarioPrefs((s) => s.setPrefs);

  const detailQ = useScenario(packId, scenarioId);
  const detail = detailQ.data ?? null;
  const families = useScenarios();
  const run = useScenarioRun(detail, prefs);
  const { state, dispatch } = run;

  const spec = React.useMemo(() => (detail ? sceneSpecFor(detail) : null), [detail]);
  const host = React.useMemo(() => (detail ? hostOf(detail.cast) : null), [detail]);
  const hostName = host?.name.ru ?? spec?.hostName ?? 'Ведущий';
  const turn = React.useMemo(
    () => detail?.turns.find((t) => t.id === state.turnId) ?? null,
    [detail, state.turnId],
  );

  // Warm the recognizer while the intro shows (the T12/T27 pattern).
  React.useEffect(() => {
    preloadAsr();
  }, []);

  // --- the current line: mouth track + subtitles ----------------------------
  const playing = run.playback;
  const line = React.useMemo(
    () => (detail && playing ? (detail.lines[playing.sentenceId] ?? null) : null),
    [detail, playing],
  );
  const stampsQ = useScenarioStamps(packId, playing?.sentenceId);
  const mouthLine = React.useMemo(
    () => (line ? mouthLineFor(line.audio, line.sentence, stampsQ.data) : null),
    [line, stampsQ.data],
  );
  // The host speaks every pre-rendered line and the speech-service fallback of a
  // host line; a суфлёр line (SPEAK_GLOSS / SPEAK_RU) never sets `playback`.
  const speaking = playing != null && state.phase.kind !== 'ending';
  const shape = useMouthTrack({
    player: run.player,
    line: mouthLine,
    speaking,
    rate: playing?.rate ?? 1,
  });
  const subtitles = useSubtitleKaraoke({
    enabled: prefs.subtitles,
    player: run.player,
    sentence: line?.sentence ?? null,
    stamps: stampsQ.data,
    durationMs: line?.audio?.durationMs ?? null,
  });

  // --- pose + bed ---------------------------------------------------------
  const phase = state.phase;
  const pose: ScenePose =
    speaking || phase.kind === 'saying' || phase.kind === 'reacting'
      ? 'speaking'
      : phase.kind === 'listening'
        ? 'listening'
        : phase.kind === 'deciding'
          ? 'thinking'
          : 'idle';
  const inRun = phase.kind !== 'intro' && phase.kind !== 'ending' && !run.finish;
  const recording = phase.kind === 'listening' && phase.recording !== 'idle';
  useSceneBed(spec?.bed, {
    active: inRun && phase.kind !== 'paused',
    ducked: speaking || recording,
    volume: prefs.bedVolume,
  });

  // --- haptics on transitions (light arm · medium endpoint · success · miss) ----
  const prevPhaseRef = React.useRef(phase);
  const prevMissesRef = React.useRef(state.counters.misses);
  const prevAnsweredRef = React.useRef(state.totals.answered);
  React.useEffect(() => {
    const prev = prevPhaseRef.current;
    if (
      phase.kind === 'listening' &&
      phase.recording !== 'idle' &&
      !(prev.kind === 'listening' && prev.recording !== 'idle')
    )
      haptics.arm();
    if (phase.kind === 'deciding' && prev.kind === 'listening') haptics.endpoint();
    if (state.counters.misses > prevMissesRef.current) haptics.miss();
    if (state.totals.answered > prevAnsweredRef.current && !state.counters.skipped)
      haptics.matched();
    prevPhaseRef.current = phase;
    prevMissesRef.current = state.counters.misses;
    prevAnsweredRef.current = state.totals.answered;
  }, [phase, state.counters.misses, state.counters.skipped, state.totals.answered]);

  // «(принято)» for a second after a rescue accepted.
  const [rescuedBadge, setRescuedBadge] = React.useState(false);
  const lastRescueRef = React.useRef(state.lastRescue);
  React.useEffect(() => {
    if (
      state.lastRescue &&
      state.lastRescue !== lastRescueRef.current &&
      state.lastRescue.verdict === 'accept'
    ) {
      setRescuedBadge(true);
      const t = setTimeout(() => setRescuedBadge(false), RESCUED_BADGE_MS);
      lastRescueRef.current = state.lastRescue;
      return () => clearTimeout(t);
    }
    lastRescueRef.current = state.lastRescue;
  }, [state.lastRescue]);

  // --- sheets / popup ---------------------------------------------------------
  const [commandsOpen, setCommandsOpen] = React.useState(false);
  const [popupTarget, setPopupTarget] = React.useState<WordPopupTarget | null>(null);

  // --- actions ----------------------------------------------------------------
  const begin = React.useCallback(() => {
    haptics.select();
    dispatch({ type: run.resumed ? 'RESUME' : 'BEGIN' });
  }, [dispatch, run.resumed]);

  const confirmLeave = React.useCallback(() => {
    if (!inRun) {
      router.back();
      return;
    }
    Alert.alert('Leave the scenario?', 'You can continue later from the hub.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', onPress: () => router.back() },
      {
        text: 'Restart',
        style: 'destructive',
        onPress: () => void run.restart(),
      },
    ]);
  }, [inRun, router, run]);

  // Hardware BACK mid-run goes through the same leave dialog (never a silent pop).
  const confirmLeaveRef = React.useRef(confirmLeave);
  React.useEffect(() => {
    confirmLeaveRef.current = confirmLeave;
  }, [confirmLeave]);
  React.useEffect(() => {
    if (!inRun) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmLeaveRef.current();
      return true;
    });
    return () => sub.remove();
  }, [inRun]);

  const micState: MicVisualState =
    phase.kind === 'listening'
      ? phase.recording === 'idle'
        ? 'ready'
        : 'recording'
      : phase.kind === 'deciding'
        ? 'processing'
        : 'disabled';

  // ----- states ---------------------------------------------------------------
  if (detailQ.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg" style={{ paddingTop: insets.top }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (detailQ.isError) {
    return (
      <View
        className="flex-1 items-center justify-center gap-3 bg-bg px-8"
        style={{ paddingTop: insets.top }}
      >
        <QueryError onRetry={() => void detailQ.refetch()} />
        <BackButton onPress={() => router.back()} />
      </View>
    );
  }
  if (!detail || !spec) {
    return (
      <View
        className="flex-1 items-center justify-center gap-3 bg-bg px-8"
        style={{ paddingTop: insets.top }}
      >
        <Ionicons name="cloud-offline-outline" size={40} color={theme.textMuted} />
        <Text className="font-ui-medium text-lg">Контент удалён</Text>
        <Text variant="muted" className="text-center">
          This scenario&apos;s pack is no longer installed. Your runs are kept and reconnect when it
          is reinstalled.
        </Text>
        <BackButton onPress={() => router.back()} />
      </View>
    );
  }

  if (run.finish) {
    const ending = detail.endings.find((e) => e.id === run.finish!.endingId) ?? detail.endings[0]!;
    const next = nextRung(families.data ?? [], detail.scenario);
    return (
      <EndingCard
        ending={ending}
        stats={run.finish.stats}
        newEnding={run.finish.newEnding}
        xp={run.finish.xp}
        nextLevel={next?.level ?? null}
        onDebrief={() => {
          track('scenario_runs_list_opened', { scenarioId: detail.scenario.id, runs: 1 });
          router.push({ pathname: '/scenarios/runs', params: { scenarioId: detail.scenario.id } });
        }}
        onAgain={() => void run.restart()}
        onNext={() => {
          if (!next) return;
          track('scenario_opened', { familyId: next.familyId, level: next.level, from: 'ending' });
          router.replace(`/scenario/${next.packId}/${next.id}`);
        }}
        onClose={() => router.back()}
      />
    );
  }

  if (phase.kind === 'intro') {
    return (
      <IntroCard
        detail={detail}
        spec={spec}
        resumed={run.resumed}
        onStart={begin}
        onRestart={() => void run.restart()}
        onClose={() => router.back()}
      />
    );
  }

  const lifeline = turn?.retry?.lifeline ?? null;
  const promptSentence = prefs.subtitles && line?.sentence && playing ? line.sentence : null;

  return (
    <View className="flex-1 bg-bg">
      {/* scene band ~62 % */}
      <View style={{ flex: 62 }}>
        <ScenarioScene
          spec={spec}
          pose={pose}
          shape={shape}
          active={phase.kind !== 'paused'}
          style={FILL}
        />
        <View
          className="absolute left-0 right-0 flex-row items-center gap-2 px-3"
          style={{ top: insets.top + 6 }}
        >
          <View className="flex-1 flex-row items-center gap-2 rounded-full bg-scrim/40 px-3 py-1.5">
            <Text className="font-ui-medium text-sm" numberOfLines={1}>
              {detail.scenario.titleRu}
            </Text>
            <ProgressDots visited={run.visited} current={state.turnId} />
          </View>
          <Pressable
            onPress={confirmLeave}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close the scenario"
            className="h-10 w-10 items-center justify-center rounded-full bg-scrim/40 active:opacity-70"
          >
            <Ionicons name="close" size={20} color={theme.text} />
          </Pressable>
        </View>
      </View>

      {/* the glass stage */}
      <View
        className="rounded-t-3xl border-t border-border bg-surface/95 px-5 pt-4"
        style={{ flex: 38, paddingBottom: insets.bottom + 8 }}
      >
        <StateLine state={state} host={hostName} rescued={rescuedBadge} />

        {promptSentence && (
          <View className="mt-2 rounded-xl border border-border bg-bg px-3 py-2">
            <TokenText
              tokens={promptSentence.tokens as TokenRow[]}
              readingStyle={{ ...DIALOGUE_READING_STYLE, fontSize: 17, lineHeight: 26 }}
              onWordPress={(token) =>
                setPopupTarget({
                  token,
                  sentenceId: promptSentence.id,
                  storyId: detail.scenario.id,
                })
              }
              selectionEnabled={false}
              karaokeTokenIndex={subtitles.tokenIndex}
            />
          </View>
        )}

        <View className="mt-2">
          <LifelineChip
            available={state.lifelineAvailable}
            revealed={state.lifelineRevealed}
            lifeline={lifeline}
            onReveal={() => dispatch({ type: 'LIFELINE_TAP' })}
          />
        </View>

        <View className="flex-1 flex-row items-center justify-center gap-6">
          <StageIcon
            icon="help-circle-outline"
            label="Commands"
            onPress={() => setCommandsOpen(true)}
          />
          <MicButton
            state={micState}
            level={run.level}
            holdPrimary={prefs.holdToTalk}
            onTap={() => dispatch({ type: 'MIC_TAP' })}
            onHoldStart={() => dispatch({ type: 'MIC_HOLD_START' })}
            onHoldEnd={() => dispatch({ type: 'MIC_HOLD_END' })}
          />
          <StageIcon
            icon="refresh-outline"
            label="Replay (long-press: slower)"
            disabled={phase.kind !== 'listening' || phase.recording !== 'idle'}
            onPress={() => dispatch({ type: 'REPLAY_TAP' })}
            onLongPress={() => dispatch({ type: 'REPLAY_TAP', slower: true })}
          />
        </View>

        <View className="min-h-9 flex-row items-center justify-center gap-4">
          {playing && !playing.rendered && (
            <Pressable
              onPress={run.lineDone}
              accessibilityRole="button"
              className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
            >
              <Text className="font-ui-medium text-accent">Далее</Text>
              <Ionicons name="arrow-forward" size={15} color={theme.accent} />
            </Pressable>
          )}
          {state.skipAvailable && (phase.kind === 'listening' || phase.kind === 'reacting') && (
            <Pressable
              onPress={() => dispatch({ type: 'SKIP_TAP' })}
              accessibilityRole="button"
              accessibilityLabel="Skip this turn"
              className="px-3 py-1.5 active:opacity-70"
            >
              <Text variant="muted">Пропустить →</Text>
            </Pressable>
          )}
          {!prefs.subtitles && phase.kind === 'listening' && !state.skipAvailable && (
            <Pressable
              onPress={() => setPrefs({ subtitles: true })}
              accessibilityRole="button"
              accessibilityLabel="Turn subtitles on"
              className="px-3 py-1.5 active:opacity-70"
            >
              <Text variant="caption">субтитры</Text>
            </Pressable>
          )}
        </View>
      </View>

      <CommandsSheet visible={commandsOpen} onClose={() => setCommandsOpen(false)} />
      <WordPopup target={popupTarget} onClose={() => setPopupTarget(null)} />
    </View>
  );
}

/** Visited turns as dots: filled = advanced, hollow = current (branching hides the total). */
function ProgressDots({ visited, current }: { visited: string[]; current: string }) {
  const { tokens: theme } = useAppTheme();
  return (
    <View className="flex-row items-center gap-1" accessibilityLabel={`Turn ${visited.length}`}>
      {visited.map((id) => (
        <View
          key={id}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: id === current ? 'transparent' : theme.accent,
            borderWidth: 1,
            borderColor: theme.accent,
          }}
        />
      ))}
    </View>
  );
}

function StageIcon({
  icon,
  label,
  disabled = false,
  onPress,
  onLongPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 ${
        disabled ? 'opacity-40' : 'active:bg-surface'
      }`}
    >
      <Ionicons name={icon} size={22} color={theme.text} />
    </Pressable>
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
