import { describe, expect, it } from 'vitest';

import type { ScenarioRunPath } from '@/db/repositories/scenarios';

import { replayPath, resumeState } from '../engine/path';
import {
  initialState,
  reduce,
  resolveNext,
  SILENCE_NUDGE_MS,
  stepCounters,
  type Reduction,
  type TurnEffect,
  type TurnEvent,
  type TurnState,
} from '../engine/turn-machine';
import type { MetaDetection, MetaResolution } from '../meta-intents';

import { graph, judgeResult, missResult } from './engine-fixtures';

/**
 * The turn state machine (T60, SPEAKING_SCENARIOS §7.2) as a pure reducer:
 * every rule is a test. Events are driven through `run()` which collects
 * effects step by step.
 */

const ENDPOINT: TurnEvent = {
  type: 'ENDPOINT',
  reason: 'silence',
  wavPath: '/tmp/a.wav',
  durationMs: 2000,
  speechMs: 1500,
};

function run(
  state: TurnState,
  events: TurnEvent[],
): { state: TurnState; effects: TurnEffect[]; steps: Reduction[] } {
  const steps: Reduction[] = [];
  let s = state;
  for (const e of events) {
    const r = reduce(graph, s, e);
    steps.push(r);
    s = r.state;
  }
  return { state: s, effects: steps.flatMap((r) => r.effects), steps };
}
const types = (effects: TurnEffect[]) => effects.map((e) => e.type);
const plays = (effects: TurnEffect[]) =>
  effects
    .filter((e): e is Extract<TurnEffect, { type: 'PLAY' }> => e.type === 'PLAY')
    .map((e) => e.item.sentenceId);
const meta = (
  intent: MetaDetection['intent'],
  query = '',
  resolution?: MetaResolution,
): TurnEvent => ({
  type: 'META',
  detection: {
    intent,
    trigger: { intent, phrase: intent, takesQuery: query !== '' },
    score: 100,
    queryTokens: query ? query.split(' ') : [],
    query,
  },
  resolution: resolution ?? ({ intent } as MetaResolution),
});

/** Intro → t01 (3 lines) → t02 listening. */
function toT02Listening(): TurnState {
  const { state } = run(initialState(graph), [
    { type: 'BEGIN' },
    { type: 'LINE_DONE' },
    { type: 'LINE_DONE' },
    { type: 'LINE_DONE' }, // t01 done → advance to t02
    { type: 'LINE_DONE' }, // t02-a done
    { type: 'LINE_DONE' }, // t02 prompt done → listening
  ]);
  return state;
}
/** Tap, endpoint, transcript → deciding. */
function speak(state: TurnState, text: string) {
  return run(state, [{ type: 'MIC_TAP' }, ENDPOINT, { type: 'TRANSCRIPT', text }]);
}

describe('happy path', () => {
  it('BEGIN plays t01 line 1; LINE_DONE walks the lines; a monologue advances with a step', () => {
    const r = run(initialState(graph), [
      { type: 'BEGIN' },
      { type: 'LINE_DONE' },
      { type: 'LINE_DONE' },
      { type: 'LINE_DONE' },
    ]);
    expect(plays(r.effects)).toEqual([
      'radio-a1-t01-a',
      'radio-a1-t01-b',
      'radio-a1-t01',
      'radio-a1-t02-a',
    ]);
    const step = r.effects.find((e) => e.type === 'PERSIST_STEP');
    expect(step).toEqual({
      type: 'PERSIST_STEP',
      leaving: { misses: 0, assisted: false, skipped: false, rescued: false, meta: 0 },
      nextTurnId: 'radio-a1-t02',
    });
    expect(r.state.turnId).toBe('radio-a1-t02');
    expect(r.state.phase).toEqual({ kind: 'saying', lineIdx: 0 });
  });

  it('the prompt line done ⇒ listening + ARM_SILENCE', () => {
    const s = toT02Listening();
    expect(s.phase).toEqual({ kind: 'listening', recording: 'idle' });
  });

  it('MIC_TAP starts recording (disarms silence), second tap stops manually', () => {
    const s = toT02Listening();
    const a = reduce(graph, s, { type: 'MIC_TAP' });
    expect(types(a.effects)).toEqual(['DISARM_SILENCE', 'START_REC']);
    expect(a.state.phase).toEqual({ kind: 'listening', recording: 'tap' });
    const b = reduce(graph, a.state, { type: 'MIC_TAP' });
    expect(b.effects).toEqual([{ type: 'STOP_REC', reason: 'manual' }]);
  });

  it('hold-to-talk: HOLD_START records, HOLD_END stops with reason hold', () => {
    const s = toT02Listening();
    const a = reduce(graph, s, { type: 'MIC_HOLD_START' });
    expect(a.state.phase).toEqual({ kind: 'listening', recording: 'hold' });
    expect(reduce(graph, a.state, { type: 'MIC_HOLD_END' }).effects).toEqual([
      { type: 'STOP_REC', reason: 'hold' },
    ]);
    expect(reduce(graph, a.state, { type: 'MIC_TAP' }).effects).toEqual([]); // a tap during a hold is ignored
  });

  it('ENDPOINT ⇒ TRANSCRIBE + track; TRANSCRIPT ⇒ DECIDE (meta first, judge second — the executor)', () => {
    const s = toT02Listening();
    const r = speak(s, 'меня зовут митч');
    expect(types(r.effects)).toEqual([
      'DISARM_SILENCE',
      'START_REC',
      'TRACK',
      'TRANSCRIBE',
      'DECIDE',
    ]);
    expect(r.effects[2]).toEqual({
      type: 'TRACK',
      event: 'scenario_endpoint',
      props: { reason: 'silence', speechMs: 1500 },
    });
    expect(r.effects[4]).toEqual({
      type: 'DECIDE',
      transcript: 'меня зовут митч',
      turnId: 'radio-a1-t02',
      wavPath: '/tmp/a.wav',
    });
    expect(r.state.phase).toEqual({ kind: 'deciding', stage: 'deciding' });
  });

  it('JUDGED matched ⇒ persist attempt + grade + step + advance (clean turn counted)', () => {
    const s = speak(toT02Listening(), 'меня зовут митч').state;
    const r = reduce(graph, s, { type: 'JUDGED', result: judgeResult() });
    expect(types(r.effects)).toEqual([
      'TRACK',
      'DISARM_SILENCE',
      'PERSIST_ATTEMPT',
      'GRADE',
      'PERSIST_STEP',
      'TRACK',
      'PLAY',
    ]);
    const attempt = r.effects[2] as Extract<TurnEffect, { type: 'PERSIST_ATTEMPT' }>;
    expect(attempt).toMatchObject({
      kind: 'answer',
      outcome: 'matched',
      transcript: 'меня зовут митч',
      turnId: 'radio-a1-t02',
      audio: { wavPath: '/tmp/a.wav', durationMs: 2000 },
    });
    expect(attempt.detail).toMatchObject({
      kind: 'answer',
      score: 100,
      target: 'Меня зовут Митч.',
    });
    expect(r.effects[4]).toMatchObject({ type: 'PERSIST_STEP', nextTurnId: 'radio-a1-t03' });
    expect(r.state.turnId).toBe('radio-a1-t03');
    expect(r.state.totals).toEqual({ answered: 1, clean: 1 });
    expect(plays(r.effects)).toEqual(['radio-a1-t03']);
  });

  it('branching: t03 «bad» ⇒ t04b; unknown key ⇒ default; the ending turn FINISHes', () => {
    let s = speak(toT02Listening(), 'меня зовут митч').state;
    s = reduce(graph, s, { type: 'JUDGED', result: judgeResult() }).state;
    s = reduce(graph, s, { type: 'LINE_DONE' }).state; // t03 prompt → listening
    s = speak(s, 'плохо, я устал').state;
    const r = reduce(graph, s, {
      type: 'JUDGED',
      result: judgeResult({ branchKey: 'bad', slots: { mood: 'bad' } }),
    });
    expect(r.state.turnId).toBe('radio-a1-t04b');
    expect(r.effects.find((e) => e.type === 'PERSIST_STEP')).toMatchObject({
      leaving: expect.objectContaining({ branchKey: 'bad' }),
      nextTurnId: 'radio-a1-t04b',
    });
    const end = run(r.state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]);
    expect(end.state.phase).toEqual({ kind: 'ending', endingId: 'end-ok' });
    expect(end.state.endingId).toBe('end-ok');
    expect(types(end.effects)).toEqual(['PLAY', 'PERSIST_STEP', 'FINISH']);
    expect(resolveNext(graph.turns[2]!, 'mars')).toBe('radio-a1-t04d');
    expect(resolveNext(graph.turns[2]!, null)).toBe('radio-a1-t04d');
  });

  it('no-speech: ENDPOINT without a wav, or an empty transcript, re-arms listening (not a miss)', () => {
    const s = toT02Listening();
    const a = run(s, [
      { type: 'MIC_TAP' },
      { type: 'ENDPOINT', reason: 'no-speech', wavPath: null, durationMs: 0, speechMs: 0 },
    ]);
    expect(a.state.phase).toEqual({ kind: 'listening', recording: 'idle' });
    expect(a.state.counters.misses).toBe(0);
    expect(types(a.effects)).toEqual(['DISARM_SILENCE', 'START_REC', 'TRACK', 'ARM_SILENCE']);
    const b = run(s, [{ type: 'MIC_TAP' }, ENDPOINT, { type: 'TRANSCRIPT', text: '   ' }]);
    expect(b.state.phase).toEqual({ kind: 'listening', recording: 'idle' });
    expect(b.effects.some((e) => e.type === 'PERSIST_ATTEMPT')).toBe(false);
    const c = reduce(graph, speak(s, 'x').state, {
      type: 'JUDGED',
      result: judgeResult({ verdict: 'no-speech', matchedBy: null }),
    });
    expect(c.state.phase).toEqual({ kind: 'listening', recording: 'idle' });
  });
});

describe('the miss ladder', () => {
  function missOnce(
    state: TurnState,
    judge = missResult(),
    rescue: TurnEvent = { type: 'RESCUED', outcome: null },
  ) {
    const s = speak(state, 'бла бла').state;
    const j = reduce(graph, s, { type: 'JUDGED', result: judge });
    expect(j.state.phase).toEqual({ kind: 'deciding', stage: 'rescuing' });
    expect(j.effects.find((e) => e.type === 'RESCUE')).toMatchObject({
      judge,
      transcript: 'бла бла',
      turnId: state.turnId,
    });
    const r = reduce(graph, j.state, rescue);
    return { state: r.state, effects: [...j.effects, ...r.effects], reduction: r };
  }

  it('miss #1 ⇒ confused + prompt; lifeline/skip still locked; attempt persisted as miss', () => {
    const r = missOnce(toT02Listening());
    expect(plays(r.effects)).toEqual(['radio-a1-t02-confused']);
    expect(r.state.phase).toMatchObject({ kind: 'reacting', reaction: 'confused', idx: 0 });
    expect(
      (r.state.phase as { queue: { sentenceId: string }[] }).queue.map((q) => q.sentenceId),
    ).toEqual(['radio-a1-t02-confused', 'radio-a1-t02']);
    expect(r.state.counters.misses).toBe(1);
    expect(r.state.lifelineAvailable).toBe(false);
    expect(r.state.skipAvailable).toBe(false);
    expect(r.effects.find((e) => e.type === 'PERSIST_ATTEMPT')).toMatchObject({ outcome: 'miss' });
    // The queue plays through to listening.
    const after = run(r.state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]);
    expect(plays(after.effects)).toEqual(['radio-a1-t02']);
    expect(after.state.phase).toEqual({ kind: 'listening', recording: 'idle' });
  });

  it('miss #1 on a near miss ⇒ hint directly (no confused line)', () => {
    const r = missOnce(toT02Listening(), missResult({ nearMiss: true, score: 50 }));
    expect(r.state.phase).toMatchObject({ reaction: 'hint' });
    expect(plays(r.effects)).toEqual(['radio-a1-t02-hint']);
  });

  it('miss #1 on a reject hit ⇒ the authored react line', () => {
    const r = missOnce(toT02Listening(), missResult({ rejectIndex: 0 }));
    expect(r.state.phase).toMatchObject({ reaction: 'react' });
    expect(plays(r.effects)).toEqual(['radio-a1-t02-react']);
  });

  it('miss #2 ⇒ hint + prompt, lifeline available; miss #3 ⇒ second (or hint) + prompt, skip available', () => {
    let s = toT02Listening();
    s = run(missOnce(s).state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    const two = missOnce(s);
    expect(two.state.phase).toMatchObject({ reaction: 'hint' });
    expect(two.state.lifelineAvailable).toBe(true);
    expect(two.state.skipAvailable).toBe(false);
    s = run(two.state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    const three = missOnce(s);
    expect(three.state.phase).toMatchObject({ reaction: 'second' });
    expect(plays(three.effects)).toEqual(['radio-a1-t02-second']);
    expect(three.state.skipAvailable).toBe(true);
    expect(three.state.counters.misses).toBe(3);
    // A turn without `second` keeps playing the hint on #3+.
    let t3 = reduce(graph, three.state, { type: 'LINE_DONE' }).state;
    t3 = reduce(graph, t3, { type: 'LINE_DONE' }).state;
    // Jump to t03 (no second) by matching t02 now.
    const m = reduce(graph, speak(t3, 'меня зовут митч').state, {
      type: 'JUDGED',
      result: judgeResult(),
    });
    expect(m.state.totals).toEqual({ answered: 1, clean: 0 }); // misses ⇒ not clean
    let u = reduce(graph, m.state, { type: 'LINE_DONE' }).state;
    for (let i = 0; i < 3; i++)
      u = run(missOnce(u).state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    const r = missOnce(u);
    expect(r.state.counters.misses).toBe(4);
    expect(r.state.phase).toMatchObject({ reaction: 'hint' });
  });

  it('the rescue accept flips the attempt to rescued (branch key from the model), counted as answered but not clean', () => {
    const s = toT02Listening();
    const r = missOnce(s, missResult(), {
      type: 'RESCUED',
      outcome: { verdict: 'accept', branchKey: null, ms: 900, model: 'm' },
    });
    expect(r.state.turnId).toBe('radio-a1-t03');
    expect(r.effects.find((e) => e.type === 'PERSIST_ATTEMPT')).toMatchObject({
      outcome: 'rescued',
    });
    expect(r.effects.find((e) => e.type === 'PERSIST_STEP')).toMatchObject({
      leaving: expect.objectContaining({ rescued: true, misses: 0 }),
    });
    expect(r.state.totals).toEqual({ answered: 1, clean: 1 }); // a rescue on a first try is clean
    expect(r.effects.some((e) => e.type === 'GRADE')).toBe(true);
  });

  it('a rescue reject or error falls through to the miss ladder', () => {
    const a = missOnce(toT02Listening(), missResult(), {
      type: 'RESCUED',
      outcome: { verdict: 'reject', ms: 700, model: 'm' },
    });
    expect(a.state.counters.misses).toBe(1);
    const b = missOnce(toT02Listening(), missResult(), {
      type: 'RESCUED',
      outcome: { verdict: 'error', ms: 4000, model: null, code: 'timeout' },
    });
    expect(b.state.counters.misses).toBe(1);
    expect(b.state.lastRescue).toMatchObject({ verdict: 'error' });
  });

  it('LIFELINE_TAP only after unlock, once; marks the turn assisted (not clean)', () => {
    let s = toT02Listening();
    expect(reduce(graph, s, { type: 'LIFELINE_TAP' }).effects).toEqual([]);
    s = run(missOnce(s).state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    s = run(missOnce(s).state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    const r = reduce(graph, s, { type: 'LIFELINE_TAP' });
    expect(r.state.lifelineRevealed).toBe(true);
    expect(r.state.counters.assisted).toBe(true);
    expect(r.effects).toEqual([
      { type: 'TRACK', event: 'scenario_lifeline_revealed', props: { turnId: 'radio-a1-t02' } },
      // T62: the reveal syncs `assisted` onto the open step (resume fidelity).
      {
        type: 'PERSIST_STEP',
        leaving: { misses: 2, assisted: true, skipped: false, rescued: false, meta: 0 },
      },
    ]);
    expect(reduce(graph, r.state, { type: 'LIFELINE_TAP' }).effects).toEqual([]);
    const m = reduce(graph, speak(r.state, 'меня зовут митч').state, {
      type: 'JUDGED',
      result: judgeResult(),
    });
    expect(m.state.totals).toEqual({ answered: 1, clean: 0 });
    expect(m.effects.find((e) => e.type === 'PERSIST_STEP')).toMatchObject({
      leaving: expect.objectContaining({ assisted: true, misses: 2 }),
    });
  });

  it('SKIP_TAP only after miss #3: persists a skipped attempt, takes next.default, grades nothing', () => {
    let s = toT02Listening();
    expect(reduce(graph, s, { type: 'SKIP_TAP' }).effects).toEqual([]);
    for (let i = 0; i < 3; i++)
      s = run(missOnce(s).state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    const r = reduce(graph, s, { type: 'SKIP_TAP' });
    expect(types(r.effects)).toEqual([
      'STOP_AUDIO',
      'DISARM_SILENCE',
      'PERSIST_ATTEMPT',
      'TRACK',
      'PERSIST_STEP',
      'TRACK',
      'PLAY',
    ]);
    expect(r.effects[2]).toMatchObject({ outcome: 'skipped', transcript: '' });
    expect(r.effects.some((e) => e.type === 'GRADE')).toBe(false);
    expect(r.effects.find((e) => e.type === 'PERSIST_STEP')).toMatchObject({
      leaving: expect.objectContaining({ skipped: true, misses: 3 }),
      nextTurnId: 'radio-a1-t03',
    });
    expect(r.state.turnId).toBe('radio-a1-t03');
    expect(r.state.totals).toEqual({ answered: 1, clean: 0 });
    expect(r.state.skipAvailable).toBe(false); // fresh turn
  });

  it('skip while a reaction is playing stops the audio first', () => {
    let s = toT02Listening();
    for (let i = 0; i < 2; i++)
      s = run(missOnce(s).state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    const third = missOnce(s).state; // reacting
    const r = reduce(graph, third, { type: 'SKIP_TAP' });
    expect(r.effects[0]).toEqual({ type: 'STOP_AUDIO' });
    expect(r.state.turnId).toBe('radio-a1-t03');
  });
});

describe('meta-intents in the machine (none count as a miss)', () => {
  it('repeat replays the prompt at 1.0; slower at 0.8 with mouth ×1.25', () => {
    const s = speak(toT02Listening(), 'повтори').state;
    const r = reduce(graph, s, meta('repeat'));
    expect(r.effects.find((e) => e.type === 'PLAY')).toEqual({
      type: 'PLAY',
      item: { sentenceId: 'radio-a1-t02', rate: 1, mouthScale: 1 },
    });
    expect(r.state.counters).toMatchObject({ misses: 0, meta: 1, helpUses: 1 });
    expect(r.effects.find((e) => e.type === 'PERSIST_ATTEMPT')).toMatchObject({
      kind: 'meta',
      outcome: 'repeat',
      detail: { kind: 'meta', query: '', hit: null, source: 'none' },
    });
    const sl = reduce(graph, speak(toT02Listening(), 'помедленнее').state, meta('slower'));
    expect(sl.effects.find((e) => e.type === 'PLAY')).toEqual({
      type: 'PLAY',
      item: { sentenceId: 'radio-a1-t02', rate: 0.8, mouthScale: 1.25 },
    });
    expect(sl.effects).toContainEqual({
      type: 'TRACK',
      event: 'scenario_line_replayed',
      props: { slower: true },
    });
  });

  it('dont-understand plays the hint (no miss); the 2nd time unlocks the lifeline', () => {
    const one = reduce(
      graph,
      speak(toT02Listening(), 'я не понимаю').state,
      meta('dont-understand'),
    );
    expect(plays(one.effects)).toEqual(['radio-a1-t02-hint']);
    expect(one.state.lifelineAvailable).toBe(false);
    expect(one.state.counters.misses).toBe(0);
    const back = run(one.state, [{ type: 'LINE_DONE' }]).state;
    const two = reduce(graph, speak(back, 'не понимаю').state, meta('dont-understand'));
    expect(two.state.lifelineAvailable).toBe(true);
    expect(two.state.counters.dontUnderstand).toBe(2);
  });

  it('explain: glossary clip / суфлёр gloss / which-word nudge + lifeline', () => {
    const s = speak(toT02Listening(), 'что значит связь').state;
    const g = reduce(
      graph,
      s,
      meta('explain', 'связь', {
        intent: 'explain',
        source: 'glossary',
        entryId: 'radio-a1-gl-connection',
        sentenceId: 'radio-a1-gl-connection-explain',
        ru: 'связь',
        en: 'connection',
      }),
    );
    expect(plays(g.effects)).toEqual(['radio-a1-gl-connection-explain']);
    expect(g.effects.find((e) => e.type === 'PERSIST_ATTEMPT')).toMatchObject({
      detail: { kind: 'meta', query: 'связь', hit: 'radio-a1-gl-connection', source: 'glossary' },
    });
    expect(g.effects).toContainEqual({
      type: 'TRACK',
      event: 'scenario_meta',
      props: { intent: 'explain', source: 'glossary', hit: true },
    });
    const p = reduce(
      graph,
      s,
      meta('explain', 'отлично', {
        intent: 'explain',
        source: 'played',
        ru: 'отлично',
        en: 'great',
      }),
    );
    expect(p.effects).toContainEqual({ type: 'SPEAK_GLOSS', ru: 'отлично', en: 'great' });
    expect(p.state.phase).toEqual({ kind: 'listening', recording: 'idle' }); // nothing pre-rendered to wait for
    const n = reduce(graph, s, meta('explain', 'эфир', { intent: 'explain', source: 'none' }));
    expect(plays(n.effects)).toEqual(['radio-a1-nudge-which-word']);
    expect(n.state.lifelineAvailable).toBe(true);
    expect(n.state.counters.misses).toBe(0);
  });

  it('howtosay: clip (glossary/whisper) / суфлёр RU / dont-know nudge + lifeline', () => {
    const s = speak(toT02Listening(), 'как сказать конекшн').state;
    const w = reduce(
      graph,
      s,
      meta('howtosay', 'конекшн', {
        intent: 'howtosay',
        source: 'whisper',
        entryId: 'radio-a1-gl-connection',
        sentenceId: 'radio-a1-gl-connection-howtosay',
        ru: 'связь',
        en: 'connection',
      }),
    );
    expect(plays(w.effects)).toEqual(['radio-a1-gl-connection-howtosay']);
    expect(w.effects.find((e) => e.type === 'PERSIST_ATTEMPT')).toMatchObject({
      detail: { source: 'whisper', hit: 'radio-a1-gl-connection' },
    });
    const o = reduce(
      graph,
      s,
      meta('howtosay', 'зеркало', { intent: 'howtosay', source: 'online', ru: 'зеркало' }),
    );
    expect(o.effects).toContainEqual({ type: 'SPEAK_RU', text: 'зеркало' });
    const n = reduce(graph, s, meta('howtosay', 'зеркало', { intent: 'howtosay', source: 'none' }));
    expect(plays(n.effects)).toEqual(['radio-a1-nudge-dont-know']);
    expect(n.state.lifelineAvailable).toBe(true);
  });
});

describe('silence, replay, background', () => {
  it('SILENCE_25S nudges once per turn, then waits', () => {
    expect(SILENCE_NUDGE_MS).toBe(25_000);
    const s = toT02Listening();
    const a = reduce(graph, s, { type: 'SILENCE_25S' });
    expect(plays(a.effects)).toEqual(['radio-a1-nudge-silence']);
    expect(a.state.silenceNudged).toBe(true);
    const back = reduce(graph, a.state, { type: 'LINE_DONE' }).state;
    expect(back.phase).toEqual({ kind: 'listening', recording: 'idle' });
    expect(reduce(graph, back, { type: 'SILENCE_25S' }).effects).toEqual([]);
    // Not while recording.
    expect(
      reduce(graph, reduce(graph, s, { type: 'MIC_TAP' }).state, { type: 'SILENCE_25S' }).effects,
    ).toEqual([]);
  });

  it('REPLAY_TAP replays the prompt at 1.0 while idle-listening', () => {
    const r = reduce(graph, toT02Listening(), { type: 'REPLAY_TAP' });
    expect(plays(r.effects)).toEqual(['radio-a1-t02']);
    expect(r.state.counters.meta).toBe(0); // a button, not a spoken command
  });

  it('APP_BACKGROUND while recording cancels the attempt; FOREGROUND lands in listening without replay', () => {
    const rec = reduce(graph, toT02Listening(), { type: 'MIC_TAP' }).state;
    const bg = reduce(graph, rec, { type: 'APP_BACKGROUND' });
    expect(types(bg.effects)).toEqual(['STOP_AUDIO', 'DISARM_SILENCE', 'CANCEL_REC']);
    expect(bg.state.phase.kind).toBe('paused');
    // Events are ignored while paused.
    expect(reduce(graph, bg.state, ENDPOINT).effects).toEqual([]);
    const fg = reduce(graph, bg.state, { type: 'APP_FOREGROUND' });
    expect(fg.state.phase).toEqual({ kind: 'listening', recording: 'idle' });
    expect(types(fg.effects)).toEqual(['ARM_SILENCE']);
    expect(fg.state.counters.misses).toBe(0);
  });

  it('APP_BACKGROUND mid-line replays that line on FOREGROUND; mid-reaction lands in listening', () => {
    const saying = run(initialState(graph), [{ type: 'BEGIN' }, { type: 'LINE_DONE' }]).state; // t01 line 2
    const fg = reduce(graph, reduce(graph, saying, { type: 'APP_BACKGROUND' }).state, {
      type: 'APP_FOREGROUND',
    });
    expect(plays(fg.effects)).toEqual(['radio-a1-t01-b']);
    const reacting = reduce(graph, toT02Listening(), { type: 'REPLAY_TAP' }).state;
    const fg2 = reduce(graph, reduce(graph, reacting, { type: 'APP_BACKGROUND' }).state, {
      type: 'APP_FOREGROUND',
    });
    expect(fg2.state.phase).toEqual({ kind: 'listening', recording: 'idle' });
  });

  it('background at intro or ending is a no-op', () => {
    const intro = initialState(graph);
    expect(reduce(graph, intro, { type: 'APP_BACKGROUND' }).state.phase.kind).toBe('paused');
    expect(
      reduce(graph, reduce(graph, intro, { type: 'APP_BACKGROUND' }).state, {
        type: 'APP_FOREGROUND',
      }).state.phase,
    ).toEqual({ kind: 'intro' });
  });

  it('stepCounters maps counters to the step shape', () => {
    expect(
      stepCounters(
        {
          misses: 2,
          assisted: true,
          skipped: false,
          rescued: false,
          meta: 1,
          helpUses: 1,
          dontUnderstand: 0,
        },
        'bad',
      ),
    ).toEqual({
      misses: 2,
      assisted: true,
      skipped: false,
      rescued: false,
      meta: 1,
      branchKey: 'bad',
    });
  });
});

describe('path replay + resume (§7.3, T27 resume-in-place)', () => {
  const step = (turnId: string, over: Partial<ScenarioRunPath['steps'][number]> = {}) => ({
    turnId,
    misses: 0,
    assisted: false,
    skipped: false,
    rescued: false,
    meta: 0,
    ...over,
  });
  const path = (steps: ScenarioRunPath['steps']): ScenarioRunPath => ({ v: 1, steps });

  it('a fresh run replays to its start turn', () => {
    const r = replayPath(graph, path([step('radio-a1-t01')]));
    expect(r).toMatchObject({ status: 'active', visited: ['radio-a1-t01'], endingId: null });
    expect(r.current?.turnId).toBe('radio-a1-t01');
  });

  it('a mid-run path across a branch resumes at the current turn with its counters', () => {
    const p = path([
      step('radio-a1-t01'),
      step('radio-a1-t02', { misses: 1 }),
      step('radio-a1-t03', { branchKey: 'bad' }),
      step('radio-a1-t04b'),
    ]);
    const r = replayPath(graph, p);
    expect(r.status).toBe('active');
    expect(r.visited).toEqual(['radio-a1-t01', 'radio-a1-t02', 'radio-a1-t03', 'radio-a1-t04b']);
    expect(r.endingId).toBe('end-ok'); // sits on an ending turn; the finish write is the caller's
    const mid = replayPath(
      graph,
      path([step('radio-a1-t01'), step('radio-a1-t02', { misses: 2, assisted: true, meta: 1 })]),
    );
    const s = resumeState(graph, mid)!;
    expect(s.turnId).toBe('radio-a1-t02');
    expect(s.counters).toMatchObject({ misses: 2, assisted: true, meta: 1 });
    expect(s.lifelineAvailable).toBe(true);
    expect(s.lifelineRevealed).toBe(true);
    expect(s.skipAvailable).toBe(false);
    expect(s.totals.answered).toBe(1);
    expect(s.phase).toEqual({ kind: 'intro' });
  });

  it('a skipped step left along the default', () => {
    const p = path([
      step('radio-a1-t01'),
      step('radio-a1-t02', { skipped: true, misses: 3 }),
      step('radio-a1-t03'),
    ]);
    expect(replayPath(graph, p).status).toBe('active');
  });

  it('stale: unknown turn, wrong start, a branch that does not lead where the path went, finished without an ending', () => {
    expect(replayPath(graph, path([step('radio-a1-t01'), step('nope')])).status).toBe('stale');
    expect(replayPath(graph, path([step('radio-a1-t02')])).status).toBe('stale');
    expect(replayPath(graph, path([step('radio-a1-t01'), step('radio-a1-t03')])).status).toBe(
      'stale',
    );
    expect(
      replayPath(
        graph,
        path([
          step('radio-a1-t01'),
          step('radio-a1-t02'),
          step('radio-a1-t03', { branchKey: 'good' }),
          step('radio-a1-t04b'),
        ]),
      ).status,
    ).toBe('stale');
    expect(replayPath(graph, path([])).status).toBe('stale');
    expect(replayPath(graph, path([step('radio-a1-t01')]), { finished: true }).status).toBe(
      'stale',
    );
    expect(
      replayPath(
        graph,
        path([
          step('radio-a1-t01'),
          step('radio-a1-t02'),
          step('radio-a1-t03', { branchKey: 'good' }),
          step('radio-a1-t04g'),
        ]),
        { finished: true },
      ).status,
    ).toBe('finished');
    expect(resumeState(graph, replayPath(graph, path([])))).toBeNull();
  });
});

describe('RESUME (T62: continue from the intro card)', () => {
  const step = (turnId: string, over: Partial<ScenarioRunPath['steps'][number]> = {}) => ({
    turnId,
    misses: 0,
    assisted: false,
    skipped: false,
    rescued: false,
    meta: 0,
    ...over,
  });

  it('an expecting turn keeps its counters, replays the prompt, then listens', () => {
    const replay = replayPath(graph, {
      v: 1,
      steps: [step('radio-a1-t01'), step('radio-a1-t02', { misses: 2, assisted: true })],
    });
    const restored = resumeState(graph, replay)!;
    const a = reduce(graph, restored, { type: 'RESUME' });
    expect(a.state.phase).toEqual({
      kind: 'reacting',
      reaction: 'repeat',
      queue: [{ sentenceId: 'radio-a1-t02', rate: 1, mouthScale: 1 }],
      idx: 0,
    });
    expect(plays(a.effects)).toEqual(['radio-a1-t02']);
    expect(a.state.counters).toMatchObject({ misses: 2, assisted: true });
    expect(a.state.lifelineAvailable).toBe(true);
    expect(a.state.lifelineRevealed).toBe(true);
    const b = reduce(graph, a.state, { type: 'LINE_DONE' });
    expect(b.state.phase).toEqual({ kind: 'listening', recording: 'idle' });
    expect(b.state.counters.misses).toBe(2); // BEGIN would have wiped these
    expect(types(b.effects)).toEqual(['ARM_SILENCE']);
  });

  it('a monologue turn plays from its first line', () => {
    const restored = resumeState(
      graph,
      replayPath(graph, { v: 1, steps: [step('radio-a1-t01')] }),
    )!;
    const a = reduce(graph, restored, { type: 'RESUME' });
    expect(a.state.phase).toEqual({ kind: 'saying', lineIdx: 0 });
    expect(plays(a.effects)).toEqual(['radio-a1-t01-a']);
  });

  it('is ignored outside the intro', () => {
    const s = toT02Listening();
    expect(reduce(graph, s, { type: 'RESUME' })).toEqual({ state: s, effects: [] });
  });
});

describe('REPLAY_TAP slower (T62: long-press ⟳)', () => {
  it('replays the prompt at 0.8× with the mouth scaled 1.25', () => {
    const s = toT02Listening();
    const r = reduce(graph, s, { type: 'REPLAY_TAP', slower: true });
    expect(r.state.phase).toMatchObject({ kind: 'reacting', reaction: 'slower' });
    expect(r.effects).toContainEqual({
      type: 'PLAY',
      item: { sentenceId: 'radio-a1-t02', rate: 0.8, mouthScale: 1.25 },
    });
    expect(r.effects).toContainEqual({
      type: 'TRACK',
      event: 'scenario_line_replayed',
      props: { slower: true },
    });
    // The plain tap is unchanged.
    const plain = reduce(graph, s, { type: 'REPLAY_TAP' });
    expect(plain.state.phase).toMatchObject({ kind: 'reacting', reaction: 'repeat' });
    expect(plays(plain.effects)).toEqual(['radio-a1-t02']);
  });
});

describe('mid-turn counters persist on the open step (T62 §7.3 resume fidelity)', () => {
  it('a miss syncs misses onto the open step; the lifeline reveal syncs assisted; a meta ask syncs meta', () => {
    const missOnce = (state: TurnState) => {
      const j = reduce(graph, speak(state, 'бла бла').state, {
        type: 'JUDGED',
        result: missResult(),
      });
      const r = reduce(graph, j.state, { type: 'RESCUED', outcome: null });
      return { state: r.state, effects: [...j.effects, ...r.effects] };
    };
    const s = toT02Listening();
    const m1 = missOnce(s);
    expect(m1.effects).toContainEqual({
      type: 'PERSIST_STEP',
      leaving: { misses: 1, assisted: false, skipped: false, rescued: false, meta: 0 },
    });
    // A step sync never carries nextTurnId (the turn is still open).
    for (const e of m1.effects) if (e.type === 'PERSIST_STEP') expect(e.nextTurnId).toBeUndefined();
    const l1 = run(m1.state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    const l2 = run(missOnce(l1).state, [{ type: 'LINE_DONE' }, { type: 'LINE_DONE' }]).state;
    const lifeline = reduce(graph, l2, { type: 'LIFELINE_TAP' });
    expect(lifeline.effects).toContainEqual({
      type: 'PERSIST_STEP',
      leaving: { misses: 2, assisted: true, skipped: false, rescued: false, meta: 0 },
    });
    const asked = run(lifeline.state, [
      { type: 'MIC_TAP' },
      ENDPOINT,
      { type: 'TRANSCRIPT', text: 'повтори' },
      meta('repeat'),
    ]);
    expect(asked.effects).toContainEqual({
      type: 'PERSIST_STEP',
      leaving: { misses: 2, assisted: true, skipped: false, rescued: false, meta: 1 },
    });
  });
});
