import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import {
  AUDIO_GAP_MS,
  answeredCount,
  hydrate,
  initialRunState,
  reduce,
  remainingMs,
  toPersisted,
  type ExamCtx,
  type ExamEffect,
  type ExamEvent,
  type ExamRunState,
} from '../engine/exam-machine';
import { buildLayout } from '../engine/layout';
import type { ExamAnswer } from '../model';

const PACK = examPackJson as unknown as Pack;
const EXAM: Exam = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx'));
const ALL = EXAM.subtests.map((s) => s.id);
const T0 = 1_790_000_000_000;
const MIN = 60_000;
const choice = (index: number | null): ExamAnswer => ({ kind: 'choice', index });

const ctx = (breakBetween = false): ExamCtx => ({ exam: EXAM, breakBetween });

interface Run {
  state: ExamRunState;
  effects: ExamEffect[];
  send: (e: ExamEvent) => ExamEffect[];
}
function run(ids: readonly string[] = ALL, breakBetween = false): Run {
  const r: Run = {
    state: initialRunState(EXAM, ids),
    effects: [],
    send(e) {
      const t = reduce(ctx(breakBetween), r.state, e);
      r.state = t.state;
      r.effects.push(...t.effects);
      return t.effects;
    },
  };
  return r;
}
/** Open + begin subtest `id` (assumes it is the current pending one). */
function begin(r: Run, now = T0) {
  if (r.state.phase === 'intro') r.send({ type: 'START', now });
  r.send({ type: 'BEGIN', now });
}
const types = (effects: ExamEffect[]) => effects.map((e) => e.type);

describe('layout', () => {
  it('lexgram: 5 items in 2 parts; listening: one audio group of 3 owned by ls01', () => {
    const lex = buildLayout(EXAM.subtests.find((s) => s.id === 'lexgram')!);
    expect(lex.items).toHaveLength(5);
    expect(lex.items[3]).toMatchObject({ partIdx: 1, itemIdx: 0, flat: 3 });
    const ls = buildLayout(EXAM.subtests.find((s) => s.id === 'listening')!);
    expect(ls.groups).toEqual([{ start: 0, end: 2, audioKey: 'ls01' }]);
    expect(ls.items.map((i) => i.audioKey)).toEqual(['ls01', 'ls01', 'ls01']);
  });
});

describe('start / begin / deadlines (wall clock)', () => {
  it('START opens the first subtest; objective + writing → instructions, speaking → placeholder', () => {
    const lex = run(['lexgram']);
    lex.send({ type: 'START', now: T0 });
    expect(lex.state.phase).toBe('instructions');
    expect(lex.state.subtests[0]!.status).toBe('intro');
    const writing = run(['writing']);
    writing.send({ type: 'START', now: T0 });
    expect(writing.state.phase).toBe('instructions');
    const speaking = run(['speaking']);
    speaking.send({ type: 'START', now: T0 });
    expect(speaking.state.phase).toBe('placeholder');
  });

  it('writing (T72): BEGIN → running with the 30 min deadline; a letter ANSWER persists; SUBMIT scores', () => {
    const r = run(['writing']);
    r.send({ type: 'START', now: T0 });
    r.send({ type: 'BEGIN', now: T0 });
    expect(r.state.phase).toBe('running');
    expect(r.state.subtests[0]!.deadlineAt).toBe(T0 + 30 * MIN);
    const fx = r.send({
      type: 'ANSWER',
      itemId: 'wr01',
      answer: { kind: 'writing', text: 'Привет!' },
      now: T0 + 1000,
    });
    expect(types(fx)).toEqual(['PERSIST_RESPONSE']);
    const sub = r.send({ type: 'SUBMIT_SUBTEST', now: T0 + 2000 });
    expect(sub.find((e) => e.type === 'SCORE_SUBTEST')).toMatchObject({
      kind: 'writing',
      answered: 1,
      total: 1,
    });
  });

  it('BEGIN sets deadlineAt = now + durationMin and emits SUBTEST_STARTED + a state write', () => {
    const r = run(['lexgram']);
    r.send({ type: 'START', now: T0 });
    const fx = r.send({ type: 'BEGIN', now: T0 + 5000 });
    expect(r.state.phase).toBe('running');
    expect(r.state.subtests[0]!.deadlineAt).toBe(T0 + 5000 + 40 * MIN);
    expect(types(fx)).toEqual(['SUBTEST_STARTED', 'PERSIST_STATE']);
    expect(remainingMs(r.state, T0 + 5000 + 10 * MIN)).toBe(30 * MIN);
  });

  it('TICK before the deadline does nothing; at the deadline it auto-submits with SCORE_SUBTEST', () => {
    const r = run(['lexgram']);
    begin(r);
    r.send({ type: 'ANSWER', itemId: 'lg01', answer: choice(0), now: T0 + 1000 });
    expect(r.send({ type: 'TICK', now: T0 + 39 * MIN })).toEqual([]);
    const fx = r.send({ type: 'TICK', now: T0 + 40 * MIN });
    const score = fx.find((e) => e.type === 'SCORE_SUBTEST');
    expect(score).toMatchObject({ autoSubmitted: true, answered: 1, total: 5, timeUsedSec: 2400 });
    expect(r.state.subtests[0]).toMatchObject({ status: 'submitted', autoSubmitted: true });
    expect(r.state.phase).toBe('done');
    expect(types(fx)).toContain('FINISH');
  });

  it('RESUME after the deadline passed while closed → auto-submitted answers as they were', () => {
    const r = run(['lexgram']);
    begin(r);
    r.send({ type: 'ANSWER', itemId: 'lg01', answer: choice(1), now: T0 + 1000 });
    const fx = r.send({ type: 'RESUME', now: T0 + 2 * 60 * MIN });
    expect(fx.find((e) => e.type === 'SCORE_SUBTEST')).toMatchObject({
      autoSubmitted: true,
      answered: 1,
    });
    expect(r.state.subtests[0]!.autoSubmitted).toBe(true);
  });

  it('RESUME inside the deadline keeps the true remaining time', () => {
    const r = run(['lexgram']);
    begin(r);
    r.send({ type: 'RESUME', now: T0 + 12 * MIN });
    expect(r.state.phase).toBe('running');
    expect(remainingMs(r.state, T0 + 12 * MIN)).toBe(28 * MIN);
  });

  it('an ANSWER landing after the deadline auto-submits instead of recording', () => {
    const r = run(['lexgram']);
    begin(r);
    const fx = r.send({ type: 'ANSWER', itemId: 'lg01', answer: choice(0), now: T0 + 41 * MIN });
    expect(types(fx)).not.toContain('PERSIST_RESPONSE');
    expect(r.state.subtests[0]!.status).toBe('submitted');
    expect(r.state.answers).toEqual({});
  });
});

describe('answers, flags, free navigation', () => {
  it('ANSWER stores, persists immediately, and a change overwrites; never any verdict', () => {
    const r = run(['lexgram']);
    begin(r);
    const fx = r.send({ type: 'ANSWER', itemId: 'lg02', answer: choice(2), now: T0 + 10 });
    expect(fx).toEqual([
      { type: 'PERSIST_RESPONSE', subtestId: 'lexgram', itemId: 'lg02', answer: choice(2) },
    ]);
    r.send({ type: 'ANSWER', itemId: 'lg02', answer: choice(0), now: T0 + 20 });
    expect(r.state.answers.lg02).toEqual(choice(0));
    expect(JSON.stringify(r.state)).not.toMatch(/correct|points|score/i);
  });

  it('an unknown item id is ignored', () => {
    const r = run(['lexgram']);
    begin(r);
    expect(r.send({ type: 'ANSWER', itemId: 'nope', answer: choice(0), now: T0 })).toEqual([]);
  });

  it('FLAG toggles, throttled state write', () => {
    const r = run(['lexgram']);
    begin(r);
    const fx = r.send({ type: 'FLAG', itemId: 'lg03' });
    expect(r.state.flagged).toEqual(['lg03']);
    expect(fx).toEqual([{ type: 'PERSIST_STATE', urgent: false }]);
    r.send({ type: 'FLAG', itemId: 'lg03' });
    expect(r.state.flagged).toEqual([]);
  });

  it('GOTO / NEXT move freely across parts in a free subtest', () => {
    const r = run(['lexgram']);
    begin(r);
    r.send({ type: 'GOTO', flat: 4 });
    expect(r.state.subtests[0]).toMatchObject({ flat: 4, partIdx: 1, itemIdx: 1 });
    r.send({ type: 'GOTO', flat: 0 });
    expect(r.state.subtests[0]!.flat).toBe(0);
    r.send({ type: 'NEXT', now: T0 });
    expect(r.state.subtests[0]!.flat).toBe(1);
    r.send({ type: 'GOTO', flat: 99 });
    expect(r.state.subtests[0]!.flat).toBe(1);
    r.send({ type: 'GOTO', flat: 4 });
    expect(r.send({ type: 'NEXT', now: T0 })).toEqual([]);
  });

  it('SUBMIT_SUBTEST scores with the answered count and is not auto', () => {
    const r = run(['lexgram']);
    begin(r);
    r.send({ type: 'ANSWER', itemId: 'lg01', answer: choice(0), now: T0 });
    r.send({ type: 'ANSWER', itemId: 'lg02', answer: choice(null), now: T0 });
    const fx = r.send({ type: 'SUBMIT_SUBTEST', now: T0 + 90_000 });
    expect(fx.find((e) => e.type === 'SCORE_SUBTEST')).toMatchObject({
      autoSubmitted: false,
      answered: 1,
      total: 5,
      timeUsedSec: 90,
    });
    expect(
      answeredCount(
        EXAM.subtests.find((s) => s.id === 'lexgram')!,
        r.state.answers,
      ),
    ).toBe(1);
  });

  it('events after done are no-ops', () => {
    const r = run(['lexgram']);
    begin(r);
    r.send({ type: 'SUBMIT_SUBTEST', now: T0 });
    expect(r.state.phase).toBe('done');
    expect(r.send({ type: 'TICK', now: T0 + 99 * MIN })).toEqual([]);
    expect(r.send({ type: 'ANSWER', itemId: 'lg01', answer: choice(0), now: T0 })).toEqual([]);
  });
});

describe('listening: twice only, 3 s gap, linear', () => {
  const listening = () => {
    const r = run(['listening']);
    begin(r);
    return r;
  };

  it('BEGIN plays the first group once (playNo 1) and counts it', () => {
    const r = listening();
    expect(r.effects).toContainEqual({
      type: 'PLAY_AUDIO',
      subtestId: 'listening',
      audioKey: 'ls01',
      playNo: 1,
    });
    expect(r.state.playCounts).toEqual({ ls01: 1 });
    expect(r.state.audio).toEqual({ key: 'ls01', phase: 'playing' });
  });

  it('AUDIO_ENDED → 3 s gap → TICK plays #2 → AUDIO_ENDED → locked; never a third', () => {
    const r = listening();
    const t1 = T0 + 20_000;
    r.send({ type: 'AUDIO_ENDED', now: t1 });
    expect(r.state.audio).toEqual({ key: 'ls01', phase: 'gap', gapUntil: t1 + AUDIO_GAP_MS });
    expect(r.send({ type: 'TICK', now: t1 + AUDIO_GAP_MS - 1 })).toEqual([]);
    const fx = r.send({ type: 'TICK', now: t1 + AUDIO_GAP_MS });
    expect(fx).toContainEqual({
      type: 'PLAY_AUDIO',
      subtestId: 'listening',
      audioKey: 'ls01',
      playNo: 2,
    });
    expect(r.state.playCounts.ls01).toBe(2);
    r.send({ type: 'AUDIO_ENDED', now: t1 + 30_000 });
    expect(r.state.audio.phase).toBe('done');
    expect(r.send({ type: 'TICK', now: t1 + 99_000 })).toEqual([]);
    expect(r.effects.filter((e) => e.type === 'PLAY_AUDIO')).toHaveLength(2);
  });

  it('an AUDIO_ENDED when nothing is playing is ignored', () => {
    const r = listening();
    r.send({ type: 'AUDIO_ENDED', now: T0 });
    expect(r.send({ type: 'AUDIO_ENDED', now: T0 + 1 })).toEqual([]);
  });

  it('answers inside the group are accepted during and after playback', () => {
    const r = listening();
    expect(types(r.send({ type: 'ANSWER', itemId: 'ls02', answer: choice(1), now: T0 }))).toEqual([
      'PERSIST_RESPONSE',
    ]);
  });

  it('linear lock: GOTO outside the current group is refused (back and skip)', () => {
    const r = listening();
    expect(r.send({ type: 'GOTO', flat: 99 })).toEqual([]);
    r.send({ type: 'GOTO', flat: 2 });
    expect(r.state.subtests[0]!.flat).toBe(2);
    r.send({ type: 'GOTO', flat: 0 });
    expect(r.state.subtests[0]!.flat).toBe(0);
  });

  it('NEXT on the last group does nothing (submit instead)', () => {
    const r = listening();
    expect(r.send({ type: 'NEXT', now: T0 })).toEqual([]);
  });

  it('interrupted-play rule: RESUME mid-play #1 → the next play is #2 after the gap, then locked', () => {
    const r = listening();
    const back = T0 + 5_000;
    r.send({ type: 'RESUME', now: back });
    expect(r.state.audio).toEqual({ key: 'ls01', phase: 'gap', gapUntil: back + AUDIO_GAP_MS });
    r.send({ type: 'TICK', now: back + AUDIO_GAP_MS });
    expect(r.state.playCounts.ls01).toBe(2);
    // killed again during play #2 → counts as heard, nothing more plays
    r.send({ type: 'RESUME', now: back + 20_000 });
    expect(r.state.audio.phase).toBe('done');
    expect(r.effects.filter((e) => e.type === 'PLAY_AUDIO')).toHaveLength(2);
  });

  it('APP_BACKGROUND mid-play counts the play as heard, stops audio, persists now; return → gap → play #2', () => {
    const r = listening();
    const fx = r.send({ type: 'APP_BACKGROUND', now: T0 + 4000 });
    expect(types(fx)).toEqual(['STOP_AUDIO', 'PERSIST_STATE']);
    expect(r.state.audio.phase).toBe('gap');
    expect(r.state.playCounts.ls01).toBe(1);
    r.send({ type: 'RESUME', now: T0 + 60_000 });
    expect(r.state.audio).toEqual({
      key: 'ls01',
      phase: 'gap',
      gapUntil: T0 + 60_000 + AUDIO_GAP_MS,
    });
    r.send({ type: 'TICK', now: T0 + 60_000 + AUDIO_GAP_MS });
    expect(r.state.playCounts.ls01).toBe(2);
  });

  it('hydrating a killed listening run never grants a 3rd play', () => {
    const r = listening();
    r.send({ type: 'AUDIO_ENDED', now: T0 + 10_000 });
    r.send({ type: 'TICK', now: T0 + 14_000 });
    const stored = toPersisted(r.state);
    const revived = hydrate(EXAM, stored, r.state.answers);
    expect(revived.playCounts.ls01).toBe(2);
    const t = reduce(ctx(), revived, { type: 'RESUME', now: T0 + 60_000 });
    expect(t.state.audio.phase).toBe('done');
    expect(t.effects.some((e) => e.type === 'PLAY_AUDIO')).toBe(false);
  });
});

describe('listening with several groups (linear across groups)', () => {
  // A synthetic two-text listening subtest (the fixture has one group).
  const base = EXAM.subtests.find((s) => s.id === 'listening')!;
  const part = base.parts[0]!;
  const first = part.items[0] as Extract<(typeof part.items)[number], { kind: 'choice' }>;
  const two: Exam = {
    ...EXAM,
    subtests: [
      {
        ...base,
        parts: [
          {
            ...part,
            items: [
              first,
              {
                ...first,
                id: 'ls09',
                audio: { storyId: 'ls-01' },
              },
            ],
          },
        ],
      },
    ],
  };
  it('NEXT starts the next group (play #1), a back jump is refused, counts are per key', () => {
    let state = initialRunState(two, ['listening']);
    const c: ExamCtx = { exam: two, breakBetween: false };
    const step = (e: ExamEvent) => {
      const t = reduce(c, state, e);
      state = t.state;
      return t.effects;
    };
    step({ type: 'START', now: T0 });
    step({ type: 'BEGIN', now: T0 });
    expect(state.playCounts).toEqual({ ls01: 1 });
    const fx = step({ type: 'NEXT', now: T0 + 1000 });
    expect(fx).toContainEqual({
      type: 'PLAY_AUDIO',
      subtestId: 'listening',
      audioKey: 'ls09',
      playNo: 1,
    });
    expect(state.subtests[0]!.flat).toBe(1);
    expect(state.playCounts).toEqual({ ls01: 1, ls09: 1 });
    expect(step({ type: 'GOTO', flat: 0 })).toEqual([]);
    expect(state.subtests[0]!.flat).toBe(1);
    // answers for the earlier group are refused too
    expect(step({ type: 'ANSWER', itemId: 'ls01', answer: choice(0), now: T0 + 2000 })).toEqual([]);
  });
});

describe('placeholders, breaks, finish', () => {
  it('SUBMIT on a placeholder records it skipped, with NO score effect', () => {
    const r = run(['speaking']);
    r.send({ type: 'START', now: T0 });
    const fx = r.send({ type: 'SUBMIT_SUBTEST', now: T0 + 1000 });
    expect(types(fx)).not.toContain('SCORE_SUBTEST');
    expect(types(fx)).toContain('FINISH');
    expect(r.state.subtests[0]).toMatchObject({ status: 'submitted', skipped: true });
  });

  it('SUBMIT on the instruction screen (e.g. audio not downloaded) records the subtest skipped, unscored', () => {
    const r = run(['reading', 'listening']);
    r.send({ type: 'START', now: T0 });
    expect(r.state.phase).toBe('instructions');
    const fx = r.send({ type: 'SUBMIT_SUBTEST', now: T0 });
    expect(types(fx)).not.toContain('SCORE_SUBTEST');
    expect(r.state.subtests[0]).toMatchObject({ status: 'submitted', skipped: true });
    expect(r.state.phase).toBe('instructions');
    expect(r.state.subtests[r.state.current]!.id).toBe('listening');
  });

  it('a full mock: writing → lexgram → reading → listening → speaking(skipped) → FINISH', () => {
    const r = run(ALL, false);
    r.send({ type: 'START', now: T0 });
    expect(r.state.phase).toBe('instructions');
    for (const id of ['writing', 'lexgram', 'reading', 'listening']) {
      expect(r.state.subtests[r.state.current]!.id).toBe(id);
      expect(r.state.phase).toBe('instructions');
      r.send({ type: 'BEGIN', now: T0 });
      r.send({ type: 'SUBMIT_SUBTEST', now: T0 + 1000 });
    }
    expect(r.state.phase).toBe('placeholder');
    expect(r.state.subtests[r.state.current]!.id).toBe('speaking');
    r.send({ type: 'SUBMIT_SUBTEST', now: T0 });
    expect(r.state.phase).toBe('done');
    expect(r.effects.filter((e) => e.type === 'SCORE_SUBTEST')).toHaveLength(4);
    expect(r.effects.filter((e) => e.type === 'FINISH')).toHaveLength(1);
  });

  it('breakBetween: submit → break → BREAK_DONE opens the next subtest', () => {
    const r = run(['lexgram', 'reading'], true);
    begin(r);
    r.send({ type: 'SUBMIT_SUBTEST', now: T0 });
    expect(r.state.phase).toBe('break');
    expect(r.state.current).toBe(0);
    r.send({ type: 'BREAK_DONE' });
    expect(r.state.phase).toBe('instructions');
    expect(r.state.current).toBe(1);
    expect(r.state.subtests[1]!.status).toBe('intro');
    // no break after the last subtest
    r.send({ type: 'BEGIN', now: T0 });
    r.send({ type: 'SUBMIT_SUBTEST', now: T0 });
    expect(r.state.phase).toBe('done');
  });

  it('auto-submit with breaks moves to the break, not past it', () => {
    const r = run(['lexgram', 'reading'], true);
    begin(r);
    r.send({ type: 'TICK', now: T0 + 40 * MIN });
    expect(r.state.phase).toBe('break');
  });

  it('single-subtest scope finishes after one subtest even with breaks on', () => {
    const r = run(['reading'], true);
    begin(r);
    r.send({ type: 'SUBMIT_SUBTEST', now: T0 });
    expect(r.state.phase).toBe('done');
  });

  it('ABANDON ends the run with the ABANDON effect; later events are no-ops', () => {
    const r = run(['lexgram']);
    begin(r);
    const fx = r.send({ type: 'ABANDON' });
    expect(types(fx)).toEqual(['STOP_AUDIO', 'ABANDON']);
    expect(r.state.phase).toBe('abandoned');
    expect(r.send({ type: 'TICK', now: T0 + 99 * MIN })).toEqual([]);
  });
});

describe('persistence round trip', () => {
  it('toPersisted drops the in-memory answers and hydrate restores the run exactly', () => {
    const r = run(['lexgram', 'reading']);
    begin(r);
    r.send({ type: 'ANSWER', itemId: 'lg01', answer: choice(0), now: T0 + 1 });
    r.send({ type: 'FLAG', itemId: 'lg02' });
    r.send({ type: 'GOTO', flat: 3 });
    const stored = toPersisted(r.state);
    expect(JSON.stringify(stored)).not.toContain('"answers"');
    const revived = hydrate(EXAM, JSON.parse(JSON.stringify(stored)), r.state.answers);
    expect(revived.subtests).toEqual(r.state.subtests);
    expect(revived.flagged).toEqual(['lg02']);
    expect(revived.phase).toBe('running');
    expect(revived.subtests[0]!.deadlineAt).toBe(T0 + 40 * MIN);
  });

  it('hydrate tolerates an unknown phase / dropped subtest', () => {
    const stored = toPersisted(initialRunState(EXAM, ['lexgram', 'reading']));
    const odd = {
      ...stored,
      phase: 'weird',
      subtests: [
        ...stored.subtests,
        { id: 'gone', kind: 'reading', status: 'pending', partIdx: 0, itemIdx: 0 },
      ],
    };
    const revived = hydrate(EXAM, odd as never, {});
    expect(revived.phase).toBe('instructions');
    expect(revived.subtests.map((s) => s.id)).toEqual(['lexgram', 'reading']);
  });
});
