import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import * as React from 'react';
import { AppState } from 'react-native';

import SherpaSpeech from '../../../modules/sherpa-speech';
import { repos } from '@/db';
import type {
  AnswerOutcome,
  MetaOutcome,
  ScenarioDetail,
  ScenarioRunRow,
} from '@/db/repositories/scenarios';
import { transcribeWav } from '@/features/pronunciation/asr-service';
import { isAssistInstalled, transcribeEnglish } from '@/features/pronunciation/assist-service';
import {
  attemptWavPath,
  cancelAttemptRecording,
  startAttemptRecording,
  stopAttemptRecording,
} from '@/features/pronunciation/recorder';
import { track, type AnalyticsEvent, type AnalyticsProps } from '@/services/analytics';
import { getSpeechService, speak } from '@/services/speech';
import { logError } from '@/services/error-log';

import {
  endpointConfig,
  endpointManualStop,
  endpointStep,
  INITIAL_ENDPOINT,
  type EndpointConfig,
  type EndpointSensitivity,
  type EndpointState,
} from './engine/endpointing';
import { graphFromDetail, replayPath, resumeState } from './engine/path';
import {
  initialState,
  reduce,
  SILENCE_NUDGE_MS,
  type EngineGraph,
  type TurnEffect,
  type TurnEvent,
  type TurnState,
} from './engine/turn-machine';
import { gradeSpokenTurn } from './grade-spoken-turn';
import { judgeAnswer } from './judge/judge';
import { maybeRescue } from './judge/rescue';
import {
  detectMetaIntent,
  resolveExplain,
  resolveHowToSay,
  type GlossaryLookupEntry,
  type MetaResolution,
  type PlayedToken,
} from './meta-intents';
import { fetchExplainLine, fetchHowToSayLine, speakGloss, speakRu, stopPrompter } from './prompter';

/**
 * The effect executor (T60, SPEAKING_SCENARIOS §7.2 / §7.3): the ONE file
 * that touches the recorder, the ASR, Whisper, the judge, the rescue, the
 * meta resolvers, the player, the repos and analytics. No rules live here
 * — every decision is the reducer's; this executes its effects list and
 * dispatches the resulting events back.
 *
 * Run lifecycle: `startRun` on BEGIN (or a resume through
 * `findResumableRun` + `replayPath`), `recordStep` on every PERSIST_STEP,
 * `recordAttempt` on every PERSIST_ATTEMPT (the WAV moved into the run's
 * recordings dir — T63 transcodes), `finishRun` on FINISH. One
 * `game_sessions` row per run (`startGameSession('scenario', { runId })`),
 * closed at the ending with itemCount = answered turns and correctCount =
 * turns matched without lifeline/skip (§5.4).
 */

export interface ScenarioRunPrefs {
  holdToTalk: boolean;
  rescueOnline: boolean;
  endpointSensitivity: EndpointSensitivity;
}

export const DEFAULT_RUN_PREFS: ScenarioRunPrefs = {
  holdToTalk: false,
  rescueOnline: true,
  endpointSensitivity: 'normal',
};

export interface PlaybackInfo {
  sentenceId: string;
  rate: number;
  mouthScale: number;
  /** The audio row's mouth track (null ⇒ speech-service fallback / muppet mouth). */
  mouth: string | null;
  durationMs: number | null;
  /** True when a pre-rendered file is playing (false ⇒ Piper/system fallback). */
  rendered: boolean;
}

export interface UseScenarioRunResult {
  state: TurnState;
  run: ScenarioRunRow | null;
  resumed: boolean;
  playback: PlaybackInfo | null;
  /** Live endpointing readout (the lab's meter + the run screen's ring). */
  endpoint: EndpointState;
  level: number;
  dispatch: (event: TurnEvent) => void;
  /** The screen's «Далее» when a line has no audio (speech-service fallback has no completion callback). */
  lineDone: () => void;
  /** Force a fresh run (abandon the current one in place). */
  restart: () => Promise<void>;
  endpointConfig: EndpointConfig;
  setEndpointOverrides: (o: Partial<EndpointConfig>) => void;
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

function glossaryLookup(detail: ScenarioDetail): GlossaryLookupEntry[] {
  return detail.glossary.map((g) => ({
    id: g.id,
    ru: g.ru,
    en: g.en,
    forms: g.forms,
    translit: g.translit,
  }));
}

export function useScenarioRun(
  detail: ScenarioDetail | null | undefined,
  prefs: ScenarioRunPrefs = DEFAULT_RUN_PREFS,
): UseScenarioRunResult {
  const graph = React.useMemo(() => (detail ? graphFromDetail(detail) : null), [detail]);
  const [state, setState] = React.useState<TurnState | null>(null);
  const [run, setRun] = React.useState<ScenarioRunRow | null>(null);
  const [resumed, setResumed] = React.useState(false);
  const [playback, setPlayback] = React.useState<PlaybackInfo | null>(null);
  const [endpoint, setEndpoint] = React.useState<EndpointState>(INITIAL_ENDPOINT);
  const [level, setLevel] = React.useState(0);
  const [overrides, setOverrides] = React.useState<Partial<EndpointConfig>>({});
  const epConfig = React.useMemo(
    () => endpointConfig(prefs.endpointSensitivity, overrides),
    [prefs.endpointSensitivity, overrides],
  );

  const stateRef = React.useRef<TurnState | null>(null);
  const graphRef = React.useRef<EngineGraph | null>(null);
  const detailRef = React.useRef<ScenarioDetail | null>(null);
  const runRef = React.useRef<ScenarioRunRow | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const prefsRef = React.useRef(prefs);
  const epRef = React.useRef<EndpointState>(INITIAL_ENDPOINT);
  const epConfigRef = React.useRef(epConfig);
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const silenceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const playedRef = React.useRef<PlayedToken[]>([]);
  const lastWavRef = React.useRef<string | null>(null);
  const finishedRef = React.useRef(false);
  const queueRef = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    prefsRef.current = prefs;
    epConfigRef.current = epConfig;
    graphRef.current = graph;
    detailRef.current = detail ?? null;
  }, [prefs, epConfig, graph, detail]);

  // --- persistence helpers ------------------------------------------------

  const ensureRun = React.useCallback(async (): Promise<ScenarioRunRow | null> => {
    if (runRef.current) return runRef.current;
    const d = detailRef.current;
    const g = graphRef.current;
    if (!d || !g) return null;
    const session = await repos.stats.startGameSession('scenario', {});
    const row = await repos.scenarios.startRun({
      packId: d.scenario.packId,
      scenarioId: d.scenario.id,
      familyId: d.scenario.familyId,
      level: d.scenario.level,
      startTurnId: g.startTurnId,
      gameSessionId: session.id,
    });
    sessionIdRef.current = session.id;
    runRef.current = row;
    finishedRef.current = false;
    setRun(row);
    track('scenario_run_started', {
      scenarioId: d.scenario.id,
      level: d.scenario.level,
      resumed: false,
    });
    return row;
  }, []);

  // --- player ---------------------------------------------------------------

  const releasePlayer = React.useCallback(() => {
    const p = playerRef.current;
    playerRef.current = null;
    if (p) {
      try {
        p.pause();
        p.release();
      } catch {
        // already released
      }
    }
  }, []);

  const stopAudio = React.useCallback(() => {
    releasePlayer();
    void getSpeechService().stop();
    void stopPrompter();
    setPlayback(null);
  }, [releasePlayer]);

  // --- silence nudge timer ----------------------------------------------------

  const disarmSilence = React.useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  }, []);

  // --- the dispatcher (serialized) -----------------------------------------------

  const dispatchRef = React.useRef<(event: TurnEvent) => void>(() => undefined);

  const play = React.useCallback(
    (item: { sentenceId: string; rate: number; mouthScale: number }) => {
      const d = detailRef.current;
      releasePlayer();
      const line = d?.lines[item.sentenceId];
      const uri = line?.audio?.localUri ?? null;
      const sentence = line?.sentence ?? null;
      if (sentence) {
        // Remember what the host has said (the «что значит» played-token set).
        for (const t of sentence.tokens) {
          if (t.isPunct) continue;
          playedRef.current.push({ text: t.text, lemma: t.lemma, translation: t.translation });
        }
      }
      if (uri && fileExists(uri)) {
        try {
          const player = createAudioPlayer({ uri }, { updateInterval: 250 });
          playerRef.current = player;
          if (item.rate !== 1) player.setPlaybackRate(item.rate, 'high');
          let done = false;
          player.addListener('playbackStatusUpdate', (s) => {
            if (done || !s.didJustFinish) return;
            done = true;
            if (playerRef.current === player) {
              releasePlayer();
              setPlayback(null);
              dispatchRef.current({ type: 'LINE_DONE' });
            }
          });
          player.play();
          setPlayback({
            sentenceId: item.sentenceId,
            rate: item.rate,
            mouthScale: item.mouthScale,
            mouth: line?.audio?.mouth ?? null,
            durationMs: line?.audio?.durationMs ?? null,
            rendered: true,
          });
          return;
        } catch (err) {
          logError('manual', err);
        }
      }
      // Speech-service fallback (§12 "a line's audio file missing"): the screen's «Далее» ends it.
      setPlayback({
        sentenceId: item.sentenceId,
        rate: item.rate,
        mouthScale: item.mouthScale,
        mouth: null,
        durationMs: null,
        rendered: false,
      });
      if (sentence?.ru) void speak(sentence.ru, { rate: item.rate });
    },
    [releasePlayer],
  );

  const decide = React.useCallback(
    async (transcript: string, turnId: string, wavPath: string | null) => {
      const d = detailRef.current;
      const g = graphRef.current;
      if (!d || !g) return;
      const turn = g.turns.find((t) => t.id === turnId);
      const detection = detectMetaIntent(transcript, d.scenario.language);
      if (detection) {
        const glossary = glossaryLookup(d);
        const clips = g.glossaryClips;
        let resolution: MetaResolution;
        if (detection.intent === 'explain') {
          resolution = await resolveExplain(detection, {
            glossary,
            explainSentenceId: (id) => clips[id]?.explain ?? null,
            played: playedRef.current,
            online: fetchExplainLine,
          });
        } else if (detection.intent === 'howtosay') {
          resolution = await resolveHowToSay(detection, {
            glossary,
            howToSaySentenceId: (id) => clips[id]?.howToSay ?? null,
            whisper:
              wavPath && isAssistInstalled()
                ? async () => (await transcribeEnglish(wavPath)).text
                : undefined,
            online: fetchHowToSayLine,
          });
        } else {
          resolution = { intent: detection.intent } as MetaResolution;
        }
        dispatchRef.current({ type: 'META', detection, resolution });
        return;
      }
      if (!turn?.expect) {
        dispatchRef.current({
          type: 'JUDGED',
          result: judgeAnswer('', {
            slots: [{ kind: 'free', id: 'x', required: true, minTokens: 1 }],
            accept: [' '],
          }),
        });
        return;
      }
      const startedAt = Date.now();
      const result = judgeAnswer(transcript, turn.expect);
      track('scenario_judge', {
        outcome: result.verdict,
        slotsHit: result.slotResults.filter((s) => s.required && s.hit !== null).length,
        slotsRequired: result.slotResults.filter((s) => s.required).length,
        score: result.score,
        margin: result.score - 60,
        ms: Date.now() - startedAt,
      });
      dispatchRef.current({ type: 'JUDGED', result });
    },
    [],
  );

  const rescue = React.useCallback(
    async (judge: TurnState['lastJudge'], transcript: string, turnId: string) => {
      const d = detailRef.current;
      const g = graphRef.current;
      const turn = g?.turns.find((t) => t.id === turnId);
      if (!d || !turn?.expect || !judge) {
        dispatchRef.current({ type: 'RESCUED', outcome: null });
        return;
      }
      const promptLine = d.lines[turn.say[turn.say.length - 1]!]?.sentence;
      const allowedKeys =
        typeof turn.next === 'object' && turn.next ? Object.keys(turn.next.on) : [];
      const outcome = await maybeRescue(
        judge,
        {
          language: d.scenario.language,
          questionRu: promptLine?.ru ?? '',
          questionEn: promptLine?.en ?? '',
          slots: turn.expect.slots,
          accept: turn.expect.accept,
          allowedKeys,
          transcript,
        },
        { rescueOnline: prefsRef.current.rescueOnline },
      );
      dispatchRef.current({ type: 'RESCUED', outcome });
    },
    [],
  );

  const execute = React.useCallback(
    async (effect: TurnEffect) => {
      switch (effect.type) {
        case 'PLAY':
          play(effect.item);
          return;
        case 'STOP_AUDIO':
          stopAudio();
          return;
        case 'START_REC': {
          epRef.current = INITIAL_ENDPOINT;
          setEndpoint(INITIAL_ENDPOINT);
          await startAttemptRecording();
          return;
        }
        case 'STOP_REC': {
          const decision = endpointManualStop(
            epRef.current,
            epRef.current.elapsedMs,
            effect.reason === 'hold' ? 'hold' : 'manual',
          );
          epRef.current = decision.state;
          setEndpoint(decision.state);
          const res = await stopAttemptRecording().catch(() => null);
          const wavPath = res
            ? res.path.startsWith('file://')
              ? res.path
              : `file://${res.path}`
            : null;
          lastWavRef.current = wavPath;
          dispatchRef.current({
            type: 'ENDPOINT',
            reason: effect.reason,
            wavPath: res && res.durationMs > 0 ? wavPath : null,
            durationMs: res?.durationMs ?? 0,
            speechMs: decision.stop?.speechMs ?? 0,
          });
          return;
        }
        case 'CANCEL_REC':
          await cancelAttemptRecording().catch(() => undefined);
          epRef.current = INITIAL_ENDPOINT;
          setEndpoint(INITIAL_ENDPOINT);
          return;
        case 'TRANSCRIBE': {
          try {
            const r = await transcribeWav(effect.wavPath);
            dispatchRef.current({ type: 'TRANSCRIPT', text: r.text });
          } catch (err) {
            logError('manual', err);
            dispatchRef.current({ type: 'TRANSCRIPT', text: '' });
          }
          return;
        }
        case 'DECIDE':
          await decide(effect.transcript, effect.turnId, effect.wavPath);
          return;
        case 'RESCUE':
          await rescue(effect.judge, effect.transcript, effect.turnId);
          return;
        case 'SPEAK_GLOSS':
          await speakGloss(effect.ru, effect.en);
          return;
        case 'SPEAK_RU':
          await speakRu(effect.text);
          return;
        case 'ARM_SILENCE':
          disarmSilence();
          silenceTimer.current = setTimeout(
            () => dispatchRef.current({ type: 'SILENCE_25S' }),
            SILENCE_NUDGE_MS,
          );
          return;
        case 'DISARM_SILENCE':
          disarmSilence();
          return;
        case 'PERSIST_ATTEMPT': {
          const row = await ensureRun();
          if (!row) return;
          await repos.scenarios.recordAttempt({
            runId: row.id,
            turnId: effect.turnId,
            kind: effect.kind,
            outcome: effect.outcome as AnswerOutcome | MetaOutcome,
            transcript: effect.transcript,
            detail: effect.detail,
            audioFile: effect.audio?.wavPath ?? null,
            audioDurationMs: effect.audio?.durationMs ?? null,
          });
          return;
        }
        case 'GRADE': {
          const turn = graphRef.current?.turns.find((t) => t.id === effect.turnId);
          if (turn) await gradeSpokenTurn(turn, effect.judge);
          return;
        }
        case 'PERSIST_STEP': {
          const row = await ensureRun();
          if (!row) return;
          await repos.scenarios.recordStep(row.id, {
            leaving: effect.leaving,
            nextTurnId: effect.nextTurnId,
          });
          return;
        }
        case 'FINISH': {
          const row = await ensureRun();
          if (!row || finishedRef.current) return;
          finishedRef.current = true;
          const totals = stateRef.current?.totals ?? { answered: 0, clean: 0 };
          const { stats } = await repos.scenarios.finishRun(row.id, { endingId: effect.endingId });
          if (sessionIdRef.current) {
            await repos.stats.finishGameSession(sessionIdRef.current, {
              itemCount: totals.answered,
              correctCount: totals.clean,
              detail: { runId: row.id, endingId: effect.endingId, ...stats },
            });
          }
          track('scenario_run_finished', {
            scenarioId: row.scenarioId,
            endingId: effect.endingId,
            turns: stats.turns,
            cleanTurns: stats.cleanTurns,
            misses: stats.misses,
          });
          return;
        }
        case 'TRACK':
          track(effect.event as AnalyticsEvent, effect.props as AnalyticsProps);
          return;
        default:
          return;
      }
    },
    [decide, disarmSilence, ensureRun, play, rescue, stopAudio],
  );

  const dispatch = React.useCallback(
    (event: TurnEvent) => {
      const g = graphRef.current;
      const s = stateRef.current;
      if (!g || !s) return;
      const { state: next, effects } = reduce(g, s, event);
      stateRef.current = next;
      setState(next);
      // Effects run in order, serialized across dispatches; a failure is logged, never fatal.
      queueRef.current = queueRef.current.then(async () => {
        for (const effect of effects) {
          try {
            await execute(effect);
          } catch (err) {
            logError('manual', err);
          }
        }
      });
    },
    [execute],
  );
  React.useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  // --- init: resume-in-place or fresh ---------------------------------------------

  React.useEffect(() => {
    if (!graph || !detail) return;
    let cancelled = false;
    void (async () => {
      let initial = initialState(graph);
      let existing: ScenarioRunRow | null = null;
      let didResume = false;
      try {
        const candidate = await repos.scenarios.findResumableRun(detail.scenario.id);
        const path = candidate ? repos.scenarios.parseRunPath(candidate) : null;
        if (candidate && path) {
          const replay = replayPath(graph, path);
          const restored = resumeState(graph, replay);
          if (restored && replay.endingId === null) {
            initial = restored;
            existing = candidate;
            didResume = true;
          }
        }
      } catch (err) {
        logError('manual', err);
      }
      if (cancelled) return;
      stateRef.current = initial;
      runRef.current = existing;
      sessionIdRef.current = existing?.gameSessionId ?? null;
      finishedRef.current = false;
      playedRef.current = [];
      setRun(existing);
      setResumed(didResume);
      setState(initial);
      if (didResume) track('scenario_run_resumed', { scenarioId: detail.scenario.id });
    })();
    return () => {
      cancelled = true;
    };
  }, [graph, detail]);

  // --- level events → endpointing --------------------------------------------------

  React.useEffect(() => {
    const sub = SherpaSpeech.addListener('onRecordingLevel', ({ level: l, elapsedMs }) => {
      setLevel(l);
      const s = stateRef.current;
      if (!s || s.phase.kind !== 'listening' || s.phase.recording !== 'tap') return;
      const decision = endpointStep(epRef.current, { level: l, elapsedMs }, epConfigRef.current);
      epRef.current = decision.state;
      setEndpoint(decision.state);
      if (!decision.stop) return;
      const { reason, speechMs } = decision.stop;
      void (async () => {
        const res = await stopAttemptRecording().catch(() => null);
        const wavPath = res
          ? res.path.startsWith('file://')
            ? res.path
            : `file://${res.path}`
          : null;
        lastWavRef.current = wavPath;
        dispatchRef.current({
          type: 'ENDPOINT',
          reason,
          wavPath: reason === 'no-speech' ? null : wavPath,
          durationMs: res?.durationMs ?? 0,
          speechMs,
        });
      })();
    });
    return () => sub.remove();
  }, []);

  // --- app state -------------------------------------------------------------------

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive')
        dispatchRef.current({ type: 'APP_BACKGROUND' });
      else if (next === 'active') dispatchRef.current({ type: 'APP_FOREGROUND' });
    });
    return () => sub.remove();
  }, []);

  // --- unmount: stop everything, keep the run resumable ---------------------------------

  React.useEffect(
    () => () => {
      disarmSilence();
      releasePlayer();
      void getSpeechService().stop();
      void stopPrompter();
      void cancelAttemptRecording().catch(() => undefined);
    },
    [disarmSilence, releasePlayer],
  );

  const restart = React.useCallback(async () => {
    const g = graphRef.current;
    const d = detailRef.current;
    if (!g || !d) return;
    stopAudio();
    disarmSilence();
    const old = runRef.current;
    if (old && old.finishedAt == null && sessionIdRef.current) {
      const totals = stateRef.current?.totals ?? { answered: 0, clean: 0 };
      await repos.stats.finishGameSession(sessionIdRef.current, {
        itemCount: totals.answered,
        correctCount: totals.clean,
        detail: { runId: old.id, abandoned: true },
      });
      track('scenario_run_abandoned', { scenarioId: d.scenario.id });
    }
    runRef.current = null;
    sessionIdRef.current = null;
    playedRef.current = [];
    const fresh = initialState(g);
    stateRef.current = fresh;
    setRun(null);
    setResumed(false);
    setState(fresh);
  }, [disarmSilence, stopAudio]);

  const lineDone = React.useCallback(() => dispatch({ type: 'LINE_DONE' }), [dispatch]);

  return {
    state:
      state ??
      (graph
        ? initialState(graph)
        : {
            ...initialState({
              scenarioId: '',
              startTurnId: '',
              turns: [],
              nudges: [],
              glossaryClips: {},
            }),
          }),
    run,
    resumed,
    playback,
    endpoint,
    level,
    dispatch,
    lineDone,
    restart,
    endpointConfig: epConfig,
    setEndpointOverrides: (o) => setOverrides((prev) => ({ ...prev, ...o })),
  };
}

export { attemptWavPath };
