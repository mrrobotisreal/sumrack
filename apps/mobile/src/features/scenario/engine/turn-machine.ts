import type {
  AttemptDetail,
  ScenarioRunStep,
  ScenarioTurnRuntime,
} from '@/db/repositories/scenarios';

import type { JudgeResult } from '../judge/judge';
import type { RescueOutcome } from '../judge/rescue';
import {
  SLOWER_MOUTH_SCALE,
  SLOWER_RATE,
  type MetaDetection,
  type MetaResolution,
} from '../meta-intents';
import type { EndpointReason } from './endpointing';

/**
 * The turn state machine (T60, SPEAKING_SCENARIOS §7.2): a PURE reducer
 * `reduce(graph, state, event) → { state, effects }` — the T27 `engine.ts`
 * philosophy. It owns every rule of a run (the miss ladder, lifeline/skip
 * availability, the silence nudge, meta-intent handling, background
 * behaviour, branching, the ending) and touches nothing: the effects list
 * is executed by `use-scenario-run.ts` (recorder, ASR, judge, rescue,
 * player, repos, analytics), which contains no rules.
 *
 * Phases: intro → saying(lineIdx) → listening → deciding → reacting(kind)
 * → (listening | next turn's saying(0)) → … → ending. `paused` is the
 * background phase.
 *
 * Recorded T60 decisions (the design leaves them open):
 * - **no-speech is not a miss** (an endpoint with no speech, or a
 *   transcript with zero tokens): the machine re-arms in `listening`,
 *   nothing is persisted (`AnswerOutcome` has no such member), one
 *   `scenario_endpoint {reason:'no-speech'}` is tracked.
 * - **Skip persists an attempt** with outcome `'skipped'` (T58 declared the
 *   member) so the debrief shows the skipped turn in sequence.
 * - **«я не понимаю» plays the hint only** (design wording), then listens;
 *   the miss ladder plays hint + prompt.
 * - **Resume replays the prompt line** (the T27 "current line replays"
 *   precedent) and lands in `listening`; a background/foreground cycle
 *   lands in `listening` WITHOUT a replay (§7.2) — an interrupted monologue
 *   line replays from its start.
 * - **A miss decides after the rescue**: the machine waits in
 *   `deciding: rescuing` for `RESCUED` (null when the executor's gate
 *   failed, which is immediate) so the confused line never plays before a
 *   verdict that would flip the attempt.
 */

export const SILENCE_NUDGE_MS = 25_000;

export type ReactionKind =
  | 'confused'
  | 'hint'
  | 'second'
  | 'react'
  | 'repeat'
  | 'slower'
  | 'dont-understand'
  | 'explain'
  | 'howtosay'
  | 'which-word'
  | 'dont-know'
  | 'silence';

export interface PlayItem {
  /** Sentence id of the line (glossary clips + nudges included). */
  sentenceId: string;
  rate: number;
  mouthScale: number;
}

export type RecordingMode = 'idle' | 'tap' | 'hold';

export type Phase =
  | { kind: 'intro' }
  | { kind: 'saying'; lineIdx: number }
  | { kind: 'listening'; recording: RecordingMode }
  | { kind: 'deciding'; stage: 'transcribing' | 'deciding' | 'rescuing' | 'resolving-meta' }
  | { kind: 'reacting'; reaction: ReactionKind; queue: PlayItem[]; idx: number }
  | { kind: 'ending'; endingId: string }
  | { kind: 'paused'; resume: Phase };

export interface TurnCounters {
  misses: number;
  assisted: boolean;
  skipped: boolean;
  rescued: boolean;
  meta: number;
  helpUses: number;
  dontUnderstand: number;
}

export interface PendingAttempt {
  wavPath: string | null;
  durationMs: number;
  reason: EndpointReason;
  speechMs: number;
  transcript?: string;
}

export interface TurnState {
  turnId: string;
  phase: Phase;
  counters: TurnCounters;
  lifelineAvailable: boolean;
  lifelineRevealed: boolean;
  skipAvailable: boolean;
  /** The one silence nudge per turn (§7.2). */
  silenceNudged: boolean;
  pending: PendingAttempt | null;
  /** The last judge result of this turn (the lab + debrief chips). */
  lastJudge: JudgeResult | null;
  lastTranscript: string | null;
  lastMeta: { detection: MetaDetection; resolution: MetaResolution } | null;
  lastRescue: RescueOutcome | null;
  /** Run-level totals the finish write needs. */
  totals: { answered: number; clean: number };
  /** Set when the run reached its ending. */
  endingId: string | null;
}

export interface EngineGraph {
  scenarioId: string;
  startTurnId: string;
  turns: readonly ScenarioTurnRuntime[];
  nudges: readonly { kind: 'silence' | 'which-word' | 'dont-know'; sentenceId: string }[];
  /** Glossary entry id → clip sentence ids. */
  glossaryClips: Readonly<Record<string, { explain: string; howToSay: string }>>;
}

export type TurnEvent =
  | { type: 'BEGIN' }
  /** T62: continue a resumed run from the intro card (counters kept, prompt replayed, → listening). */
  | { type: 'RESUME' }
  | { type: 'LINE_DONE' }
  | { type: 'MIC_TAP' }
  | { type: 'MIC_HOLD_START' }
  | { type: 'MIC_HOLD_END' }
  | {
      type: 'ENDPOINT';
      reason: EndpointReason;
      wavPath: string | null;
      durationMs: number;
      speechMs: number;
    }
  | { type: 'TRANSCRIPT'; text: string }
  | { type: 'META'; detection: MetaDetection; resolution: MetaResolution }
  | { type: 'JUDGED'; result: JudgeResult }
  | { type: 'RESCUED'; outcome: RescueOutcome | null }
  | { type: 'LIFELINE_TAP' }
  | { type: 'SKIP_TAP' }
  /** ⟳ (T62 §9.3): replay the prompt; `slower` = the long-press 0.8× variant. */
  | { type: 'REPLAY_TAP'; slower?: boolean }
  | { type: 'SILENCE_25S' }
  | { type: 'APP_BACKGROUND' }
  | { type: 'APP_FOREGROUND' };

export type TurnEffect =
  | { type: 'PLAY'; item: PlayItem }
  | { type: 'STOP_AUDIO' }
  | { type: 'START_REC' }
  | { type: 'STOP_REC'; reason: EndpointReason }
  | { type: 'CANCEL_REC' }
  | { type: 'TRANSCRIBE'; wavPath: string }
  /** Detect a meta-intent, else judge — the executor dispatches META or JUDGED. */
  | { type: 'DECIDE'; transcript: string; turnId: string; wavPath: string | null }
  | { type: 'RESCUE'; judge: JudgeResult; transcript: string; turnId: string }
  /** Суфлёр lines (dynamic, never pre-rendered). */
  | { type: 'SPEAK_GLOSS'; ru: string; en: string }
  | { type: 'SPEAK_RU'; text: string }
  | { type: 'ARM_SILENCE' }
  | { type: 'DISARM_SILENCE' }
  | {
      type: 'PERSIST_ATTEMPT';
      turnId: string;
      kind: 'answer' | 'meta';
      outcome: string;
      transcript: string;
      detail: AttemptDetail;
      audio: { wavPath: string | null; durationMs: number } | null;
    }
  | { type: 'GRADE'; turnId: string; judge: JudgeResult }
  | { type: 'PERSIST_STEP'; leaving: Partial<Omit<ScenarioRunStep, 'turnId'>>; nextTurnId?: string }
  | { type: 'FINISH'; endingId: string }
  | { type: 'TRACK'; event: string; props: Record<string, string | number | boolean> };

export interface Reduction {
  state: TurnState;
  effects: TurnEffect[];
}

// --- helpers ------------------------------------------------------------

export function turnById(graph: EngineGraph, id: string): ScenarioTurnRuntime | undefined {
  return graph.turns.find((t) => t.id === id);
}

/** Where a turn goes for a branch key (null ⇒ default / linear). */
export function resolveNext(turn: ScenarioTurnRuntime, branchKey: string | null): string | null {
  if (!turn.next) return null;
  if (typeof turn.next === 'string') return turn.next;
  return (branchKey !== null ? turn.next.on[branchKey] : undefined) ?? turn.next.default;
}

function promptId(turn: ScenarioTurnRuntime): string {
  return turn.say[turn.say.length - 1]!;
}

function nudgeId(graph: EngineGraph, kind: 'silence' | 'which-word' | 'dont-know'): string | null {
  return graph.nudges.find((n) => n.kind === kind)?.sentenceId ?? null;
}

const NORMAL: Pick<PlayItem, 'rate' | 'mouthScale'> = { rate: 1, mouthScale: 1 };

function item(sentenceId: string, rate = 1, mouthScale = 1): PlayItem {
  return { sentenceId, rate, mouthScale };
}

export function freshCounters(): TurnCounters {
  return {
    misses: 0,
    assisted: false,
    skipped: false,
    rescued: false,
    meta: 0,
    helpUses: 0,
    dontUnderstand: 0,
  };
}

export function initialState(graph: EngineGraph, turnId: string = graph.startTurnId): TurnState {
  return {
    turnId,
    phase: { kind: 'intro' },
    counters: freshCounters(),
    lifelineAvailable: false,
    lifelineRevealed: false,
    skipAvailable: false,
    silenceNudged: false,
    pending: null,
    lastJudge: null,
    lastTranscript: null,
    lastMeta: null,
    lastRescue: null,
    totals: { answered: 0, clean: 0 },
    endingId: null,
  };
}

/** Counters → the `ScenarioRunStep` fields recordStep merges onto the step being left. */
export function stepCounters(
  c: TurnCounters,
  branchKey?: string | null,
): Partial<Omit<ScenarioRunStep, 'turnId'>> {
  return {
    misses: c.misses,
    assisted: c.assisted,
    skipped: c.skipped,
    rescued: c.rescued,
    meta: c.meta,
    ...(branchKey ? { branchKey } : {}),
  };
}

function trackEffect(event: string, props: Record<string, string | number | boolean>): TurnEffect {
  return { type: 'TRACK', event, props };
}

function listening(state: TurnState, extra: TurnEffect[] = []): Reduction {
  return {
    state: { ...state, phase: { kind: 'listening', recording: 'idle' }, pending: null },
    effects: [...extra, { type: 'ARM_SILENCE' }],
  };
}

function react(
  state: TurnState,
  reaction: ReactionKind,
  queue: PlayItem[],
  extra: TurnEffect[] = [],
): Reduction {
  if (queue.length === 0) return listening(state, extra);
  return {
    state: { ...state, phase: { kind: 'reacting', reaction, queue, idx: 0 }, pending: null },
    effects: [...extra, { type: 'PLAY', item: queue[0]! }],
  };
}

/** Enter a turn: play its first line (the turn's counters are fresh). */
function enterTurn(
  graph: EngineGraph,
  state: TurnState,
  turnId: string,
  extra: TurnEffect[] = [],
): Reduction {
  const turn = turnById(graph, turnId);
  if (!turn) {
    return {
      state,
      effects: [...extra, trackEffect('app_error', { code: 'scenario-missing-turn' })],
    };
  }
  return {
    state: {
      ...state,
      turnId,
      phase: { kind: 'saying', lineIdx: 0 },
      counters: freshCounters(),
      lifelineAvailable: false,
      lifelineRevealed: false,
      skipAvailable: false,
      silenceNudged: false,
      pending: null,
      lastJudge: null,
      lastTranscript: null,
      lastMeta: null,
      lastRescue: null,
    },
    effects: [...extra, { type: 'PLAY', item: item(turn.say[0]!) }],
  };
}

/** Leave the current turn along `branchKey` (persist the step, then enter the next turn or end). */
function advance(
  graph: EngineGraph,
  state: TurnState,
  branchKey: string | null,
  extra: TurnEffect[] = [],
): Reduction {
  const turn = turnById(graph, state.turnId);
  if (!turn) return { state, effects: extra };
  const leaving = stepCounters(state.counters, branchKey);
  if (turn.endingId) {
    return {
      state: {
        ...state,
        phase: { kind: 'ending', endingId: turn.endingId },
        endingId: turn.endingId,
        pending: null,
      },
      effects: [
        ...extra,
        { type: 'PERSIST_STEP', leaving },
        { type: 'FINISH', endingId: turn.endingId },
      ],
    };
  }
  const nextId = resolveNext(turn, branchKey);
  if (!nextId)
    return { state, effects: [...extra, trackEffect('app_error', { code: 'scenario-no-next' })] };
  return enterTurn(graph, state, nextId, [
    ...extra,
    { type: 'PERSIST_STEP', leaving, nextTurnId: nextId },
    trackEffect('scenario_turn_advanced', {
      turnId: state.turnId,
      misses: state.counters.misses,
      assisted: state.counters.assisted,
      branchKey: branchKey ?? 'default',
    }),
  ]);
}

function answerDetail(judge: JudgeResult): AttemptDetail {
  return {
    kind: 'answer',
    target: judge.target,
    words: judge.words.map((w) => ({
      display: w.display,
      target: w.target,
      heard: w.heard,
      matched: w.matched,
    })),
    score: judge.score,
    slots: judge.slots,
  };
}

function persistAnswer(
  state: TurnState,
  outcome: 'matched' | 'rescued' | 'miss' | 'skipped',
  transcript: string,
  judge: JudgeResult | null,
): TurnEffect {
  const detail: AttemptDetail = judge
    ? answerDetail(judge)
    : { kind: 'answer', target: '', words: [], score: 0, slots: {} };
  return {
    type: 'PERSIST_ATTEMPT',
    turnId: state.turnId,
    kind: 'answer',
    outcome,
    transcript,
    detail,
    audio: state.pending
      ? { wavPath: state.pending.wavPath, durationMs: state.pending.durationMs }
      : null,
  };
}

// --- the reducer ---------------------------------------------------------

export function reduce(graph: EngineGraph, state: TurnState, event: TurnEvent): Reduction {
  const turn = turnById(graph, state.turnId);
  const phase = state.phase;

  // Background/foreground apply in every phase.
  if (event.type === 'APP_BACKGROUND') {
    if (phase.kind === 'paused' || phase.kind === 'ending') return { state, effects: [] };
    const effects: TurnEffect[] = [{ type: 'STOP_AUDIO' }, { type: 'DISARM_SILENCE' }];
    if (phase.kind === 'listening' && phase.recording !== 'idle')
      effects.push({ type: 'CANCEL_REC' });
    return {
      state: { ...state, phase: { kind: 'paused', resume: phase }, pending: null },
      effects,
    };
  }
  if (event.type === 'APP_FOREGROUND') {
    if (phase.kind !== 'paused' || !turn) return { state, effects: [] };
    const resume = phase.resume;
    if (resume.kind === 'intro') return { state: { ...state, phase: resume }, effects: [] };
    // A monologue turn (or a line mid-play) replays the interrupted line; an expecting turn lands in listening.
    if (!turn.expect || resume.kind === 'saying') {
      const lineIdx = resume.kind === 'saying' ? resume.lineIdx : 0;
      return {
        state: { ...state, phase: { kind: 'saying', lineIdx } },
        effects: [{ type: 'PLAY', item: item(turn.say[lineIdx] ?? turn.say[0]!) }],
      };
    }
    return listening(state);
  }
  if (phase.kind === 'paused') return { state, effects: [] }; // everything else waits

  switch (event.type) {
    case 'BEGIN': {
      if (phase.kind !== 'intro') return { state, effects: [] };
      return enterTurn(graph, state, state.turnId);
    }

    case 'RESUME': {
      // §7.3 / T27 decision 2: the restored turn keeps its counters and
      // lifeline/skip flags; an expecting turn replays its prompt line and
      // lands in listening, a monologue turn simply plays from its start.
      if (phase.kind !== 'intro' || !turn) return { state, effects: [] };
      if (!turn.expect) {
        return {
          state: { ...state, phase: { kind: 'saying', lineIdx: 0 }, pending: null },
          effects: [{ type: 'PLAY', item: item(turn.say[0]!) }],
        };
      }
      return react(state, 'repeat', [item(promptId(turn))]);
    }

    case 'LINE_DONE': {
      if (!turn) return { state, effects: [] };
      if (phase.kind === 'saying') {
        const nextIdx = phase.lineIdx + 1;
        if (nextIdx < turn.say.length) {
          return {
            state: { ...state, phase: { kind: 'saying', lineIdx: nextIdx } },
            effects: [{ type: 'PLAY', item: item(turn.say[nextIdx]!) }],
          };
        }
        if (turn.expect) return listening(state);
        return advance(graph, state, null);
      }
      if (phase.kind === 'reacting') {
        const nextIdx = phase.idx + 1;
        if (nextIdx < phase.queue.length) {
          return {
            state: { ...state, phase: { ...phase, idx: nextIdx } },
            effects: [{ type: 'PLAY', item: phase.queue[nextIdx]! }],
          };
        }
        return listening(state);
      }
      return { state, effects: [] };
    }

    case 'MIC_TAP': {
      if (phase.kind !== 'listening') return { state, effects: [] };
      if (phase.recording === 'idle') {
        return {
          state: { ...state, phase: { kind: 'listening', recording: 'tap' } },
          effects: [{ type: 'DISARM_SILENCE' }, { type: 'START_REC' }],
        };
      }
      if (phase.recording === 'tap')
        return { state, effects: [{ type: 'STOP_REC', reason: 'manual' }] };
      return { state, effects: [] };
    }

    case 'MIC_HOLD_START': {
      if (phase.kind !== 'listening' || phase.recording !== 'idle') return { state, effects: [] };
      return {
        state: { ...state, phase: { kind: 'listening', recording: 'hold' } },
        effects: [{ type: 'DISARM_SILENCE' }, { type: 'START_REC' }],
      };
    }

    case 'MIC_HOLD_END': {
      if (phase.kind !== 'listening' || phase.recording !== 'hold') return { state, effects: [] };
      return { state, effects: [{ type: 'STOP_REC', reason: 'hold' }] };
    }

    case 'ENDPOINT': {
      if (phase.kind !== 'listening' || phase.recording === 'idle') return { state, effects: [] };
      const track = trackEffect('scenario_endpoint', {
        reason: event.reason,
        speechMs: event.speechMs,
      });
      if (event.reason === 'no-speech' || !event.wavPath) return listening(state, [track]);
      const pending: PendingAttempt = {
        wavPath: event.wavPath,
        durationMs: event.durationMs,
        reason: event.reason,
        speechMs: event.speechMs,
      };
      return {
        state: { ...state, phase: { kind: 'deciding', stage: 'transcribing' }, pending },
        effects: [track, { type: 'TRANSCRIBE', wavPath: event.wavPath }],
      };
    }

    case 'TRANSCRIPT': {
      if (phase.kind !== 'deciding' || phase.stage !== 'transcribing')
        return { state, effects: [] };
      const text = event.text.trim();
      const pending = state.pending ? { ...state.pending, transcript: text } : null;
      if (text.length === 0) {
        return listening({ ...state, lastTranscript: '' }, [
          trackEffect('scenario_endpoint', {
            reason: 'no-speech',
            speechMs: state.pending?.speechMs ?? 0,
          }),
        ]);
      }
      return {
        state: {
          ...state,
          phase: { kind: 'deciding', stage: 'deciding' },
          pending,
          lastTranscript: text,
        },
        effects: [
          {
            type: 'DECIDE',
            transcript: text,
            turnId: state.turnId,
            wavPath: state.pending?.wavPath ?? null,
          },
        ],
      };
    }

    case 'META': {
      if (phase.kind !== 'deciding' || !turn) return { state, effects: [] };
      return handleMeta(graph, state, turn, event.detection, event.resolution);
    }

    case 'JUDGED': {
      if (phase.kind !== 'deciding' || !turn?.expect || !turn.retry) return { state, effects: [] };
      const judge = event.result;
      const transcript = state.pending?.transcript ?? state.lastTranscript ?? '';
      const required = judge.slotResults.filter((s) => s.required);
      const judgeTrack = trackEffect('scenario_judge', {
        outcome: judge.verdict,
        slotsHit: required.filter((s) => s.hit !== null).length,
        slotsRequired: required.length,
        score: judge.score,
        margin: judge.score - 60,
        ms: 0,
      });
      const next: TurnState = { ...state, lastJudge: judge };
      if (judge.verdict === 'no-speech') return listening(next, [judgeTrack]);
      if (judge.verdict === 'matched')
        return matched(graph, next, judge, transcript, 'matched', [judgeTrack]);
      // A miss waits for the rescue verdict (null from the executor when its gate fails).
      return {
        state: { ...next, phase: { kind: 'deciding', stage: 'rescuing' } },
        effects: [judgeTrack, { type: 'RESCUE', judge, transcript, turnId: state.turnId }],
      };
    }

    case 'RESCUED': {
      if (
        phase.kind !== 'deciding' ||
        phase.stage !== 'rescuing' ||
        !turn?.expect ||
        !turn.retry ||
        !state.lastJudge
      ) {
        return { state, effects: [] };
      }
      const judge = state.lastJudge;
      const transcript = state.pending?.transcript ?? state.lastTranscript ?? '';
      const withRescue: TurnState = { ...state, lastRescue: event.outcome };
      if (event.outcome?.verdict === 'accept') {
        const rescuedJudge: JudgeResult = {
          ...judge,
          branchKey: event.outcome.branchKey ?? judge.branchKey,
        };
        return matched(
          graph,
          { ...withRescue, counters: { ...state.counters, rescued: true } },
          rescuedJudge,
          transcript,
          'rescued',
        );
      }
      return miss(graph, withRescue, turn, judge, transcript);
    }

    case 'LIFELINE_TAP': {
      if (!state.lifelineAvailable || state.lifelineRevealed) return { state, effects: [] };
      return {
        state: {
          ...state,
          lifelineRevealed: true,
          counters: { ...state.counters, assisted: true },
        },
        effects: [
          trackEffect('scenario_lifeline_revealed', { turnId: state.turnId }),
          {
            type: 'PERSIST_STEP',
            leaving: stepCounters({ ...state.counters, assisted: true }),
          },
        ],
      };
    }

    case 'SKIP_TAP': {
      if (
        !state.skipAvailable ||
        !turn ||
        (phase.kind !== 'listening' && phase.kind !== 'reacting')
      )
        return { state, effects: [] };
      const skipped: TurnState = {
        ...state,
        counters: { ...state.counters, skipped: true },
        totals: { ...state.totals, answered: state.totals.answered + 1 },
      };
      return advance(graph, skipped, null, [
        { type: 'STOP_AUDIO' },
        { type: 'DISARM_SILENCE' },
        persistAnswer(skipped, 'skipped', '', null),
        trackEffect('scenario_turn_skipped', { turnId: state.turnId }),
      ]);
    }

    case 'REPLAY_TAP': {
      if (phase.kind !== 'listening' || phase.recording !== 'idle' || !turn)
        return { state, effects: [] };
      const slower = event.slower === true;
      return react(
        state,
        slower ? 'slower' : 'repeat',
        [slower ? item(promptId(turn), SLOWER_RATE, SLOWER_MOUTH_SCALE) : item(promptId(turn))],
        [{ type: 'DISARM_SILENCE' }, trackEffect('scenario_line_replayed', { slower })],
      );
    }

    case 'SILENCE_25S': {
      if (phase.kind !== 'listening' || phase.recording !== 'idle' || state.silenceNudged)
        return { state, effects: [] };
      const id = nudgeId(graph, 'silence');
      const nudged: TurnState = { ...state, silenceNudged: true };
      if (!id) return { state: nudged, effects: [] };
      return react(
        nudged,
        'silence',
        [item(id)],
        [trackEffect('scenario_nudge_played', { kind: 'silence' })],
      );
    }

    default:
      return { state, effects: [] };
  }
}

function matched(
  graph: EngineGraph,
  state: TurnState,
  judge: JudgeResult,
  transcript: string,
  outcome: 'matched' | 'rescued',
  extra: TurnEffect[] = [],
): Reduction {
  const clean = state.counters.misses === 0 && !state.counters.assisted && !state.counters.skipped;
  const next: TurnState = {
    ...state,
    totals: { answered: state.totals.answered + 1, clean: state.totals.clean + (clean ? 1 : 0) },
  };
  return advance(graph, next, judge.branchKey, [
    ...extra,
    { type: 'DISARM_SILENCE' },
    persistAnswer(next, outcome, transcript, judge),
    { type: 'GRADE', turnId: state.turnId, judge },
  ]);
}

/** The miss ladder (§7.2). */
function miss(
  graph: EngineGraph,
  state: TurnState,
  turn: ScenarioTurnRuntime,
  judge: JudgeResult,
  transcript: string,
): Reduction {
  const retry = turn.retry!;
  const misses = state.counters.misses + 1;
  const prompt = item(promptId(turn));
  const next: TurnState = {
    ...state,
    counters: { ...state.counters, misses },
    lifelineAvailable: state.lifelineAvailable || misses >= 2,
    skipAvailable: state.skipAvailable || misses >= 3,
  };
  const persisted = persistAnswer(next, 'miss', transcript, judge);
  // T62 (§7.3 / §12 "app killed mid-run"): the open step carries the miss
  // count so a resume restores the ladder (lifeline/skip) — not just attempts.
  const stepSync: TurnEffect = { type: 'PERSIST_STEP', leaving: stepCounters(next.counters) };
  let reaction: ReactionKind;
  let first: string;
  if (misses === 1) {
    const reactId =
      judge.rejectIndex !== null
        ? turn.expect?.reject?.[judge.rejectIndex]?.reactSentenceId
        : undefined;
    if (reactId) {
      reaction = 'react';
      first = reactId;
    } else if (judge.nearMiss) {
      reaction = 'hint';
      first = retry.hint;
    } else {
      reaction = 'confused';
      first = retry.confused;
    }
  } else if (misses === 2) {
    reaction = 'hint';
    first = retry.hint;
  } else {
    reaction = retry.second ? 'second' : 'hint';
    first = retry.second ?? retry.hint;
  }
  return react(
    next,
    reaction,
    [item(first), prompt],
    [{ type: 'DISARM_SILENCE' }, persisted, stepSync],
  );
}

/** Meta-intents (§6): none counts as a miss; every one persists a `meta` attempt. */
function handleMeta(
  graph: EngineGraph,
  state: TurnState,
  turn: ScenarioTurnRuntime,
  detection: MetaDetection,
  resolution: MetaResolution,
): Reduction {
  const counters: TurnCounters = {
    ...state.counters,
    meta: state.counters.meta + 1,
    helpUses: state.counters.helpUses + 1,
    dontUnderstand:
      state.counters.dontUnderstand + (detection.intent === 'dont-understand' ? 1 : 0),
  };
  const base: TurnState = { ...state, counters, lastMeta: { detection, resolution } };
  const prompt = item(promptId(turn));
  const source = 'source' in resolution ? resolution.source : 'none';
  const hit = 'entryId' in resolution ? resolution.entryId : null;
  const detail: AttemptDetail = {
    kind: 'meta',
    query: detection.query,
    hit,
    source: source === 'played' ? 'glossary' : source,
  };
  const persisted: TurnEffect = {
    type: 'PERSIST_ATTEMPT',
    turnId: state.turnId,
    kind: 'meta',
    outcome: detection.intent,
    transcript: state.pending?.transcript ?? state.lastTranscript ?? '',
    detail,
    audio: state.pending
      ? { wavPath: state.pending.wavPath, durationMs: state.pending.durationMs }
      : null,
  };
  const track = trackEffect('scenario_meta', {
    intent: detection.intent,
    source,
    hit: hit !== null || source === 'played' || source === 'online',
  });
  const common: TurnEffect[] = [
    { type: 'DISARM_SILENCE' },
    persisted,
    track,
    { type: 'PERSIST_STEP', leaving: stepCounters(counters) },
  ];

  switch (resolution.intent) {
    case 'repeat':
      return react(
        base,
        'repeat',
        [prompt],
        [...common, trackEffect('scenario_line_replayed', { slower: false })],
      );
    case 'slower':
      return react(
        base,
        'slower',
        [item(promptId(turn), SLOWER_RATE, SLOWER_MOUTH_SCALE)],
        [...common, trackEffect('scenario_line_replayed', { slower: true })],
      );
    case 'dont-understand': {
      const unlock = counters.dontUnderstand >= 2;
      const next: TurnState = { ...base, lifelineAvailable: base.lifelineAvailable || unlock };
      return react(next, 'dont-understand', turn.retry ? [item(turn.retry.hint)] : [], common);
    }
    case 'explain': {
      if (resolution.source === 'glossary')
        return react(base, 'explain', [item(resolution.sentenceId)], common);
      if (resolution.source === 'played' || resolution.source === 'online') {
        return react(
          base,
          'explain',
          [],
          [...common, { type: 'SPEAK_GLOSS', ru: resolution.ru, en: resolution.en }],
        );
      }
      const id = nudgeId(graph, 'which-word');
      const next: TurnState = { ...base, lifelineAvailable: true };
      return react(next, 'which-word', id ? [item(id)] : [], [
        ...common,
        trackEffect('scenario_nudge_played', { kind: 'which-word' }),
      ]);
    }
    case 'howtosay': {
      if (resolution.source === 'glossary' || resolution.source === 'whisper') {
        return react(base, 'howtosay', [item(resolution.sentenceId)], common);
      }
      if (resolution.source === 'online')
        return react(base, 'howtosay', [], [...common, { type: 'SPEAK_RU', text: resolution.ru }]);
      const id = nudgeId(graph, 'dont-know');
      const next: TurnState = { ...base, lifelineAvailable: true };
      return react(next, 'dont-know', id ? [item(id)] : [], [
        ...common,
        trackEffect('scenario_nudge_played', { kind: 'dont-know' }),
      ]);
    }
    default:
      return listening(base, common);
  }
}

export { NORMAL as NORMAL_PLAYBACK };
