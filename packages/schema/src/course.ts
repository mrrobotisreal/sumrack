import { z } from 'zod';
import { CefrLevelSchema, LocalizedTextSchema, StableIdSchema } from './common';
import {
  ChoiceItemSchema,
  SpeakingTurnItemSchema,
  StoryRefSchema,
  TypedItemSchema,
  WritingItemSchema,
} from './exam';

/**
 * The `course` pack type (T88, M25, ADR-0022, design HOTEL_PATH §2): one pack
 * is one floor of the «Отель «Сумрак»» TORFL course. A floor holds units; a
 * unit is a lesson (cards, in order) plus a scored exercise pool; the floor
 * holds an exam pool. Every Russian sentence lives in a story of the same pack
 * (the exam-pack precedent), so tap-lookup, karaoke and the TORFL voice rule
 * apply unchanged. Field names are BINDING — content agents author against them.
 */

/** D13 — fixed gate values. The validator enforces them so a typo cannot soften a gate. */
export const COURSE_GATE_PASS_PERCENT = 80;
export const COURSE_GATE_EXTERN_PASS_PERCENT = 90;

/** Every course explain is long enough to name the trigger, the rule and why each wrong option is wrong (design §4.1 rule 4). */
const EXPLAIN_MIN = 120;
const EXPLAIN_MESSAGE = `explain must be at least ${EXPLAIN_MIN} characters — name the trigger, the rule, then why each wrong option is wrong`;

/** A sentence of a story in the SAME pack. Both ids must resolve (pack.ts / checkCourseInvariants). */
export const SentenceRefSchema = z.strictObject({
  storyId: StableIdSchema,
  sentenceId: StableIdSchema,
});
export type SentenceRef = z.infer<typeof SentenceRefSchema>;

/**
 * A real sentence from a PUBLISHED pack, quoted in a library card. `text` is a
 * byte-exact copy so the app can render the quote even when the source pack is
 * not installed; the validate report checks it against the live manifest.
 */
export const LibraryQuoteSchema = z.strictObject({
  packId: StableIdSchema,
  storyId: StableIdSchema,
  sentenceId: StableIdSchema,
  /** Token surfaces to colour in the quote. */
  highlight: z.array(z.string().min(1)),
  why: z.string().min(1),
  text: z.string().min(1),
});
export type LibraryQuote = z.infer<typeof LibraryQuoteSchema>;

/** A voiced example sentence on an explain or edge card. */
export const CourseExampleSchema = z.strictObject({
  sentenceRef: SentenceRefSchema,
  /** Token surfaces to colour (the ending, the trigger word). */
  highlight: z.array(z.string().min(1)),
  /** «в + где? → предложный» */
  why: z.string().min(1).optional(),
});
export type CourseExample = z.infer<typeof CourseExampleSchema>;

/** «Ловушки»: ✗ wrong → ✓ right, with the reason. */
export const TrapPairSchema = z.strictObject({
  /** «Я иду в театре» */
  wrong: z.string().min(1),
  right: SentenceRefSchema,
  reason: z.string().min(1),
});
export type TrapPair = z.infer<typeof TrapPairSchema>;

/**
 * An ending table on an explain card. Cells are markdown-free. Every row must
 * have exactly as many cells as the header (checked here, with the row path).
 */
export const CourseTableSchema = z
  .strictObject({
    caption: z.string().min(1).optional(),
    header: z.array(z.string().min(1)).min(1),
    rows: z.array(z.array(z.string())).min(1),
  })
  .superRefine((table, ctx) => {
    table.rows.forEach((row, ri) => {
      if (row.length !== table.header.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows', ri],
          message: `row has ${row.length} cell${row.length === 1 ? '' : 's'}, the header has ${table.header.length}`,
        });
      }
    });
  });
export type CourseTable = z.infer<typeof CourseTableSchema>;

/**
 * Reserved for T94 («Встречалось в ваших книгах», D17): an in-app query over
 * annotated tokens. M25 authors it where obvious and never reads it.
 */
export const GrammarQuerySchema = z.strictObject({
  pos: z.string().optional(),
  grammarIncludes: z.array(z.string()).optional(),
  lemmaIn: z.array(z.string()).optional(),
});
export type GrammarQuery = z.infer<typeof GrammarQuerySchema>;

/** Lesson cards (design §2). Discriminated on `kind`; order inside a unit is the lesson order. */
export const ExplainCardSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('explain'),
  title: LocalizedTextSchema,
  /** Markdown; English prose, Russian terms may be quoted. */
  body: z.string().min(1),
  table: CourseTableSchema.optional(),
  examples: z.array(CourseExampleSchema),
});

/** «Проверь себя»: ungraded, 1–4 check items (never in a scored pool). */
export const CheckCardSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('check'),
  items: z.array(StableIdSchema).min(1).max(4),
});

/** «Ловушки»: every classic trap side by side. Required on every non-orientation unit. */
export const TrapsCardSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('traps'),
  title: LocalizedTextSchema,
  pairs: z.array(TrapPairSchema).min(1),
});

/** «Тонкости»: edge cases and exceptions. Required on every non-orientation unit. */
export const EdgeCardSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('edge'),
  title: LocalizedTextSchema,
  body: z.string().min(1),
  examples: z.array(CourseExampleSchema),
});

/** «Из библиотеки»: 1–8 real published sentences. */
export const LibraryCardSchema = z.strictObject({
  id: StableIdSchema,
  kind: z.literal('library'),
  quotes: z.array(LibraryQuoteSchema).min(1).max(8),
});

export const CourseCardSchema = z.discriminatedUnion('kind', [
  ExplainCardSchema,
  CheckCardSchema,
  TrapsCardSchema,
  EdgeCardSchema,
  LibraryCardSchema,
]);
export type CourseCard = z.infer<typeof CourseCardSchema>;
export type ExplainCard = z.infer<typeof ExplainCardSchema>;
export type CheckCard = z.infer<typeof CheckCardSchema>;
export type TrapsCard = z.infer<typeof TrapsCardSchema>;
export type EdgeCard = z.infer<typeof EdgeCardSchema>;
export type LibraryCard = z.infer<typeof LibraryCardSchema>;

/** The unit's scored exercises: `size` items drawn from `pool` (pool ≥ size + 6, checked at pack level). */
export const CourseExercisesSchema = z.strictObject({
  size: z.number().int().min(1),
  pool: z.array(StableIdSchema),
});

export const CourseUnitSchema = z.strictObject({
  id: StableIdSchema,
  title: LocalizedTextSchema,
  summary: z.strictObject({ en: z.string().min(1) }),
  /** The lesson, in order. */
  cards: z.array(CourseCardSchema).min(1),
  exercises: CourseExercisesSchema,
  grammarQuery: GrammarQuerySchema.optional(),
});
export type CourseUnit = z.infer<typeof CourseUnitSchema>;

/** Scored item items: the exam item shapes, plus `voiced` and the course's stricter `explain`. */
export const CourseChoiceItemSchema = ChoiceItemSchema.extend({
  explain: z.string().min(EXPLAIN_MIN, EXPLAIN_MESSAGE),
  stemEn: z.string().min(1),
  voiced: SentenceRefSchema.optional(),
});
export const CourseTypedItemSchema = TypedItemSchema.extend({
  explain: z.string().min(EXPLAIN_MIN, EXPLAIN_MESSAGE),
  voiced: SentenceRefSchema.optional(),
});
export const CourseWritingItemSchema = WritingItemSchema.extend({
  voiced: SentenceRefSchema.optional(),
});
export const CourseSpeakingTurnItemSchema = SpeakingTurnItemSchema.extend({
  voiced: SentenceRefSchema.optional(),
});

/** Find-the-trigger: pick the token that forces the form. */
export const CourseTriggerItemSchema = z
  .strictObject({
    id: StableIdSchema,
    topic: StableIdSchema,
    kind: z.literal('trigger'),
    sentence: z.string().min(1),
    tokens: z.array(z.string().min(1)).min(2),
    /** Index into `tokens` of the word that forces the form. */
    answer: z.number().int().min(0),
    explain: z.string().min(EXPLAIN_MIN, EXPLAIN_MESSAGE),
    voiced: SentenceRefSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (item.answer >= item.tokens.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['answer'],
        message: `answer ${item.answer} is out of range for ${item.tokens.length} tokens (0-based)`,
      });
    }
  });
export type CourseTriggerItem = z.infer<typeof CourseTriggerItemSchema>;

/** Transform: rewrite the prompt into the target form; `accept` lists full answers, `half` right lemma / wrong ending. */
export const CourseTransformItemSchema = z.strictObject({
  id: StableIdSchema,
  topic: StableIdSchema,
  kind: z.literal('transform'),
  prompt: z.string().min(1),
  accept: z.array(z.string().min(1)).min(1),
  half: z.array(z.string().min(1)).optional(),
  explain: z.string().min(EXPLAIN_MIN, EXPLAIN_MESSAGE),
  voiced: SentenceRefSchema.optional(),
});
export type CourseTransformItem = z.infer<typeof CourseTransformItemSchema>;

export const CourseItemSchema = z.discriminatedUnion('kind', [
  CourseChoiceItemSchema,
  CourseTypedItemSchema,
  CourseWritingItemSchema,
  CourseSpeakingTurnItemSchema,
  CourseTriggerItemSchema,
  CourseTransformItemSchema,
]);
export type CourseItem = z.infer<typeof CourseItemSchema>;

/** The floor exam (D13): drawn from a pool of at least 2 × size. */
export const CourseFloorExamSchema = z.strictObject({
  size: z.number().int().min(1),
  pool: z.array(StableIdSchema),
});

/** A drill exam of the existing shelf whose items this floor's «Практика» reuses (D16). */
export const CoursePracticeRefSchema = z.strictObject({
  packId: StableIdSchema,
  examId: StableIdSchema,
});

/** D13 gates. Values are fixed by the validator (`checkCourseInvariants`), not by the schema. */
export const CourseGateSchema = z.strictObject({
  passPercent: z.number().int().min(1).max(100),
  extern: z.strictObject({ passPercent: z.number().int().min(1).max(100) }),
});

/** The `course` section of a pack (design §2): one floor of the ladder. */
export const CourseSchema = z.strictObject({
  /** The course family. `torfl` today; plain stable id, so A2+ needs no schema change (D20). */
  ladder: StableIdSchema,
  level: CefrLevelSchema,
  /** 0 = Вестибюль; 13 is never a course floor (Номер 13 is the mock `a1-torfl-mock-004`). */
  floor: z.number().int().min(0).max(99),
  title: LocalizedTextSchema,
  subtitle: LocalizedTextSchema.optional(),
  gate: CourseGateSchema,
  practice: z.array(CoursePracticeRefSchema),
  units: z.array(CourseUnitSchema).min(1),
  /** Absent only on floor 0 (checked with the other invariants). */
  floorExam: CourseFloorExamSchema.optional(),
});
export type Course = z.infer<typeof CourseSchema>;
export type CourseUnitExercises = z.infer<typeof CourseExercisesSchema>;
export type CourseFloorExam = z.infer<typeof CourseFloorExamSchema>;
export type CoursePracticeRef = z.infer<typeof CoursePracticeRefSchema>;
export type CourseGate = z.infer<typeof CourseGateSchema>;

type IssueFn = (path: (string | number)[], message: string) => void;

/** The story/sentence view the course invariants need — structural, so pack.ts can pass its own Pack. */
export interface CourseInvariantPack {
  course: Course;
  items: readonly CourseItem[];
  stories: readonly { id: string; sentences: readonly { id: string }[] }[];
}

/**
 * Pack-level course invariants (ADR-0022, design §2, BINDING). Each issue
 * carries the path to the exact bad field. Called by `PackSchema` only once the
 * pack's own shape is valid. Live-manifest checks (practice refs, library
 * quote text) are NOT here: they are the `validate` course report.
 */
export function checkCourseInvariants(pack: CourseInvariantPack, issue: IssueFn): void {
  const { course, items } = pack;

  // gate values are fixed (D13)
  if (course.gate.passPercent !== COURSE_GATE_PASS_PERCENT) {
    issue(
      ['course', 'gate', 'passPercent'],
      `gate.passPercent is fixed at ${COURSE_GATE_PASS_PERCENT} (D13) — got ${course.gate.passPercent}`,
    );
  }
  if (course.gate.extern.passPercent !== COURSE_GATE_EXTERN_PASS_PERCENT) {
    issue(
      ['course', 'gate', 'extern', 'passPercent'],
      `gate.extern.passPercent is fixed at ${COURSE_GATE_EXTERN_PASS_PERCENT} (D13) — got ${course.gate.extern.passPercent}`,
    );
  }
  if (course.floor === 13) {
    issue(
      ['course', 'floor'],
      'floor 13 is never a course floor — Номер 13 is the mock a1-torfl-mock-004',
    );
  }

  // invariant a — ids unique (items, units, cards)
  const itemIds = new Map<string, number>();
  items.forEach((item, i) => {
    if (itemIds.has(item.id)) {
      issue(['items', i, 'id'], `duplicate item id "${item.id}" (item ids are unique per pack)`);
    }
    itemIds.set(item.id, i);
  });
  const unitIds = new Set<string>();
  const cardIds = new Set<string>();
  course.units.forEach((unit, ui) => {
    if (unitIds.has(unit.id)) {
      issue(['course', 'units', ui, 'id'], `duplicate unit id "${unit.id}"`);
    }
    unitIds.add(unit.id);
    unit.cards.forEach((card, ci) => {
      if (cardIds.has(card.id)) {
        issue(
          ['course', 'units', ui, 'cards', ci, 'id'],
          `duplicate card id "${card.id}" (card ids are unique per pack)`,
        );
      }
      cardIds.add(card.id);
    });
  });

  // invariant b — story/sentence refs resolve to THIS pack
  const sentencesByStory = new Map(
    pack.stories.map((s) => [s.id, new Set(s.sentences.map((x) => x.id))]),
  );
  const checkSentenceRef = (ref: SentenceRef, path: (string | number)[]) => {
    const sentences = sentencesByStory.get(ref.storyId);
    if (sentences === undefined) {
      issue(
        [...path, 'storyId'],
        `unknown story "${ref.storyId}" (refs point into this pack's stories)`,
      );
    } else if (!sentences.has(ref.sentenceId)) {
      issue(
        [...path, 'sentenceId'],
        `sentence "${ref.sentenceId}" is not in story "${ref.storyId}"`,
      );
    }
  };
  const checkStoryRef = (
    ref: z.infer<typeof StoryRefSchema> | undefined,
    path: (string | number)[],
  ) => {
    if (ref === undefined) return;
    const sentences = sentencesByStory.get(ref.storyId);
    if (sentences === undefined) {
      issue(
        [...path, 'storyId'],
        `unknown story "${ref.storyId}" (refs point into this pack's stories)`,
      );
      return;
    }
    ref.sentenceIds?.forEach((sid, k) => {
      if (!sentences.has(sid)) {
        issue([...path, 'sentenceIds', k], `sentence "${sid}" is not in story "${ref.storyId}"`);
      }
    });
  };

  items.forEach((item, i) => {
    const ip = ['items', i];
    if (item.kind === 'choice') {
      if (item.answer >= item.options.length) {
        issue(
          [...ip, 'answer'],
          `answer ${item.answer} is out of range for ${item.options.length} options (0-based)`,
        );
      }
      checkStoryRef(item.passage, [...ip, 'passage']);
      checkStoryRef(item.audio, [...ip, 'audio']);
    }
    if (item.kind === 'typed') {
      checkStoryRef(item.passage, [...ip, 'passage']);
      checkStoryRef(item.audio, [...ip, 'audio']);
    }
    if (item.kind === 'writing') checkStoryRef(item.model, [...ip, 'model']);
    if (item.kind === 'speaking-reply' || item.kind === 'speaking-situation') {
      checkStoryRef(item.prompt, [...ip, 'prompt']);
    }
    if (item.voiced !== undefined) checkSentenceRef(item.voiced, [...ip, 'voiced']);
  });

  // ids in checks, pools and the floor exam must name items
  const checkItemIds = new Set<string>();
  course.units.forEach((unit, ui) => {
    unit.cards.forEach((card, ci) => {
      const cp = ['course', 'units', ui, 'cards', ci];
      if (card.kind === 'check') {
        card.items.forEach((id, k) => {
          checkItemIds.add(id);
          if (!itemIds.has(id)) {
            issue([...cp, 'items', k], `check item "${id}" does not exist in items`);
          }
        });
      }
      if (card.kind === 'explain' || card.kind === 'edge') {
        card.examples.forEach((ex, k) =>
          checkSentenceRef(ex.sentenceRef, [...cp, 'examples', k, 'sentenceRef']),
        );
      }
      if (card.kind === 'traps') {
        card.pairs.forEach((pair, k) => checkSentenceRef(pair.right, [...cp, 'pairs', k, 'right']));
      }
    });
  });

  // invariant c / d — pools, sizes, the scored/unscored split
  const scoredInUnit = new Map<string, string>();
  course.units.forEach((unit, ui) => {
    const ep = ['course', 'units', ui, 'exercises'];
    unit.exercises.pool.forEach((id, k) => {
      if (!itemIds.has(id)) issue([...ep, 'pool', k], `pool item "${id}" does not exist in items`);
      if (checkItemIds.has(id)) {
        issue([...ep, 'pool', k], `check item "${id}" (Проверь себя) may not be in a scored pool`);
      }
      if (!scoredInUnit.has(id)) scoredInUnit.set(id, unit.id);
    });
    if (unit.exercises.pool.length < unit.exercises.size + 6) {
      issue(
        [...ep, 'pool'],
        `pool has ${unit.exercises.pool.length} items — needs at least size + 6 = ${unit.exercises.size + 6} (retry freshness)`,
      );
    }
    // invariant e — every non-orientation unit has traps and edge cards
    if (course.floor !== 0) {
      if (!unit.cards.some((c) => c.kind === 'traps')) {
        issue(
          ['course', 'units', ui, 'cards'],
          `unit "${unit.id}" has no traps card (every unit needs one off floor 0)`,
        );
      }
      if (!unit.cards.some((c) => c.kind === 'edge')) {
        issue(
          ['course', 'units', ui, 'cards'],
          `unit "${unit.id}" has no edge card (every unit needs one off floor 0)`,
        );
      }
    }
  });

  if (course.floorExam === undefined) {
    if (course.floor !== 0) {
      issue(
        ['course', 'floorExam'],
        `floor ${course.floor} needs a floorExam (only floor 0 may omit it)`,
      );
    }
  } else {
    const fe = course.floorExam;
    fe.pool.forEach((id, k) => {
      if (!itemIds.has(id))
        issue(['course', 'floorExam', 'pool', k], `pool item "${id}" does not exist in items`);
      if (checkItemIds.has(id)) {
        issue(
          ['course', 'floorExam', 'pool', k],
          `check item "${id}" (Проверь себя) may not be in the floor-exam pool`,
        );
      }
      const unitId = scoredInUnit.get(id);
      if (unitId !== undefined) {
        issue(
          ['course', 'floorExam', 'pool', k],
          `item "${id}" is also in unit "${unitId}"'s exercise pool — no item may sit in a unit pool and the floor-exam pool (gates measure learning, not memory)`,
        );
      }
    });
    if (fe.pool.length < 2 * fe.size) {
      issue(
        ['course', 'floorExam', 'pool'],
        `floorExam pool has ${fe.pool.length} items — needs at least 2 × size = ${2 * fe.size}`,
      );
    }
  }
}
