import type { Exam, ExamSubtest, ExamSubtestKind } from '@sumrak/schema';

import {
  ExamAttemptStateSchema,
  ExamSpeakingStateSchema,
  isAnswered,
  type ExamAnswer,
  type ExamAttemptState,
  type ExamSpeakingState,
  type SpeakingAnswer,
} from '../model';
import { buildLayout, flatIndexOf } from './layout';
import { speakingTaskOf, type SpeakingTask } from '../grading/speaking';

/**
 * The mock-exam engine (T71, TORFL_EXAM_PREP §8.1) — a PURE reducer in the
 * M17 turn-machine shape: `reduce(ctx, state, event) → {state, effects}`. No
 * clock, DB, audio or React: every time-dependent event carries `now` and
 * every consequence is an effect the executor (`use-exam-run.ts`) performs.
 *
 * - **Deadlines are wall-clock epochs** set at `BEGIN` (`deadlineAt = now +
 *   durationMin`). `TICK` / `RESUME` / `ANSWER` at or past the deadline end the
 *   subtest as an auto-submit — the interval only re-renders, correctness
 *   comes from `deadlineAt − now`, so a kill/restart resumes with the true
 *   remaining time (and submits as-is when it ran out while closed).
 * - **No feedback**: the state never holds a verdict; scoring happens in the
 *   executor (`SCORE_SUBTEST`) from the persisted responses.
 * - **Listening** (`navigation: 'linear'`): the unit is an AUDIO GROUP (items
 *   sharing one recording). Per audio key `playCounts` goes 0 → 1 → (3 s gap)
 *   → 2 → locked; a text interrupted by a kill/background counts as heard
 *   (the interrupted-play rule: it resumes as the NEXT play). Back-navigation
 *   is refused in the reducer; `GOTO` only moves inside the current group.
 * - Writing (T72) runs like an objective subtest: instructions → BEGIN →
 *   `running` with the letter editor; every edit is an `ANSWER` (persisted at
 *   once), `SUBMIT_SUBTEST` / the deadline emit `SCORE_SUBTEST` (the executor
 *   grades offline + enqueues the AI grade).
 * - Speaking (T73, TORFL §8.4) is linear over the three tasks with its own
 *   cursor `state.speaking`: task 1 / 2 items go `prompt` (the examiner line
 *   plays once; `AUDIO_ENDED`) → `recording` (`START_REC`; the recorder hook
 *   stops on the endpointer / cap / «Закончить», transcribes and sends
 *   `REC_DONE {answer}`) → the next item; task 3 goes `choose` (two topics)
 *   → `CHOOSE_TOPIC` → `prep` (8:00 wall-clock) → `PREP_DONE` / the deadline
 *   → `answer` (a fixed 2:00 window; the deadline emits `STOP_REC` and waits
 *   in `processing` for `REC_DONE`). Every part has a time budget
 *   (`part.timeSec`): when it runs out the current recording is stopped and
 *   the part's remaining items are skipped. `SKIP_ITEM` skips the current
 *   item without a response. The 20-min subtest deadline governs overall.
 */

/** Gap between a listening text's two plays (§8.2). */
export const AUDIO_GAP_MS = 3_000;
const MIN_MS = 60_000;

export type RunPhase =
  'intro' | 'instructions' | 'running' | 'break' | 'placeholder' | 'done' | 'abandoned';

export type RunAudioPhase = 'idle' | 'playing' | 'gap' | 'done';

export interface RunSubtest {
  id: string;
  kind: ExamSubtestKind;
  status: 'pending' | 'intro' | 'running' | 'submitted';
  /** Wall-clock epoch (ms). */
  deadlineAt?: number;
  startedAt?: number;
  submittedAt?: number;
  autoSubmitted?: boolean;
  /** A placeholder subtest recorded as skipped (T72/T73 replace it). */
  skipped?: boolean;
  timeUsedSec?: number;
  /** Flat item index of the cursor (listening: first item of the current group). */
  flat: number;
  /** Mirrors `flat` for the T68 cursor contract. */
  partIdx: number;
  itemIdx: number;
}

export interface RunAudio {
  /** Audio owner key of the current group (null = nothing to play). */
  key: string | null;
  phase: RunAudioPhase;
  gapUntil?: number;
}

export interface ExamRunState {
  v: 1;
  subtests: RunSubtest[];
  current: number;
  phase: RunPhase;
  playCounts: Record<string, number>;
  flagged: string[];
  audio: RunAudio;
  /** The speaking subtest's cursor while it runs (T73); null elsewhere. */
  speaking: ExamSpeakingState | null;
  /** In-memory only (the responses table is the truth; hydrated on load, never persisted). */
  answers: Record<string, ExamAnswer>;
}

export interface ExamCtx {
  exam: Exam;
  /** `torfl.prefs.breakBetweenSubtests` — and the scope must have another subtest to break before. */
  breakBetween: boolean;
  /**
   * DEV ONLY (`?devDurationSec=`): replaces every subtest's duration at BEGIN.
   * The route resolves it through `devDurationOverrideSec`, which is `undefined`
   * unless `__DEV__` — a release build can never reach this field.
   */
  durationOverrideSec?: number;
}

export type ExamEvent =
  | { type: 'START'; now: number }
  | { type: 'OPEN_SUBTEST'; index: number }
  | { type: 'BEGIN'; now: number }
  | { type: 'ANSWER'; itemId: string; answer: ExamAnswer; now: number }
  | { type: 'FLAG'; itemId: string }
  | { type: 'GOTO'; flat: number }
  | { type: 'NEXT'; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'SUBMIT_SUBTEST'; now: number }
  | { type: 'AUTO_SUBMIT'; now: number }
  | { type: 'AUDIO_ENDED'; now: number }
  | { type: 'RESUME'; now: number }
  /** The app left the foreground: a play in progress counts as heard (interrupted-play rule). */
  | { type: 'APP_BACKGROUND'; now: number }
  | { type: 'BREAK_DONE' }
  | { type: 'ABANDON' }
  // --- speaking (T73) ---
  /** Task 3: the candidate picked one of the two topics. */
  | { type: 'CHOOSE_TOPIC'; itemId: string; now: number }
  /** Task 3: «Готов» during prep (the deadline does the same through TICK). */
  | { type: 'PREP_DONE'; now: number }
  /** «Пропустить»: the current item gets no response. */
  | { type: 'SKIP_ITEM'; now: number }
  /** The recorder hook finished (stopped → transcribed → persisted): store the answer and move on. */
  | { type: 'REC_DONE'; itemId: string; answer: SpeakingAnswer; now: number };

export type ExamEffect =
  | { type: 'SUBTEST_STARTED'; subtestId: string; kind: ExamSubtestKind }
  | { type: 'PLAY_AUDIO'; subtestId: string; audioKey: string; playNo: number }
  | { type: 'STOP_AUDIO' }
  | { type: 'PERSIST_RESPONSE'; subtestId: string; itemId: string; answer: ExamAnswer }
  /** `urgent`: write now; otherwise the executor throttles (≤ 1 / 5 s + on background). */
  | { type: 'PERSIST_STATE'; urgent: boolean }
  | {
      type: 'SCORE_SUBTEST';
      subtestId: string;
      kind: ExamSubtestKind;
      autoSubmitted: boolean;
      answered: number;
      total: number;
      timeUsedSec: number;
    }
  | { type: 'FINISH' }
  | { type: 'ABANDON' }
  // Speaking (T73): the recorder hook drives from `state.speaking`; these are the engine's record of intent.
  | { type: 'START_REC'; itemId: string; task: SpeakingTask; capMs: number; fixedWindow: boolean }
  | { type: 'STOP_REC' }
  // Declared in T71, unused (the executor enqueues at SCORE_SUBTEST):
  | { type: 'ENQUEUE_GRADING'; subtestId: string };

export interface Transition {
  state: ExamRunState;
  effects: ExamEffect[];
}

const NOOP = (state: ExamRunState): Transition => ({ state, effects: [] });

/** Kinds without a runner: none since T73 (writing became real in T72, speaking in T73). Kept for the callers' shape. */
export function isPlaceholderKind(_kind: ExamSubtestKind): boolean {
  void _kind;
  return false;
}

/** Task 1 / task 2 answer caps (§8.4): 30 s replies, 40 s situations. The endpointer stops earlier on silence. */
export const SPEAKING_CAP_MS: Record<1 | 2, number> = { 1: 30_000, 2: 40_000 };

// --- construction / persistence ------------------------------------------------------

/**
 * A fresh run over `subtestIds` (exam order). `phase: 'intro'` until `START`.
 * The subtests' cursors are the T68 `initialAttemptState` shape plus the
 * loose fields this engine adds.
 */
export function initialRunState(
  exam: Exam,
  subtestIds: readonly string[],
  answers: Record<string, ExamAnswer> = {},
): ExamRunState {
  const wanted = new Set(subtestIds);
  const chosen = exam.subtests.filter((s) => wanted.has(s.id));
  return {
    v: 1,
    subtests: chosen.map((s) => ({
      id: s.id,
      kind: s.kind,
      status: 'pending',
      flat: 0,
      partIdx: 0,
      itemIdx: 0,
    })),
    current: 0,
    phase: 'intro',
    playCounts: {},
    flagged: [],
    audio: { key: null, phase: 'idle' },
    speaking: null,
    answers,
  };
}

/** The JSON written to `exam_attempts.stateJson`: everything but the in-memory answers. */
export function toPersisted(state: ExamRunState): ExamAttemptState {
  const { answers: _answers, ...rest } = state;
  void _answers;
  return ExamAttemptStateSchema.parse(rest);
}

const PHASES: readonly RunPhase[] = [
  'intro',
  'instructions',
  'running',
  'break',
  'placeholder',
  'done',
  'abandoned',
];

/**
 * Rebuild a run from a stored attempt state + the answers read from the
 * responses table. Tolerant: unknown/missing engine fields get defaults, a
 * subtest the pack no longer has is dropped, an unknown phase falls back to
 * `instructions` of the current subtest.
 */
export function hydrate(
  exam: Exam,
  persisted: ExamAttemptState,
  answers: Record<string, ExamAnswer>,
): ExamRunState {
  const byId = new Map(exam.subtests.map((s) => [s.id, s]));
  const subtests: RunSubtest[] = [];
  for (const c of persisted.subtests) {
    const def = byId.get(c.id);
    if (!def) continue;
    const loose = c as Record<string, unknown>;
    const layout = buildLayout(def);
    const flat =
      typeof loose.flat === 'number' ? loose.flat : flatIndexOf(layout, c.partIdx, c.itemIdx);
    const num = (k: string) => (typeof loose[k] === 'number' ? (loose[k] as number) : undefined);
    subtests.push({
      id: c.id,
      kind: def.kind,
      status: c.status,
      deadlineAt: c.deadlineAt,
      startedAt: num('startedAt'),
      submittedAt: num('submittedAt'),
      autoSubmitted: loose.autoSubmitted === true ? true : undefined,
      skipped: loose.skipped === true ? true : undefined,
      timeUsedSec: num('timeUsedSec'),
      flat: Math.min(Math.max(0, flat), Math.max(0, layout.items.length - 1)),
      partIdx: c.partIdx,
      itemIdx: c.itemIdx,
    });
  }
  const rawAudio = (persisted as Record<string, unknown>).audio as Partial<RunAudio> | undefined;
  const audioPhase = (['idle', 'playing', 'gap', 'done'] as const).find(
    (p) => p === rawAudio?.phase,
  );
  const phase = PHASES.find((p) => p === persisted.phase) ?? 'instructions';
  const speakingParsed = ExamSpeakingStateSchema.nullable().safeParse(persisted.speaking ?? null);
  return {
    v: 1,
    subtests,
    current: Math.min(persisted.current, Math.max(0, subtests.length - 1)),
    phase,
    playCounts: { ...persisted.playCounts },
    flagged: [...persisted.flagged],
    audio: {
      key: typeof rawAudio?.key === 'string' ? rawAudio.key : null,
      phase: audioPhase ?? 'idle',
      gapUntil: typeof rawAudio?.gapUntil === 'number' ? rawAudio.gapUntil : undefined,
    },
    speaking: speakingParsed.success ? speakingParsed.data : null,
    answers,
  };
}

// --- selectors (pure; the screens read these) ---------------------------------------------

export function currentSubtest(ctx: ExamCtx, state: ExamRunState): ExamSubtest | undefined {
  const cur = state.subtests[state.current];
  return cur ? ctx.exam.subtests.find((s) => s.id === cur.id) : undefined;
}

/** Remaining ms of the running subtest (0 when none / expired). */
export function remainingMs(state: ExamRunState, now: number): number {
  const cur = state.subtests[state.current];
  if (!cur || cur.status !== 'running' || cur.deadlineAt === undefined) return 0;
  return Math.max(0, cur.deadlineAt - now);
}

export function answeredCount(subtest: ExamSubtest, answers: Record<string, ExamAnswer>): number {
  let n = 0;
  for (const part of subtest.parts) {
    for (const item of part.items) {
      const a = answers[item.id];
      if (a && isAnswered(a)) n += 1;
    }
  }
  return n;
}

export function itemTotal(subtest: ExamSubtest): number {
  return buildLayout(subtest).items.length;
}

/** The plays a listening text gets in this subtest (official: 2). */
export function maxPlays(subtest: ExamSubtest): number {
  return subtest.audioPlays ?? 2;
}

// --- helpers --------------------------------------------------------------------------------

function patchSubtest(
  state: ExamRunState,
  index: number,
  patch: Partial<RunSubtest>,
): ExamRunState {
  return {
    ...state,
    subtests: state.subtests.map((s, i) => (i === index ? { ...s, ...patch } : s)),
  };
}

function withCursor(state: ExamRunState, index: number, subtest: ExamSubtest, flat: number) {
  const layout = buildLayout(subtest);
  const item = layout.items[flat];
  return patchSubtest(state, index, {
    flat,
    partIdx: item?.partIdx ?? 0,
    itemIdx: item?.itemIdx ?? 0,
  });
}

/** Start (or continue) the audio of the group the cursor is in; pure over state. */
function enterGroup(
  ctx: ExamCtx,
  state: ExamRunState,
  now: number,
  effects: ExamEffect[],
): ExamRunState {
  const subtest = currentSubtest(ctx, state);
  const cur = state.subtests[state.current];
  if (!subtest || !cur || subtest.kind !== 'listening') return state;
  const layout = buildLayout(subtest);
  const group = layout.groups[layout.groupOf[cur.flat] ?? 0];
  const key = group?.audioKey ?? null;
  if (key === null) return { ...state, audio: { key: null, phase: 'idle' } };
  const count = state.playCounts[key] ?? 0;
  const max = maxPlays(subtest);
  if (count === 0) {
    effects.push({ type: 'PLAY_AUDIO', subtestId: subtest.id, audioKey: key, playNo: 1 });
    return {
      ...state,
      playCounts: { ...state.playCounts, [key]: 1 },
      audio: { key, phase: 'playing' },
    };
  }
  // Re-entered (resume) a text that already started: the next play follows after the gap.
  if (count < max) return { ...state, audio: { key, phase: 'gap', gapUntil: now + AUDIO_GAP_MS } };
  return { ...state, audio: { key, phase: 'done' } };
}

// --- speaking (T73) ----------------------------------------------------------------------------

/** Seconds a speaking window really gets: the authored value, or the dev override when shorter. */
function windowSec(ctx: ExamCtx, authored: number | undefined, fallback: number): number {
  const sec = authored ?? fallback;
  return ctx.durationOverrideSec !== undefined ? Math.min(sec, ctx.durationOverrideSec) : sec;
}

/** The items of part `partIdx` of the speaking subtest, in order. */
function partItems(subtest: ExamSubtest, partIdx: number) {
  return subtest.parts[partIdx]?.items ?? [];
}

/**
 * Enter part `partIdx` at its first item (or the topic choice for a
 * monologue part). Returns the new speaking cursor + effects, or null when
 * there is no such part (the subtest is over).
 */
function enterSpeakingPart(
  ctx: ExamCtx,
  subtest: ExamSubtest,
  partIdx: number,
  now: number,
  effects: ExamEffect[],
): ExamSpeakingState | null {
  const part = subtest.parts[partIdx];
  if (!part) return null;
  const items = partItems(subtest, partIdx);
  const first = items[0];
  if (!first) return enterSpeakingPart(ctx, subtest, partIdx + 1, now, effects);
  const task = speakingTaskOf(first) ?? 1;
  const partDeadlineAt = part.timeSec
    ? now + windowSec(ctx, part.timeSec, part.timeSec) * 1000
    : undefined;
  if (task === 3) {
    return { task, phase: 'choose', itemId: null, partIdx, partDeadlineAt };
  }
  return { task, phase: 'prompt', itemId: first.id, partIdx, partDeadlineAt };
}

/** Move to the next item of the current part, or to the next part; null = the subtest is done. */
function advanceSpeaking(
  ctx: ExamCtx,
  subtest: ExamSubtest,
  sp: ExamSpeakingState,
  now: number,
  effects: ExamEffect[],
): ExamSpeakingState | null {
  const partIdx = sp.partIdx ?? 0;
  if (sp.task === 3 || sp.partExpired) {
    return enterSpeakingPart(ctx, subtest, partIdx + 1, now, effects);
  }
  const items = partItems(subtest, partIdx);
  const idx = items.findIndex((i) => i.id === sp.itemId);
  const next = items[idx + 1];
  if (!next) return enterSpeakingPart(ctx, subtest, partIdx + 1, now, effects);
  return { ...sp, phase: 'prompt', itemId: next.id, phaseDeadlineAt: undefined };
}

function withSpeaking(
  state: ExamRunState,
  subtest: ExamSubtest,
  sp: ExamSpeakingState | null,
): ExamRunState {
  if (!sp) return { ...state, speaking: null };
  const layout = buildLayout(subtest);
  const flat = sp.itemId ? (layout.indexOf.get(sp.itemId) ?? 0) : 0;
  return { ...withCursor(state, state.current, subtest, flat), speaking: sp };
}

/** Apply a cursor move: a null cursor submits the subtest (every part done). */
function speakingStep(
  ctx: ExamCtx,
  state: ExamRunState,
  subtest: ExamSubtest,
  sp: ExamSpeakingState | null,
  now: number,
  effects: ExamEffect[],
): Transition {
  if (!sp) return submit(ctx, { ...state, speaking: null }, now, false, effects);
  return {
    state: withSpeaking(state, subtest, sp),
    effects: [...effects, { type: 'PERSIST_STATE', urgent: true }],
  };
}

function startRec(sp: ExamSpeakingState): ExamEffect {
  if (sp.task === 3) {
    return { type: 'START_REC', itemId: sp.itemId ?? '', task: 3, capMs: 0, fixedWindow: true };
  }
  return {
    type: 'START_REC',
    itemId: sp.itemId ?? '',
    task: sp.task as 1 | 2,
    capMs: SPEAKING_CAP_MS[sp.task as 1 | 2],
    fixedWindow: false,
  };
}

function speakingTick(
  ctx: ExamCtx,
  state: ExamRunState,
  subtest: ExamSubtest,
  now: number,
): Transition {
  const sp = state.speaking;
  if (!sp) return NOOP(state);
  const recording = sp.phase === 'recording' || sp.phase === 'answer';
  // The part's time budget ran out.
  if (sp.partDeadlineAt !== undefined && now >= sp.partDeadlineAt && !sp.partExpired) {
    if (recording) {
      return {
        state: { ...state, speaking: { ...sp, phase: 'processing', partExpired: true } },
        effects: [{ type: 'STOP_REC' }, { type: 'PERSIST_STATE', urgent: true }],
      };
    }
    if (sp.phase === 'processing') return NOOP(state);
    const effects: ExamEffect[] = [];
    const next = enterSpeakingPart(ctx, subtest, (sp.partIdx ?? 0) + 1, now, effects);
    return speakingStep(ctx, state, subtest, next, now, effects);
  }
  // Task 3 windows.
  if (sp.task === 3 && sp.phaseDeadlineAt !== undefined && now >= sp.phaseDeadlineAt) {
    if (sp.phase === 'prep') return reduce(ctx, state, { type: 'PREP_DONE', now });
    if (sp.phase === 'answer') {
      return {
        state: { ...state, speaking: { ...sp, phase: 'processing', phaseDeadlineAt: undefined } },
        effects: [{ type: 'STOP_REC' }, { type: 'PERSIST_STATE', urgent: true }],
      };
    }
  }
  return NOOP(state);
}

function openSubtest(ctx: ExamCtx, state: ExamRunState, index: number): Transition {
  if (index >= state.subtests.length) return finishRun(state, []);
  const cur = state.subtests[index]!;
  const next: ExamRunState = {
    ...patchSubtest(state, index, { status: 'intro' }),
    current: index,
    phase: isPlaceholderKind(cur.kind) ? 'placeholder' : 'instructions',
    audio: { key: null, phase: 'idle' },
    speaking: null,
  };
  return { state: next, effects: [{ type: 'PERSIST_STATE', urgent: true }] };
}

function finishRun(state: ExamRunState, effects: ExamEffect[]): Transition {
  return {
    state: { ...state, phase: 'done', audio: { key: null, phase: 'idle' }, speaking: null },
    effects: [...effects, { type: 'FINISH' }, { type: 'PERSIST_STATE', urgent: true }],
  };
}

function submit(
  ctx: ExamCtx,
  state: ExamRunState,
  now: number,
  auto: boolean,
  lead: ExamEffect[] = [],
): Transition {
  const cur = state.subtests[state.current];
  const subtest = currentSubtest(ctx, state);
  if (!cur || !subtest) return NOOP(state);
  const effects: ExamEffect[] = [...lead, { type: 'STOP_AUDIO' }];
  // A recording in progress when the subtest closes is stopped; the hook persists it before scoring.
  const sp = state.speaking;
  if (sp && (sp.phase === 'recording' || sp.phase === 'answer')) effects.push({ type: 'STOP_REC' });
  // A subtest submitted before BEGIN (a «скоро» placeholder, or a listening subtest whose audio
  // is not downloaded and the candidate chose to skip it) is recorded SKIPPED, never scored.
  const placeholder = cur.status === 'intro';
  const timeUsedSec =
    cur.startedAt !== undefined ? Math.max(0, Math.round((now - cur.startedAt) / 1000)) : 0;
  let next = patchSubtest(state, state.current, {
    status: 'submitted',
    submittedAt: now,
    autoSubmitted: auto ? true : undefined,
    skipped: placeholder ? true : undefined,
    timeUsedSec,
  });
  next = { ...next, audio: { key: null, phase: 'idle' }, speaking: null };
  if (!placeholder) {
    effects.push({
      type: 'SCORE_SUBTEST',
      subtestId: subtest.id,
      kind: subtest.kind,
      autoSubmitted: auto,
      answered: answeredCount(subtest, state.answers),
      total: itemTotal(subtest),
      timeUsedSec,
    });
  }
  const nextIdx = state.current + 1;
  if (nextIdx >= state.subtests.length) return finishRun(next, effects);
  if (ctx.breakBetween) {
    return {
      state: { ...next, phase: 'break' },
      effects: [...effects, { type: 'PERSIST_STATE', urgent: true }],
    };
  }
  const opened = openSubtest(ctx, next, nextIdx);
  return { state: opened.state, effects: [...effects, ...opened.effects] };
}

function interruptAudio(ctx: ExamCtx, state: ExamRunState, now: number): ExamRunState {
  const subtest = currentSubtest(ctx, state);
  const key = state.audio.key;
  if (!subtest || key === null || state.audio.phase !== 'playing') return state;
  const count = state.playCounts[key] ?? 0;
  return {
    ...state,
    audio:
      count < maxPlays(subtest)
        ? { key, phase: 'gap', gapUntil: now + AUDIO_GAP_MS }
        : { key, phase: 'done' },
  };
}

// --- the reducer ------------------------------------------------------------------------------

export function reduce(ctx: ExamCtx, state: ExamRunState, event: ExamEvent): Transition {
  if (state.phase === 'done' || state.phase === 'abandoned') return NOOP(state);
  const cur = state.subtests[state.current];
  const subtest = currentSubtest(ctx, state);

  switch (event.type) {
    case 'START': {
      if (state.phase !== 'intro') return NOOP(state);
      return openSubtest(ctx, state, state.current);
    }

    case 'OPEN_SUBTEST': {
      if (state.phase !== 'intro' && state.phase !== 'break') return NOOP(state);
      if (event.index < 0 || event.index >= state.subtests.length) return NOOP(state);
      return openSubtest(ctx, state, event.index);
    }

    case 'BREAK_DONE': {
      if (state.phase !== 'break') return NOOP(state);
      return openSubtest(ctx, state, state.current + 1);
    }

    case 'BEGIN': {
      if (state.phase !== 'instructions' || !cur || !subtest) return NOOP(state);
      const effects: ExamEffect[] = [
        { type: 'SUBTEST_STARTED', subtestId: subtest.id, kind: subtest.kind },
      ];
      let next: ExamRunState = {
        ...patchSubtest(state, state.current, {
          status: 'running',
          startedAt: event.now,
          deadlineAt:
            event.now +
            (ctx.durationOverrideSec !== undefined
              ? ctx.durationOverrideSec * 1000
              : subtest.durationMin * MIN_MS),
          flat: 0,
          partIdx: 0,
          itemIdx: 0,
        }),
        phase: 'running',
      };
      next = enterGroup(ctx, next, event.now, effects);
      if (subtest.kind === 'speaking') {
        const sp = enterSpeakingPart(ctx, subtest, 0, event.now, effects);
        if (!sp) return submit(ctx, next, event.now, false, effects);
        next = withSpeaking(next, subtest, sp);
      }
      effects.push({ type: 'PERSIST_STATE', urgent: true });
      return { state: next, effects };
    }

    case 'CHOOSE_TOPIC': {
      const sp = state.speaking;
      if (state.phase !== 'running' || !subtest || !sp || sp.phase !== 'choose') return NOOP(state);
      const item = partItems(subtest, sp.partIdx ?? 0).find((i) => i.id === event.itemId);
      if (!item || item.kind !== 'speaking-monologue') return NOOP(state);
      const next: ExamSpeakingState = {
        ...sp,
        phase: 'prep',
        itemId: item.id,
        chosenId: item.id,
        phaseDeadlineAt: event.now + windowSec(ctx, item.prepSec, 480) * 1000,
      };
      return {
        state: withSpeaking(state, subtest, next),
        effects: [{ type: 'PERSIST_STATE', urgent: true }],
      };
    }

    case 'PREP_DONE': {
      const sp = state.speaking;
      if (state.phase !== 'running' || !subtest || !sp || sp.phase !== 'prep') return NOOP(state);
      const item = partItems(subtest, sp.partIdx ?? 0).find((i) => i.id === sp.itemId);
      if (!item || item.kind !== 'speaking-monologue') return NOOP(state);
      const next: ExamSpeakingState = {
        ...sp,
        phase: 'answer',
        phaseDeadlineAt: event.now + windowSec(ctx, item.answerSec, 120) * 1000,
      };
      return {
        state: withSpeaking(state, subtest, next),
        effects: [startRec(next), { type: 'PERSIST_STATE', urgent: true }],
      };
    }

    case 'SKIP_ITEM': {
      const sp = state.speaking;
      if (state.phase !== 'running' || !subtest || !sp) return NOOP(state);
      if (sp.phase === 'processing') return NOOP(state);
      const effects: ExamEffect[] = [];
      if (sp.phase === 'recording' || sp.phase === 'answer') effects.push({ type: 'STOP_REC' });
      // Skipping during the topic choice / prep skips the whole monologue.
      const skipPart = sp.task === 3;
      const next = skipPart
        ? enterSpeakingPart(ctx, subtest, (sp.partIdx ?? 0) + 1, event.now, effects)
        : advanceSpeaking(ctx, subtest, sp, event.now, effects);
      return speakingStep(ctx, state, subtest, next, event.now, effects);
    }

    case 'REC_DONE': {
      const sp = state.speaking;
      if (state.phase !== 'running' || !subtest || !sp) return NOOP(state);
      if (sp.itemId !== event.itemId) return NOOP(state);
      if (sp.phase !== 'recording' && sp.phase !== 'answer' && sp.phase !== 'processing') {
        return NOOP(state);
      }
      const effects: ExamEffect[] = [
        {
          type: 'PERSIST_RESPONSE',
          subtestId: subtest.id,
          itemId: event.itemId,
          answer: event.answer,
        },
      ];
      const withAnswer: ExamRunState = {
        ...state,
        answers: { ...state.answers, [event.itemId]: event.answer },
      };
      const next = advanceSpeaking(ctx, subtest, sp, event.now, effects);
      return speakingStep(ctx, withAnswer, subtest, next, event.now, effects);
    }

    case 'ANSWER': {
      if (state.phase !== 'running' || !cur || !subtest) return NOOP(state);
      if (cur.deadlineAt !== undefined && event.now >= cur.deadlineAt) {
        return submit(ctx, state, event.now, true);
      }
      const layout = buildLayout(subtest);
      const flat = layout.indexOf.get(event.itemId);
      if (flat === undefined) return NOOP(state);
      if (subtest.navigation === 'linear') {
        const g = layout.groups[layout.groupOf[cur.flat] ?? 0];
        if (!g || flat < g.start || flat > g.end) return NOOP(state);
      }
      return {
        state: { ...state, answers: { ...state.answers, [event.itemId]: event.answer } },
        effects: [
          {
            type: 'PERSIST_RESPONSE',
            subtestId: subtest.id,
            itemId: event.itemId,
            answer: event.answer,
          },
        ],
      };
    }

    case 'FLAG': {
      if (state.phase !== 'running' || !subtest) return NOOP(state);
      if (!buildLayout(subtest).indexOf.has(event.itemId)) return NOOP(state);
      const has = state.flagged.includes(event.itemId);
      return {
        state: {
          ...state,
          flagged: has
            ? state.flagged.filter((id) => id !== event.itemId)
            : [...state.flagged, event.itemId],
        },
        effects: [{ type: 'PERSIST_STATE', urgent: false }],
      };
    }

    case 'GOTO': {
      if (state.phase !== 'running' || !cur || !subtest) return NOOP(state);
      const layout = buildLayout(subtest);
      if (event.flat < 0 || event.flat >= layout.items.length) return NOOP(state);
      if (subtest.navigation === 'linear') {
        // Forward-only: a jump may only stay inside the current audio group (back / skip refused).
        const g = layout.groups[layout.groupOf[cur.flat] ?? 0];
        if (!g || event.flat < g.start || event.flat > g.end) return NOOP(state);
      }
      if (event.flat === cur.flat) return NOOP(state);
      return {
        state: withCursor(state, state.current, subtest, event.flat),
        effects: [{ type: 'PERSIST_STATE', urgent: false }],
      };
    }

    case 'NEXT': {
      if (state.phase !== 'running' || !cur || !subtest) return NOOP(state);
      const layout = buildLayout(subtest);
      if (subtest.navigation === 'free') {
        if (cur.flat >= layout.items.length - 1) return NOOP(state);
        return {
          state: withCursor(state, state.current, subtest, cur.flat + 1),
          effects: [{ type: 'PERSIST_STATE', urgent: false }],
        };
      }
      const gi = layout.groupOf[cur.flat] ?? 0;
      const nextGroup = layout.groups[gi + 1];
      if (!nextGroup) return NOOP(state);
      const effects: ExamEffect[] = [{ type: 'STOP_AUDIO' }];
      let next = withCursor(state, state.current, subtest, nextGroup.start);
      next = enterGroup(ctx, next, event.now, effects);
      effects.push({ type: 'PERSIST_STATE', urgent: true });
      return { state: next, effects };
    }

    case 'SUBMIT_SUBTEST': {
      if (
        state.phase === 'running' ||
        state.phase === 'placeholder' ||
        state.phase === 'instructions'
      ) {
        return submit(ctx, state, event.now, false);
      }
      return NOOP(state);
    }

    case 'AUTO_SUBMIT': {
      if (state.phase !== 'running') return NOOP(state);
      return submit(ctx, state, event.now, true);
    }

    case 'AUDIO_ENDED': {
      if (state.phase !== 'running') return NOOP(state);
      const sp = state.speaking;
      if (sp && subtest?.kind === 'speaking') {
        // The examiner's line (task 1) / the situation (task 2) finished → the mic opens.
        if (sp.phase !== 'prompt' || !sp.itemId) return NOOP(state);
        const next: ExamSpeakingState = { ...sp, phase: 'recording' };
        return {
          state: { ...state, speaking: next },
          effects: [startRec(next), { type: 'PERSIST_STATE', urgent: false }],
        };
      }
      if (state.audio.phase !== 'playing') return NOOP(state);
      return {
        state: interruptAudio(ctx, state, event.now),
        effects: [{ type: 'PERSIST_STATE', urgent: false }],
      };
    }

    case 'TICK': {
      if (state.phase !== 'running' || !cur || !subtest) return NOOP(state);
      if (cur.deadlineAt !== undefined && event.now >= cur.deadlineAt) {
        return submit(ctx, state, event.now, true);
      }
      if (subtest.kind === 'speaking') return speakingTick(ctx, state, subtest, event.now);
      if (
        subtest.kind === 'listening' &&
        state.audio.phase === 'gap' &&
        state.audio.key !== null &&
        event.now >= (state.audio.gapUntil ?? 0)
      ) {
        const key = state.audio.key;
        const playNo = (state.playCounts[key] ?? 0) + 1;
        return {
          state: {
            ...state,
            playCounts: { ...state.playCounts, [key]: playNo },
            audio: { key, phase: 'playing' },
          },
          effects: [
            { type: 'PLAY_AUDIO', subtestId: subtest.id, audioKey: key, playNo },
            // urgent: a kill right after play #2 starts must never see count 1 (a 3rd hearing)
            { type: 'PERSIST_STATE', urgent: true },
          ],
        };
      }
      return NOOP(state);
    }

    case 'RESUME': {
      if (state.phase !== 'running' || !cur || !subtest) return NOOP(state);
      if (cur.deadlineAt !== undefined && event.now >= cur.deadlineAt) {
        return submit(ctx, state, event.now, true);
      }
      if (subtest.kind === 'speaking' && state.speaking) {
        const sp = state.speaking;
        // A recording cut by a kill / background is lost (the exam does not rewind): the item is
        // skipped. `prompt` replays; `prep` / `choose` keep their wall-clock deadlines.
        if (sp.phase === 'recording' || sp.phase === 'answer' || sp.phase === 'processing') {
          const effects: ExamEffect[] = [{ type: 'STOP_REC' }];
          const moved = advanceSpeaking(ctx, subtest, sp, event.now, effects);
          return speakingStep(ctx, state, subtest, moved, event.now, effects);
        }
        return { state, effects: [{ type: 'PERSIST_STATE', urgent: true }] };
      }
      // Interrupted-play rule: a play cut by a kill / background counts as heard; a text waiting
      // out its 3 s gap gets a fresh gap (the candidate was away, not listening).
      let next = interruptAudio(ctx, state, event.now);
      if (next.audio.phase === 'gap' && next.audio.key !== null) {
        next = {
          ...next,
          audio: { key: next.audio.key, phase: 'gap', gapUntil: event.now + AUDIO_GAP_MS },
        };
      }
      return {
        state: next,
        effects: [{ type: 'STOP_AUDIO' }, { type: 'PERSIST_STATE', urgent: true }],
      };
    }

    case 'APP_BACKGROUND': {
      if (state.phase !== 'running') return NOOP(state);
      const sp = state.speaking;
      if (sp && (sp.phase === 'recording' || sp.phase === 'answer')) {
        // The mic cannot run in the background: stop now; RESUME skips the item.
        return {
          state,
          effects: [
            { type: 'STOP_AUDIO' },
            { type: 'STOP_REC' },
            { type: 'PERSIST_STATE', urgent: true },
          ],
        };
      }
      return {
        state: interruptAudio(ctx, state, event.now),
        effects: [{ type: 'STOP_AUDIO' }, { type: 'PERSIST_STATE', urgent: true }],
      };
    }

    case 'ABANDON': {
      return {
        state: {
          ...state,
          phase: 'abandoned',
          audio: { key: null, phase: 'idle' },
          speaking: null,
        },
        effects: [{ type: 'STOP_AUDIO' }, { type: 'STOP_REC' }, { type: 'ABANDON' }],
      };
    }
  }
}

/** The speaking item on screen (null outside a speaking subtest / before a topic is chosen). */
export function currentSpeakingItem(ctx: ExamCtx, state: ExamRunState) {
  const subtest = currentSubtest(ctx, state);
  const sp = state.speaking;
  if (!subtest || subtest.kind !== 'speaking' || !sp || !sp.itemId) return null;
  return partItems(subtest, sp.partIdx ?? 0).find((i) => i.id === sp.itemId) ?? null;
}

/** Remaining ms of the current speaking window (task 3 prep / answer) or the part budget; 0 when none. */
export function speakingWindowMs(state: ExamRunState, now: number): number {
  const sp = state.speaking;
  if (!sp) return 0;
  const at = sp.phaseDeadlineAt ?? sp.partDeadlineAt;
  return at === undefined ? 0 : Math.max(0, at - now);
}
