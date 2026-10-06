import {
  ExamSchema,
  type Exam,
  type Pack,
  type SpeakingMonologueItem,
  type SpeakingTurnItem,
} from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import {
  MONOLOGUE_OFFLINE_MAX,
  PAUSE_CLAUSE_MS,
  TASK_WEIGHT,
  TURN_OFFLINE_MAX,
  countVerbs,
  estimateSentences,
  fluencyShare,
  fullAnswerThreshold,
  gradeMonologueOffline,
  gradeSpeakingOffline,
  gradeTurnOffline,
  looksLikeVerb,
  offlineSpeakingPoints,
  responseShare,
  scoreSpeakingSubtest,
  speakingTaskOf,
  taskSlots,
} from '../grading/speaking';
import type { SpeakingAnswer, SpeakingWordStamp } from '../model';

/**
 * T73 (TORFL §6.2): the offline speaking grader over the fixture mock's
 * speaking subtest — the judge mapping (M17 `judgeAnswer`, unchanged), the
 * full-answer bonus, the Whisper-vs-Zipformer pick, the monologue's cue
 * coverage + pause-based sentence estimate capped by verbs + fluency
 * bands, and the 25 / 25 / 50 subtest weights.
 */

const PACK = examPackJson as unknown as Pack;
const EXAM: Exam = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx'));
const SPEAKING = EXAM.subtests.find((s) => s.kind === 'speaking')!;
const items = SPEAKING.parts.flatMap((p) => p.items);
const REPLY = items.find((i) => i.kind === 'speaking-reply') as SpeakingTurnItem;
const SITUATION = items.find((i) => i.kind === 'speaking-situation') as SpeakingTurnItem;
const MONO = items.find((i) => i.id === 'sp03') as SpeakingMonologueItem;

const answer = (transcript: string, over: Partial<SpeakingAnswer> = {}): SpeakingAnswer => ({
  kind: 'speaking-reply',
  transcript,
  recordingPath: null,
  durationMs: 3000,
  ...over,
});

/** Evenly spaced stamps: one word every `stepMs`, `gapsAfter` word indexes get a long pause after them. */
function stamps(
  words: string[],
  stepMs: number,
  gapsAfter: number[] = [],
  pauseMs = 900,
): SpeakingWordStamp[] {
  const out: SpeakingWordStamp[] = [];
  let t = 0;
  words.forEach((w, i) => {
    out.push({ w, s: t, e: t + stepMs - 100 });
    t += stepMs;
    if (gapsAfter.includes(i)) t += pauseMs;
  });
  return out;
}

describe('task mapping + shares', () => {
  it('task by kind; the fixture has 1 + 1 + one monologue group', () => {
    expect(speakingTaskOf(REPLY)).toBe(1);
    expect(speakingTaskOf(SITUATION)).toBe(2);
    expect(speakingTaskOf(MONO)).toBe(3);
    expect(taskSlots(SPEAKING)).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it('shares = 25 / 25 / 50 of maxPoints over the task slots', () => {
    expect(TASK_WEIGHT).toEqual({ 1: 25, 2: 25, 3: 50 });
    expect(responseShare(SPEAKING, REPLY)).toBe(25);
    expect(responseShare(SPEAKING, SITUATION)).toBe(25);
    expect(responseShare(SPEAKING, MONO)).toBe(50);
    // the official shape: 5 replies → 5 points each
    const five = {
      maxPoints: 100,
      parts: [{ items: Array.from({ length: 5 }, () => REPLY) }, { items: [MONO] }],
    };
    expect(responseShare(five, REPLY)).toBeCloseTo((100 * (25 / 75)) / 5, 3);
    expect(responseShare(five, MONO)).toBeCloseTo(100 * (50 / 75), 3);
  });
});

describe('tasks 1–2 (judge mapping, full-answer bonus)', () => {
  it('the full-answer threshold is calibrated to the model answer (recorded deviation)', () => {
    // schema default minTokens 4; «Я сейчас в Москве.» = 2 content tokens → threshold 2
    expect(REPLY.minTokens).toBe(4);
    expect(fullAnswerThreshold(REPLY)).toBe(2);
    expect(fullAnswerThreshold(SITUATION)).toBe(2);
    expect(fullAnswerThreshold({ ...REPLY, minTokens: 1 })).toBe(1);
  });

  it('a matched full answer: 60 + 20 of 80 → 100 % provisional; grammar pending', () => {
    const g = gradeTurnOffline(REPLY, answer('Я сейчас живу в Москве'));
    expect(g.task).toBe(1);
    expect(g.criteria).toEqual([
      { id: 'task-response', score: 60, max: 60 },
      { id: 'completeness', score: 20, max: 20 },
    ]);
    expect(g.offlineMax).toBe(TURN_OFFLINE_MAX);
    expect(g.pct).toBe(100);
    expect(g.provisional).toBe(true);
    expect(g.details.task).toBe(1);
    if (g.details.task !== 3) {
      expect(g.details.verdict).toBe('matched');
      expect(g.details.fullAnswer).toBe(true);
      expect(g.details.slots).toEqual({ city: 'city' });
    }
  });

  it('«Москва» alone matches the slot but is not a full answer (< minTokens): 60 of 80', () => {
    const g = gradeTurnOffline(REPLY, answer('в Москве'));
    expect(g.criteria[0]!.score).toBe(60);
    expect(g.criteria[1]!.score).toBe(0);
    expect(g.pct).toBe(75);
  });

  it('«да» / «нет» / «не знаю» → 0 (miss, no full-answer bonus)', () => {
    for (const t of ['да', 'нет', 'не знаю', 'да да да да да']) {
      const g = gradeTurnOffline(REPLY, answer(t));
      expect(g.criteria[1]!.score).toBe(0);
      expect(g.criteria[0]!.score).toBe(0);
      expect(g.pct).toBe(0);
    }
  });

  it('no speech → 0 everywhere with verdict no-speech', () => {
    const g = gradeTurnOffline(REPLY, answer(''));
    expect(g.pct).toBe(0);
    if (g.details.task !== 3) expect(g.details.verdict).toBe('no-speech');
  });

  it('a near miss (paraphrase ≥ 40 < 60) earns half the response points', () => {
    // «Я сейчас в …» without the city: 3 of 4 target words of accept[0] → 75 ≥ 60 ⇒ matched by paraphrase.
    const g = gradeTurnOffline(REPLY, answer('я сейчас в городе далеко'));
    if (g.details.task !== 3) {
      expect(['matched', 'miss']).toContain(g.details.verdict);
    }
    // A miss that is clearly going for it: two of four words.
    const near = gradeTurnOffline(REPLY, answer('я сейчас дома'));
    if (near.details.task !== 3 && near.details.nearMiss) {
      expect(near.criteria[0]!.score).toBe(30);
    }
  });

  it('the Whisper assist transcript wins when it judges better, and the row says so', () => {
    const g = gradeTurnOffline(
      REPLY,
      answer('я тут сижу дома', { assistTranscript: 'Я сейчас в Москве.' }),
    );
    if (g.details.task !== 3) {
      expect(g.details.verdict).toBe('matched');
      expect(g.details.transcriptUsed).toBe('assist');
    }
    expect(g.pct).toBe(100);
    const same = gradeTurnOffline(
      REPLY,
      answer('Я сейчас в Москве', { assistTranscript: 'я тут сижу дома' }),
    );
    if (same.details.task !== 3) expect(same.details.transcriptUsed).toBe('primary');
    // a tolerant mis-hearing («мостке») already matches by paraphrase on the primary
    const tol = gradeTurnOffline(REPLY, answer('я сейчас в мостке'));
    if (tol.details.task !== 3) expect(tol.details.verdict).toBe('matched');
  });

  it('task 2: the free slot with cues — a real question matches, a statement does not', () => {
    const ok = gradeTurnOffline(SITUATION, answer('Скажи, где ты работаешь?'));
    expect(ok.task).toBe(2);
    expect(ok.criteria[0]!.score).toBe(60);
    expect(ok.criteria[1]!.score).toBe(20);
    const no = gradeTurnOffline(SITUATION, answer('я живу в Москве и люблю читать'));
    expect(no.criteria[0]!.score).toBe(0);
  });
});

describe('verbs + sentence estimate', () => {
  it('recognizes common A1 verb forms and leaves nouns alone', () => {
    for (const v of [
      'живу',
      'работаю',
      'люблю',
      'зовут',
      'учусь',
      'читал',
      'был',
      'нравится',
      'хочу',
    ])
      expect(looksLikeVerb(v)).toBe(true);
    for (const n of ['москва', 'дом', 'квартира', 'митч', 'колорадо', 'книги', 'и', 'в'])
      expect(looksLikeVerb(n)).toBe(false);
    expect(countVerbs(['я', 'живу', 'в', 'москве', 'и', 'работаю'])).toBe(2);
  });

  it('clauses split at pauses ≥ 600 ms, capped by verbs + 1', () => {
    const words = 'меня зовут митч я живу в москве я работаю в банке я люблю читать'.split(' ');
    const est = estimateSentences(words.join(' '), stamps(words, 300, [2, 6, 10]));
    expect(est.clauses).toBe(4);
    expect(est.verbs).toBe(5); // зовут · живу · работаю · люблю · читать (the infinitive counts)
    expect(est.sentences).toBe(4);
    expect(est.words).toBe(14);
    expect(est.longestPauseMs).toBe(900 + 100);
    expect(PAUSE_CLAUSE_MS).toBe(600);
  });

  it('many pauses but few verbs: the verb cap holds the estimate down', () => {
    const words = 'москва дом квартира книги работа'.split(' ');
    const est = estimateSentences(words.join(' '), stamps(words, 300, [0, 1, 2, 3]));
    expect(est.clauses).toBe(5);
    expect(est.verbs).toBe(0);
    expect(est.sentences).toBe(1);
  });

  it('no stamps → the verb count alone; empty → zeros', () => {
    expect(estimateSentences('я живу в москве и я работаю', undefined).sentences).toBe(2);
    expect(estimateSentences('', undefined)).toMatchObject({ sentences: 0, words: 0, wpm: 0 });
  });

  it('a custom pause threshold changes the clause split', () => {
    const words = 'я живу тут я работаю там'.split(' ');
    // the helper's gap = 100 ms word spacing + the pause: 500 ms < 600 by default, ≥ 400 when lowered
    const st = stamps(words, 300, [2], 400);
    expect(estimateSentences(words.join(' '), st).clauses).toBe(1);
    expect(estimateSentences(words.join(' '), st, { pauseMs: 400 }).clauses).toBe(2);
  });

  it('fluency bands: fast + no long pause = 1; slow with a 5 s pause = 0; no stamps = neutral', () => {
    expect(fluencyShare({ wpm: 80, longestPauseMs: 500, words: 20 })).toBe(1);
    expect(fluencyShare({ wpm: 20, longestPauseMs: 5000, words: 20 })).toBe(0);
    expect(fluencyShare({ wpm: 50, longestPauseMs: 3000, words: 20 })).toBeCloseTo(
      0.6 * (2 / 3) + 0.2,
    );
    expect(fluencyShare({ wpm: 0, longestPauseMs: 0, words: 20 })).toBe(0.5);
    expect(fluencyShare({ wpm: 0, longestPauseMs: 0, words: 0 })).toBe(0);
  });
});

describe('task 3 (monologue)', () => {
  const GOOD =
    'меня зовут митч я из америки я живу в колорадо я работаю программистом я люблю читать книги мне нравится музыка я хочу жить в киеве я учу русский язык каждый день я думаю это интересно';

  it('all four questions covered, ≥ 10 sentences, fluent → 70 of 70 → 100 % provisional', () => {
    const words = GOOD.split(' ');
    const gaps = [2, 5, 9, 12, 16, 19, 24, 30, 33]; // 9 pauses → 10 clauses; 9 verbs + 1 slack caps at 10
    const g = gradeMonologueOffline(MONO, answer(GOOD, { words: stamps(words, 350, gaps, 800) }));
    expect(g.task).toBe(3);
    expect(g.offlineMax).toBe(MONOLOGUE_OFFLINE_MAX);
    expect(g.criteria.map((c) => c.id)).toEqual(['coverage', 'length', 'fluency']);
    expect(g.criteria[0]!.score).toBe(40);
    expect(g.details.task).toBe(3);
    if (g.details.task === 3) {
      expect(g.details.covered).toBe(4);
      expect(g.details.sentences).toBe(10);
      expect(g.details.wpm).toBeGreaterThan(70);
    }
    expect(g.criteria[1]!.score).toBe(20);
    expect(g.criteria[2]!.score).toBe(10);
    expect(g.pct).toBe(100);
  });

  it('two questions covered, 4 sentences, no stamps → 20 + 8 + 5 = 33 of 70', () => {
    const g = gradeMonologueOffline(
      MONO,
      answer('меня зовут митч я живу в колорадо я работаю я читаю', {}),
    );
    expect(g.criteria[0]!.score).toBe(20);
    expect(g.criteria[1]!.score).toBe(8);
    expect(g.criteria[2]!.score).toBe(5);
    expect(g.pct).toBe(47.1);
    if (g.details.task === 3) {
      expect(g.details.coveredIdx).toEqual([0, 2]);
      expect(g.details.missingIdx).toEqual([1, 3]);
    }
  });

  it('an empty monologue is 0; the assist transcript lifts coverage when it hears more cues', () => {
    expect(gradeMonologueOffline(MONO, answer('')).pct).toBe(0);
    const g = gradeMonologueOffline(
      MONO,
      answer('меня зовут митч', { assistTranscript: 'меня зовут митч я из америки я живу тут' }),
    );
    expect(g.criteria[0]!.score).toBe(30);
    if (g.details.task === 3) expect(g.details.transcriptUsed).toBe('assist');
  });
});

describe('subtest scoring (the computeFinish path)', () => {
  it('Σ pct × share over answered items; the unchosen topic contributes nothing', () => {
    const answers = {
      [REPLY.id]: answer('Я сейчас в Москве'),
      [SITUATION.id]: answer('где ты работаешь', { kind: 'speaking-situation' }),
      [MONO.id]: answer('меня зовут митч я живу в колорадо я работаю я читаю', {
        kind: 'speaking-monologue',
      }),
    };
    const r = scoreSpeakingSubtest(SPEAKING, answers);
    expect(r.maxPoints).toBe(100);
    expect(r.points).toBe(25 + 25 + 23.6);
    expect(r.pct).toBe(73.6);
    expect(offlineSpeakingPoints(gradeSpeakingOffline(REPLY, answers[REPLY.id])!, 25)).toBe(25);
  });

  it('nothing answered → 0 %; gradeSpeakingOffline is null for a non-speaking item', () => {
    expect(scoreSpeakingSubtest(SPEAKING, {}).pct).toBe(0);
    const choice = EXAM.subtests.find((s) => s.kind === 'lexgram')!.parts[0]!.items[0]!;
    expect(gradeSpeakingOffline(choice, undefined)).toBeNull();
  });
});
