import { describe, expect, it } from 'vitest';
import { CourseItemSchema, CourseSchema, safeParsePack } from '../src';

/**
 * T88: the `course` pack type. One minimal valid floor, then one failing case
 * per pack-level invariant (ADR-0022, design HOTEL_PATH §2) asserting the exact
 * issue path. Each case mutates a deep clone so the base stays valid.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const EXPLAIN =
  'Trigger: в + где? The rule: the prepositional ending is -е or -и, named by the gender. Each wrong option fails because the case is wrong for the question.';

const sentence = (id: string, ru: string) => ({
  id,
  ru,
  en: `en ${id}`,
  tokens: [
    {
      text: ru.replace(/[.?!]$/, ''),
      lemma: ru,
      translation: 'x',
      pos: 'noun',
      grammar: 'x',
      level: 'A1',
    },
    { text: '.', isPunct: true },
  ],
});

const STORY_ID = 'u1-ex';
const SENT = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

const SENTENCE_IDS = SENT;

function choice(id: string, explain = EXPLAIN): any {
  return {
    id,
    topic: 'case-prep',
    kind: 'choice',
    stem: `Я живу в … городе ${id}.`,
    stemEn: 'I live in the … city.',
    options: ['большом', 'большой'],
    answer: 0,
    explain,
    voiced: { storyId: STORY_ID, sentenceId: 's1' },
  };
}

function typed(id: string): any {
  return {
    id,
    topic: 'case-prep',
    kind: 'typed',
    prompt: `Мой брат живёт в (городе) ${id}.`,
    accept: ['городе'],
    half: ['город'],
    explain: EXPLAIN,
  };
}

function trigger(id: string): any {
  return {
    id,
    topic: 'case-prep',
    kind: 'trigger',
    sentence: 'Мы говорим о школе.',
    tokens: ['Мы', 'говорим', 'о', 'школе'],
    answer: 2,
    explain: EXPLAIN,
  };
}

function transform(id: string): any {
  return {
    id,
    topic: 'case-prep',
    kind: 'transform',
    prompt: 'Это мой брат. → У меня нет …',
    accept: ['брата'],
    explain: EXPLAIN,
  };
}

/** Scored pool of 9 items split across the four kinds (exercise size 2 needs ≥ 8). */
const POOL_IDS = ['c01', 'c02', 'c03', 'c04', 't01', 'g01', 'g02', 'r01', 'r02'];
const EXAM_IDS = ['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08', 'e09', 'e10'];
const CHECK_IDS = ['k01', 'k02'];

function baseItems(): any[] {
  return [
    ...POOL_IDS.slice(0, 4).map((id) => choice(id)),
    typed('t01'),
    trigger('g01'),
    trigger('g02'),
    transform('r01'),
    transform('r02'),
    ...EXAM_IDS.map((id) => choice(id)),
    ...CHECK_IDS.map((id) => choice(id)),
  ];
}

function baseCourse(): any {
  return {
    ladder: 'torfl',
    level: 'A1',
    floor: 3,
    title: { ru: 'Где? О чём?', en: 'Where? About what?' },
    subtitle: { ru: 'Предложный падеж', en: 'Prepositional case' },
    gate: { passPercent: 80, extern: { passPercent: 90 } },
    practice: [{ packId: 'a1-torfl-lexgram-001', examId: 'lg-case-prep' }],
    units: [
      {
        id: 'u1',
        title: { ru: 'в + где', en: 'в + where' },
        summary: { en: 'In + where takes the prepositional case.' },
        cards: [
          {
            id: 'x1',
            kind: 'explain',
            title: { ru: 'В + предложный', en: 'In + prepositional' },
            body: 'The ending is -е for most masculine and neuter nouns.',
            table: { header: ['case', 'ending'], rows: [['prep', '-е']] },
            examples: [
              { sentenceRef: { storyId: STORY_ID, sentenceId: 's1' }, highlight: ['городе'] },
            ],
          },
          { id: 'c1', kind: 'check', items: ['k01', 'k02'] },
          {
            id: 'tr1',
            kind: 'traps',
            title: { ru: 'Ловушки', en: 'Traps' },
            pairs: [
              {
                wrong: 'Я живу в город',
                right: { storyId: STORY_ID, sentenceId: 's2' },
                reason: 'the city is in the prepositional',
              },
            ],
          },
          {
            id: 'ed1',
            kind: 'edge',
            title: { ru: 'Тонкости', en: 'Edge cases' },
            body: 'Some nouns take -и.',
            examples: [
              { sentenceRef: { storyId: STORY_ID, sentenceId: 's3' }, highlight: ['лесу'] },
            ],
          },
          {
            id: 'lib1',
            kind: 'library',
            quotes: [
              {
                packId: 'a1-no-end-house-001',
                storyId: 'part-1',
                sentenceId: 'nea1p1-s04',
                highlight: ['колледже'],
                why: 'в + где',
                text: 'Мы дружили в колледже.',
              },
            ],
          },
        ],
        exercises: { size: 2, pool: POOL_IDS },
      },
    ],
    floorExam: { size: 2, pool: EXAM_IDS.slice(0, 4) },
  };
}

function baseStories(): any[] {
  return [
    {
      id: STORY_ID,
      title: { ru: 'Тест', en: 'Test' },
      level: 'A1',
      sentences: SENTENCE_IDS.map((id, i) => sentence(id, `Предложение номер ${i + 1}.`)),
      audio: [],
    },
  ];
}

function baseCoursePack(): any {
  return {
    id: 'a1-hotel-f03',
    version: 1,
    type: 'course',
    title: { ru: 'Отель', en: 'Hotel' },
    level: 'A1',
    tags: ['torfl'],
    stories: baseStories(),
    course: baseCourse(),
    items: baseItems(),
  };
}

const clone = <T>(v: T): T => structuredClone(v);

function expectIssue(pack: unknown, pathSubstr: string, messageSubstr: string) {
  const result = safeParsePack(pack);
  expect(result.success).toBe(false);
  if (result.success) return;
  // Paths print as `items[1].id`; accept the dotted form the tests are written in.
  const norm = (p: string) => p.replace(/\[(\d+)\]/g, '.$1');
  const hit = result.issues.find(
    (i) => norm(i.path).includes(pathSubstr) && i.message.includes(messageSubstr),
  );
  expect(
    hit,
    `expected an issue at "${pathSubstr}" mentioning "${messageSubstr}", got:\n${result.message}`,
  ).toBeDefined();
}

describe('course pack — valid floor', () => {
  it('a minimal valid one-unit floor parses', () => {
    const result = safeParsePack(baseCoursePack());
    expect(result.success, result.success ? '' : result.message).toBe(true);
  });
});

describe('course pack — section gating', () => {
  it('a course pack without its course section is rejected', () => {
    const pack = clone(baseCoursePack());
    delete pack.course;
    expectIssue(pack, 'course', 'must include its "course" section');
  });

  it('a course pack without items is rejected', () => {
    const pack = clone(baseCoursePack());
    delete pack.items;
    expectIssue(pack, 'items', 'must include its "items"');
  });

  it('a course pack with no stories is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.stories = [];
    expectIssue(pack, 'stories', 'at least one story');
  });

  it('a non-course pack carrying a course section is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.type = 'stories';
    delete pack.items;
    expectIssue(pack, 'course', 'must not carry a "course" section');
  });

  it('a non-course pack carrying items is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.type = 'stories';
    delete pack.course;
    expectIssue(pack, 'items', 'must not carry "items"');
  });
});

describe('course pack — invariant a (unique ids)', () => {
  it('a duplicate item id is rejected at the second occurrence', () => {
    const pack = clone(baseCoursePack());
    pack.items[1].id = pack.items[0].id;
    expectIssue(pack, 'items.1.id', 'duplicate item id');
  });

  it('a duplicate unit id is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units.push(clone(pack.course.units[0]));
    expectIssue(pack, 'course.units.1.id', 'duplicate unit id');
  });

  it('a duplicate card id across units is rejected', () => {
    const pack = clone(baseCoursePack());
    const unit2 = clone(pack.course.units[0]);
    unit2.id = 'u2';
    unit2.cards[0].id = 'x1'; // collides with unit u1's first card
    pack.course.units.push(unit2);
    expectIssue(pack, 'course.units.1.cards.0.id', 'duplicate card id');
  });
});

describe('course pack — invariant b (refs resolve to this pack)', () => {
  it('a card example pointing at an unknown sentence is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].cards[0].examples[0].sentenceRef.sentenceId = 'nope';
    expectIssue(pack, 'examples.0.sentenceRef.sentenceId', 'is not in story');
  });

  it('a check item that is not in items is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].cards[1].items = ['ghost'];
    expectIssue(pack, 'cards.1.items.0', 'does not exist in items');
  });

  it('an exercise pool item that is not in items is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].exercises.pool[0] = 'ghost';
    expectIssue(pack, 'exercises.pool.0', 'does not exist in items');
  });

  it('a floor-exam pool item that is not in items is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.floorExam.pool[0] = 'ghost';
    expectIssue(pack, 'floorExam.pool.0', 'does not exist in items');
  });

  it('a trap right sentence in an unknown story is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].cards[2].pairs[0].right.storyId = 'elsewhere';
    expectIssue(pack, 'pairs.0.right.storyId', 'unknown story');
  });

  it('a voiced sentence that is not in its story is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.items[0].voiced.sentenceId = 'nope';
    expectIssue(pack, 'items.0.voiced.sentenceId', 'is not in story');
  });
});

describe('course pack — invariant c (pool sizes)', () => {
  it('an exercise pool smaller than size + 6 is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].exercises.pool = POOL_IDS.slice(0, 7); // size 2 needs 8
    expectIssue(pack, 'exercises.pool', 'needs at least size + 6 = 8');
  });

  it('a floor-exam pool smaller than 2 × size is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.floorExam.pool = EXAM_IDS.slice(0, 3); // size 2 needs 4
    expectIssue(pack, 'floorExam.pool', 'needs at least 2 × size = 4');
  });

  it('a floor above 0 without a floorExam is rejected', () => {
    const pack = clone(baseCoursePack());
    delete pack.course.floorExam;
    expectIssue(pack, 'course.floorExam', 'needs a floorExam');
  });

  it('floor 0 may omit its floorExam', () => {
    const pack = clone(baseCoursePack());
    pack.course.floor = 0;
    delete pack.course.floorExam;
    const result = safeParsePack(pack);
    expect(result.success, result.success ? '' : result.message).toBe(true);
  });
});

describe('course pack — invariant d (no item in two scored pools; checks unscored)', () => {
  it('an item in both a unit pool and the floor-exam pool is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.floorExam.pool[0] = pack.course.units[0].exercises.pool[0];
    expectIssue(pack, 'floorExam.pool.0', 'also in unit "u1"');
  });

  it('a check item in a scored pool is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].exercises.pool[0] = 'k01';
    expectIssue(pack, 'exercises.pool.0', 'may not be in a scored pool');
  });
});

describe('course pack — invariant e (traps + edge per unit)', () => {
  it('a unit off floor 0 with no traps card is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].cards = pack.course.units[0].cards.filter((c: any) => c.kind !== 'traps');
    expectIssue(pack, 'cards', 'has no traps card');
  });

  it('a unit off floor 0 with no edge card is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].cards = pack.course.units[0].cards.filter((c: any) => c.kind !== 'edge');
    expectIssue(pack, 'cards', 'has no edge card');
  });

  it('floor 0 units may omit traps and edge (orientation)', () => {
    const pack = clone(baseCoursePack());
    pack.course.floor = 0;
    delete pack.course.floorExam;
    pack.course.units[0].cards = pack.course.units[0].cards.filter(
      (c: any) => c.kind !== 'traps' && c.kind !== 'edge',
    );
    const result = safeParsePack(pack);
    expect(result.success, result.success ? '' : result.message).toBe(true);
  });
});

describe('course pack — invariant f (gate values fixed)', () => {
  it('a softened unit gate is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.gate.passPercent = 60;
    expectIssue(pack, 'course.gate.passPercent', 'fixed at 80');
  });

  it('a softened extern gate is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.gate.extern.passPercent = 70;
    expectIssue(pack, 'course.gate.extern.passPercent', 'fixed at 90');
  });

  it('floor 13 is rejected (Номер 13 is the mock, never a floor)', () => {
    const pack = clone(baseCoursePack());
    pack.course.floor = 13;
    expectIssue(pack, 'course.floor', 'floor 13 is never a course floor');
  });
});

describe('course pack — shape rules', () => {
  it('a library card with no quotes is rejected', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].cards[4].quotes = [];
    expectIssue(pack, 'quotes', 'Too small');
  });

  it('a table row shorter than the header is rejected at the row path', () => {
    const pack = clone(baseCoursePack());
    pack.course.units[0].cards[0].table = { header: ['a', 'b'], rows: [['only-one']] };
    expectIssue(pack, 'table.rows.0', 'row has 1 cell, the header has 2');
  });

  it('an explain item under 120 characters is rejected at its explain path', () => {
    const pack = clone(baseCoursePack());
    pack.items[0].explain = 'Too short.';
    expectIssue(pack, 'items.0.explain', 'at least 120 characters');
  });

  it('a trigger answer out of range for its tokens is rejected', () => {
    const pack = clone(baseCoursePack());
    const t = pack.items.find((i: any) => i.kind === 'trigger');
    t.answer = 9;
    expectIssue(pack, 'answer', 'out of range');
  });
});

describe('course item schema — strictness', () => {
  it('an unknown key on a course choice item is rejected (strictObject survives extend)', () => {
    const item = clone(baseItems()[0]);
    item.surprise = true;
    const result = CourseItemSchema.safeParse(item);
    expect(result.success).toBe(false);
  });

  it('an unknown key on the course section is rejected', () => {
    const course = clone(baseCourse());
    course.bonus = 1;
    expect(CourseSchema.safeParse(course).success).toBe(false);
  });
});
