import { ExamSchema, type Exam } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import {
  bestLabel,
  buildExamListItems,
  buildTopicTiles,
  countdownLabel,
  daysOutProp,
  daysUntil,
  examTopics,
  formatMinutes,
  groupTexts,
  introSubtestRows,
  mockRules,
  overallPct,
  placeholderReadiness,
  ruPlural,
  type AttemptLike,
  type ExamSummaryLike,
} from '../hub-model';

const PACK = examPackJson as unknown as {
  id: string;
  exams: unknown[];
  stories: { id: string; title: { ru: string; en: string }; sentences: unknown[] }[];
};
const EXAMS: Exam[] = PACK.exams.map((e) => ExamSchema.parse(e));
const mock = EXAMS.find((e) => e.mode === 'mock')!;
const drill = EXAMS.find((e) => e.mode === 'drill')!;

const summary = (exam: Exam, packId = PACK.id): ExamSummaryLike => ({
  packId,
  examId: exam.id,
  mode: exam.mode,
  titleRu: exam.title.ru,
  titleEn: exam.title.en,
  exam,
});

describe('countdown (pure daysUntil)', () => {
  it('counts whole calendar days, 0 = today, negative = past', () => {
    expect(daysUntil('2026-11-20', '2026-10-06')).toBe(45);
    expect(daysUntil('2026-10-06', '2026-10-06')).toBe(0);
    expect(daysUntil('2026-10-05', '2026-10-06')).toBe(-1);
  });

  it('is correct across midnight: the key flips, the count drops by exactly one', () => {
    // 23:59 on Oct 6 and 00:01 on Oct 7 differ only in the local day key.
    expect(daysUntil('2026-10-10', '2026-10-06')).toBe(4);
    expect(daysUntil('2026-10-10', '2026-10-07')).toBe(3);
  });

  it('is DST-safe (US fall-back Nov 1, EU Oct 25) and crosses a year', () => {
    expect(daysUntil('2026-11-02', '2026-10-31')).toBe(2);
    expect(daysUntil('2026-10-26', '2026-10-24')).toBe(2);
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('labels', () => {
    expect(countdownLabel(null, '2026-10-06')).toBe('Назначь дату экзамена');
    expect(countdownLabel('2026-10-06', '2026-10-06')).toBe('Экзамен сегодня');
    expect(countdownLabel('2026-10-07', '2026-10-06')).toBe('Экзамен завтра');
    expect(countdownLabel('2026-10-29', '2026-10-06')).toBe('До экзамена: 23 дня');
    expect(countdownLabel('2026-10-27', '2026-10-06')).toBe('До экзамена: 21 день');
    expect(countdownLabel('2026-10-17', '2026-10-06')).toBe('До экзамена: 11 дней');
    expect(countdownLabel('2026-10-01', '2026-10-06')).toBe('Дата экзамена прошла');
    expect(countdownLabel('not-a-date', '2026-10-06')).toBe('Назначь дату экзамена');
  });

  it('daysOutProp: cleared = -1, past clamps to 0', () => {
    expect(daysOutProp(null, '2026-10-06')).toBe(-1);
    expect(daysOutProp('2026-10-01', '2026-10-06')).toBe(0);
    expect(daysOutProp('2026-10-16', '2026-10-06')).toBe(10);
  });

  it('ruPlural', () => {
    const f = ['день', 'дня', 'дней'] as const;
    expect([1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => ruPlural(n, f))).toEqual([
      'день',
      'дня',
      'дней',
      'дней',
      'дней',
      'дней',
      'день',
      'дня',
      'дней',
      'день',
      'дней',
    ]);
  });
});

describe('readiness placeholder', () => {
  it('five rows in SPbU order, all «—»', () => {
    const rows = placeholderReadiness();
    expect(rows.map((r) => r.kind)).toEqual([
      'writing',
      'lexgram',
      'reading',
      'listening',
      'speaking',
    ]);
    expect(rows.every((r) => r.pct === null && r.band === null)).toBe(true);
  });
});

describe('exam rows', () => {
  it('one row per readable exam; unreadable JSON skipped; never-attempted = «не пройден»', () => {
    const rows = buildExamListItems(
      [summary(mock), summary(drill), { ...summary(drill), examId: 'broken', exam: null }],
      [],
    );
    expect(rows.map((r) => r.examId)).toEqual(['a1-mock-fx', 'a1-drill-fx']);
    expect(rows[0]).toMatchObject({
      mode: 'mock',
      subtestKinds: ['writing', 'lexgram', 'reading', 'listening', 'speaking'],
      itemCount: 16,
      totalMin: 160,
      best: null,
    });
    expect(rows[1]).toMatchObject({
      mode: 'drill',
      subtestKinds: ['lexgram'],
      itemCount: 6,
      totalMin: 10,
    });
    expect(bestLabel(rows[0]!.best)).toBe('не пройден');
  });

  it('best = best verdict first, then best %; only finished attempts of the same exam count', () => {
    const res = (pts: number, max: number) => ({
      lexgram: {
        points: pts,
        maxPoints: max,
        pct: (pts / max) * 100,
        provisional: false,
        gradedBy: 'offline' as const,
      },
    });
    const attempts: AttemptLike[] = [
      {
        packId: PACK.id,
        examId: 'a1-mock-fx',
        status: 'finished',
        results: res(90, 100),
        verdict: 'fail',
      },
      {
        packId: PACK.id,
        examId: 'a1-mock-fx',
        status: 'finished',
        results: res(70, 100),
        verdict: 'pass',
      },
      {
        packId: PACK.id,
        examId: 'a1-mock-fx',
        status: 'active',
        results: res(100, 100),
        verdict: 'pass',
      },
      {
        packId: PACK.id,
        examId: 'a1-drill-fx',
        status: 'finished',
        results: res(5, 6),
        verdict: null,
      },
    ];
    const [m, d] = buildExamListItems([summary(mock), summary(drill)], attempts);
    expect(m!.best).toEqual({ pct: 70, verdict: 'pass' });
    expect(bestLabel(m!.best)).toBe('лучший: 70 % · сдал');
    expect(d!.best).toEqual({ pct: 83.3, verdict: null });
  });

  it('overallPct sums points over max', () => {
    expect(overallPct(null)).toBeNull();
    expect(
      overallPct({
        a: { points: 50, maxPoints: 70, pct: 0, provisional: false, gradedBy: 'offline' },
        b: { points: 30, maxPoints: 30, pct: 0, provisional: false, gradedBy: 'offline' },
      }),
    ).toBe(80);
  });

  it('formatMinutes', () => {
    expect(formatMinutes(40)).toBe('40 мин');
    expect(formatMinutes(160)).toBe('2 ч 40 мин');
    expect(formatMinutes(60)).toBe('1 ч');
  });
});

describe('topic tiles', () => {
  it('drill items grouped by topic with counts → the drill exam; mocks ignored', () => {
    const tiles = buildTopicTiles([summary(mock), summary(drill)]);
    expect(tiles.lexgram).toEqual([
      {
        subtestKind: 'lexgram',
        topic: 'case-prep',
        itemCount: 6,
        packId: PACK.id,
        examId: 'a1-drill-fx',
      },
    ]);
    expect(tiles.reading).toEqual([]);
    expect(Object.keys(tiles)).toEqual(['writing', 'lexgram', 'reading', 'listening', 'speaking']);
  });

  it('a topic over two drill exams points at the one holding more of it; §3.4 order', () => {
    const two = structuredClone(drill);
    two.id = 'second';
    two.subtests[0]!.parts[0]!.items = two.subtests[0]!.parts[0]!.items.map((i, n) =>
      n < 2 ? { ...i, topic: 'lex-verbs' } : i,
    );
    const tiles = buildTopicTiles([summary(drill), summary(two)]);
    expect(tiles.lexgram.map((t) => [t.topic, t.itemCount, t.examId])).toEqual([
      ['lex-verbs', 2, 'second'],
      ['case-prep', 10, 'a1-drill-fx'],
    ]);
  });
});

describe('«Тексты» grouping', () => {
  const stories = PACK.stories.map((s, i) => ({
    packId: PACK.id,
    id: s.id,
    orderIdx: i,
    titleRu: s.title.ru,
    titleEn: s.title.en,
    sentenceCount: s.sentences.length,
  }));

  it('every fixture story lands under the subtest that first references it', () => {
    const groups = groupTexts(
      [summary(mock), summary(drill)],
      stories,
      new Set([`${PACK.id}/ls-01`]),
    );
    const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.texts.map((t) => t.storyId)]));
    expect(byKind).toEqual({ reading: ['rd-01'], listening: ['ls-01'] });
    const ls = groups.find((g) => g.kind === 'listening')!.texts[0]!;
    expect(ls.hasAudio).toBe(true);
    // the fixture's speaking prompts reuse the listening dialogue — both roles recorded
    expect(ls.roles).toEqual(['audio', 'prompt']);
    // T75 (THE LEVEL RULE): the text carries its pack's exam level.
    expect(ls.level).toBe('A1');
  });

  it('stories of packs without exams are never texts', () => {
    expect(groupTexts([], stories, new Set())).toEqual([]);
    expect(
      groupTexts([summary(mock)], [{ ...stories[0]!, packId: 'a1-torfl-lexicon-001' }], new Set()),
    ).toEqual([]);
  });

  it('an unreferenced story falls back to its pack’s first exam subtest', () => {
    const extra = { ...stories[0]!, id: 'model-letter', orderIdx: 9 };
    const groups = groupTexts([summary(mock)], [...stories, extra], new Set());
    expect(groups.find((g) => g.kind === 'writing')!.texts.map((t) => t.storyId)).toEqual([
      'model-letter',
    ]);
  });
});

describe('intro', () => {
  it('mock: the five subtests with times, item counts, points, dictionary flags', () => {
    const rows = introSubtestRows(mock);
    expect(
      rows.map((r) => [r.kind, r.durationMin, r.itemCount, r.points, r.maxPoints, r.dictionary]),
    ).toEqual([
      ['writing', 30, 1, null, 100, true],
      ['lexgram', 40, 5, 5, 5, false],
      ['reading', 40, 3, 12, 12, true],
      ['listening', 30, 3, 15, 15, false],
      ['speaking', 20, 4, null, 100, false],
    ]);
  });

  it('mock rules name the dictionary subtests and the listening rule', () => {
    const rules = mockRules(mock);
    expect(rules.some((r) => r.includes('звучит два раза'))).toBe(true);
    expect(rules).toContain('Словарь (поиск слова) можно: Письмо, Чтение.');
    expect(rules.some((r) => r.startsWith('Без словаря:') && r.includes('Аудирование'))).toBe(true);
    expect(rules.some((r) => r.includes('задание 3'))).toBe(true);
  });

  it('drill: topic list with counts', () => {
    expect(examTopics(drill)).toEqual([{ topic: 'case-prep', itemCount: 6 }]);
    expect(examTopics(mock).map((t) => t.topic)).toEqual([
      'lex-verbs',
      'case-prep',
      'case-gen',
      'verb-motion',
      'conj',
      'read-detail',
      'listen-who',
      'listen-detail',
      'write-letter',
      'speak-reply',
      'speak-situation',
      'speak-monologue',
    ]);
  });
});
