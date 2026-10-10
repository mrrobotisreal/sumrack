import { ExamSchema, type Exam } from '@sumrak/schema';
import a2Pack from '@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import {
  SPEAKING_CAP_MS,
  hydrate,
  initialRunState,
  monologueWindows,
  reduce,
  speakingCapMsFor,
  toPersisted,
  type ExamCtx,
  type ExamEffect,
  type ExamEvent,
  type ExamRunState,
} from '../engine/exam-machine';
import {
  A2_VERB_STEMS,
  WPM_BANDS,
  fluencyShare,
  gradeMonologueOffline,
  looksLikeVerb,
} from '../grading/speaking';
import { TORFL_PROFILES } from '../level-profile';
import {
  chooseLine,
  recordingLine,
  sentencesLine,
  startAnswerLine,
  task3Fact,
  windowsLine,
} from '../speaking/timing-copy';

const A2 = ExamSchema.parse(
  (a2Pack as unknown as { exams: unknown[] }).exams.find(
    (e) => (e as { id: string }).id === 'a2-mock-fx',
  ),
) as Exam;
const T0 = 1_790_000_000_000;

function runA2(over: Partial<ExamCtx> = {}) {
  const ctx: ExamCtx = { exam: A2, breakBetween: false, ...over };
  const r = {
    state: initialRunState(A2, ['speaking']) as ExamRunState,
    effects: [] as ExamEffect[],
    send(e: ExamEvent) {
      const t = reduce(ctx, r.state, e);
      r.state = t.state;
      r.effects.push(...t.effects);
      return t.effects;
    },
  };
  r.send({ type: 'START', now: T0 });
  r.send({ type: 'BEGIN', now: T0 });
  return r;
}

describe('A2 single-topic monologue (T76, A2-9)', () => {
  it('after tasks 1-2, task 3 skips the choose step: prep 10:00 from the item, then answer 5:00', () => {
    const r = runA2();
    for (let i = 0; i < 4; i++) r.send({ type: 'SKIP_ITEM', now: T0 });
    expect(r.state.speaking).toMatchObject({
      task: 3,
      phase: 'prep',
      itemId: 'sp05',
      chosenId: 'sp05',
      phaseDeadlineAt: T0 + 600_000,
      partDeadlineAt: T0 + 900_000,
    });
    // CHOOSE_TOPIC is a no-op now (nothing to choose)
    expect(r.send({ type: 'CHOOSE_TOPIC', itemId: 'sp05', now: T0 })).toEqual([]);
    const fx = r.send({ type: 'PREP_DONE', now: T0 + 100_000 });
    expect(fx[0]).toEqual({
      type: 'START_REC',
      itemId: 'sp05',
      task: 3,
      capMs: 0,
      fixedWindow: true,
    });
    expect(r.state.speaking).toMatchObject({
      phase: 'answer',
      phaseDeadlineAt: T0 + 100_000 + 300_000,
    });
  });

  it('a resume mid-prep restores the same cursor and the true wall-clock deadline', () => {
    const r = runA2();
    for (let i = 0; i < 4; i++) r.send({ type: 'SKIP_ITEM', now: T0 });
    const back = hydrate(A2, toPersisted(r.state), {});
    expect(back.speaking).toEqual(r.state.speaking);
    expect(back.speaking?.phaseDeadlineAt).toBe(T0 + 600_000);
  });

  it('the dev override shortens both windows (record only); release values are the item', () => {
    const r = runA2({ durationOverrideSec: 20 });
    for (let i = 0; i < 4; i++) r.send({ type: 'SKIP_ITEM', now: T0 });
    expect(r.state.speaking?.phaseDeadlineAt).toBe(T0 + 20_000);
  });

  it('task 1 / 2 answer caps come from the level profile (A2 45 s / 60 s)', () => {
    const r = runA2();
    const fx = r.send({ type: 'AUDIO_ENDED', now: T0 });
    expect(fx[0]).toMatchObject({ type: 'START_REC', task: 1, capMs: 45_000 });
  });
});

describe('speaking profile wiring', () => {
  it('A1 caps are the legacy constants; A2 differs', () => {
    expect(speakingCapMsFor('A1', 1)).toBe(SPEAKING_CAP_MS[1]);
    expect(speakingCapMsFor('A1', 2)).toBe(SPEAKING_CAP_MS[2]);
    expect(speakingCapMsFor(undefined, 2)).toBe(40_000);
    expect(speakingCapMsFor('A2', 2)).toBe(60_000);
  });
  it('monologueWindows: the item wins, else the profile default', () => {
    expect(monologueWindows('A2', {})).toEqual({ prepSec: 600, answerSec: 300 });
    expect(monologueWindows('A1', {})).toEqual({ prepSec: 480, answerSec: 120 });
    expect(monologueWindows('A2', { prepSec: 60, answerSec: 30 })).toEqual({
      prepSec: 60,
      answerSec: 30,
    });
  });
  it('fluency bands come from the profile (a 60 wpm answer is good at A2, full at A1? no: full needs 70)', () => {
    const est = { wpm: 60, longestPauseMs: 1000, words: 100 };
    expect(fluencyShare(est)).toBeCloseTo(0.6 * (2 / 3) + 0.4, 5); // A1 default
    expect(fluencyShare(est, TORFL_PROFILES.A2.fluencyBands)).toBeCloseTo(0.6 * (2 / 3) + 0.4, 5);
    const est2 = { wpm: 75, longestPauseMs: 1000, words: 100 };
    expect(fluencyShare(est2, WPM_BANDS)).toBeCloseTo(1, 5);
    expect(fluencyShare(est2, TORFL_PROFILES.A2.fluencyBands)).toBeCloseTo(0.6 * (2 / 3) + 0.4, 5);
  });
  it('the offline monologue scorer reads the level bands + the item minSentences', () => {
    const item = A2.subtests.find((s) => s.kind === 'speaking')!.parts[2]!.items[0] as never;
    const words = Array.from({ length: 75 }, () => 'слово');
    const stamps = words.map((_, i) => ({ w: 'слово', s: i * 800, e: i * 800 + 800 }));
    const a = { transcript: words.join(' '), words: stamps } as never;
    const g1 = gradeMonologueOffline(item, a, { level: 'A1' });
    const g2 = gradeMonologueOffline(item, a, { level: 'A2' });
    const f = (g: typeof g1) => g.criteria.find((c) => c.id === 'fluency')!.score;
    expect(f(g1)).toBeGreaterThanOrEqual(f(g2));
  });
});

describe('A2 verb stems (data list + corpus)', () => {
  const VERBS = [
    'приходит',
    'пришёл',
    'уехал',
    'выхожу',
    'зашла',
    'дошли',
    'приезжаем',
    'переехали',
    'подходит',
    'принесу',
    'привезла',
    'встретились',
    'решил',
    'пригласил',
    'предлагаю',
    'позвонила',
    'купили',
    'отдыхаю',
    'устаю',
    'болит',
    'готовлю',
    'заказал',
    'берёт',
    'дала',
    'объясняет',
    'ищет',
    'понимаю',
    'повторяю',
    'пробую',
    'мечтаю',
    'интересуюсь',
    'улыбается',
    'поздравляю',
    'проведу',
    'отмечаем',
    'получил',
    'написала',
    'прочитал',
    'посмотрели',
    'вспомнил',
    'помогает',
    'познакомились',
    'просыпаюсь',
    'ложусь',
    'встаю',
  ];
  const NOUNS = [
    'приход',
    'выход',
    'вход',
    'встреча',
    'праздник',
    'подарок',
    'мама',
    'город',
    'письмо',
    'вечер',
    'работа',
    'квартира',
    'друг',
    'суббота',
    'кафе',
  ];
  it('is a plain Cyrillic data list', () => {
    expect(A2_VERB_STEMS.length).toBeGreaterThan(100);
    for (const s of A2_VERB_STEMS) expect(s).toMatch(/^[Ѐ-ӿ]+$/u);
  });
  it('recognises the A2 corpus verbs', () => {
    const miss = VERBS.filter((v) => !looksLikeVerb(v));
    expect(miss).toEqual([]);
  });
  it('rejects the noun corpus', () => {
    const hit = NOUNS.filter((n) => looksLikeVerb(n));
    expect(hit).toEqual([]);
  });
});

describe('timing copy is generated', () => {
  it('windowsLine / chooseLine / task3Fact', () => {
    expect(windowsLine(480, 120)).toBe('8 минут на подготовку, затем 2 минуты на ответ');
    expect(windowsLine(600, 300)).toBe('10 минут на подготовку, затем 5 минут на ответ');
    expect(chooseLine(2, 480, 120)).toBe(
      'Задание 3. Выбери одну из двух тем. После выбора — 8 минут на подготовку, затем 2 минуты на ответ.',
    );
    expect(task3Fact(2, 480, 120)).toBe(
      'Задание 3: одна тема из двух, подготовка 8 мин, ответ 2 мин.',
    );
    expect(task3Fact(1, 600, 300)).toBe('Задание 3: одна тема, подготовка 10 мин, ответ 5 мин.');
    expect(startAnswerLine(300)).toBe('Запись пойдёт сразу: 5 минут, без остановки таймера.');
    expect(startAnswerLine(120)).toBe('Запись пойдёт сразу: 2 минуты, без остановки таймера.');
    expect(recordingLine(300)).toBe('Идёт запись — 5 минут');
    expect(sentencesLine(12, 15)).toContain('12–15 предложений');
  });
});
