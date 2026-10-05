import { z } from 'zod';
import { CefrLevelSchema, LocalizedTextSchema, StableIdSchema } from './common';
import { ExpectationSchema, slotFormIssue } from './scenario';

/**
 * The `exam` pack type (T67, M18, design TORFL_EXAM_PREP §3, ADR-0020): one
 * or more structured tests — exam → subtests → parts → items — in either
 * `mock` mode (a faithful timed ТРКИ) or `drill` mode (practice). Reading
 * passages, listening scripts, examiner lines and model answers are ORDINARY
 * annotated stories in the same pack; items only *reference* them through
 * {@link StoryRefSchema} (resolved at the pack level — `pack.ts` — so this
 * schema stays self-contained and the app can `ExamSchema.parse` a stored
 * exam without its pack). Speaking items reuse the M17 `ExpectationSchema`
 * verbatim.
 */

export const EXAM_SUBTEST_KINDS = [
  'writing',
  'lexgram',
  'reading',
  'listening',
  'speaking',
] as const;
export const ExamSubtestKindSchema = z.enum(EXAM_SUBTEST_KINDS);
export type ExamSubtestKind = z.infer<typeof ExamSubtestKindSchema>;
/** Official SPbU order of a full mock (§1.3 decision 7). */
export const TORFL_SUBTEST_ORDER = EXAM_SUBTEST_KINDS;

/** Subtests scored by points per item (choice / typed); the others are rubric %. */
export const OBJECTIVE_SUBTEST_KINDS: readonly ExamSubtestKind[] = [
  'lexgram',
  'reading',
  'listening',
];

/** Points to a story (passage / listening script / examiner line / model answer) in the SAME pack. */
export const StoryRefSchema = z.strictObject({
  storyId: StableIdSchema,
  /** A contiguous run of the story's sentences; absent = the whole story. */
  sentenceIds: z.array(StableIdSchema).min(1).optional(),
  /** Which audio track plays (listening / examiner prompts); absent = the story's first track. */
  trackId: StableIdSchema.optional(),
});
export type StoryRef = z.infer<typeof StoryRefSchema>;

const ItemBase = {
  id: StableIdSchema,
  /** §3.4 topic slug — the app owns the label set; unknown slugs render raw. */
  topic: StableIdSchema,
  /** Overrides the subtest's `pointsPerItem` (objective items only). */
  points: z.number().positive().optional(),
  /** Why the answer is right — shown after answering in drills, in review after a mock. English, may quote Russian. */
  explain: z.string().min(1).optional(),
};

/** A–Г single choice. `stem` may contain one «…» gap. */
export const ChoiceItemSchema = z.strictObject({
  ...ItemBase,
  kind: z.literal('choice'),
  stem: z.string().min(1),
  /** EN gloss of the stem for drills' "show translation" (never shown in a mock). */
  stemEn: z.string().optional(),
  options: z.array(z.string().min(1)).min(2).max(4),
  answer: z.number().int().min(0),
  /** Reading: the passage; listening: the audio + transcript. */
  passage: StoryRefSchema.optional(),
  audio: StoryRefSchema.optional(),
});
export type ChoiceItem = z.infer<typeof ChoiceItemSchema>;

/** Free-text answer (listening info capture, drill cloze without options). */
export const TypedItemSchema = z.strictObject({
  ...ItemBase,
  kind: z.literal('typed'),
  /** «Тамара Иванова родилась (где?)» */
  prompt: z.string().min(1),
  /** Full credit (normalized, ё/е-tolerant, trailing-* stem globs allowed). */
  accept: z.array(z.string().min(1)).min(1),
  /** Half credit: right meaning, wrong form (demo v1's 2.5 of 5). */
  half: z.array(z.string().min(1)).optional(),
  passage: StoryRefSchema.optional(),
  audio: StoryRefSchema.optional(),
});
export type TypedItem = z.infer<typeof TypedItemSchema>;

/** Письмо: one letter task. */
export const WritingItemSchema = z.strictObject({
  ...ItemBase,
  kind: z.literal('writing'),
  /** The situation («Напишите письмо родителям…»). */
  task: LocalizedTextSchema,
  /** The bullet points to cover (`bullets`, not `points` — `points` is the score field); `cues` = stem globs whose presence marks the point covered offline. */
  bullets: z
    .array(
      z.strictObject({
        id: StableIdSchema,
        text: LocalizedTextSchema,
        cues: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(3)
    .max(15),
  /** Statements + questions together. */
  minSentences: z.number().int().min(5),
  minQuestions: z.number().int().min(0).default(0),
  maxQuestions: z.number().int().optional(),
  /** The model letter (a story in the pack, narrated). */
  model: StoryRefSchema.optional(),
});
export type WritingItem = z.infer<typeof WritingItemSchema>;

/** Говорение task 1 (reply) and task 2 (situation: the candidate starts). */
export const SpeakingTurnItemSchema = z.strictObject({
  ...ItemBase,
  kind: z.enum(['speaking-reply', 'speaking-situation']),
  /** The examiner's line / the situation as read aloud (audio + text). */
  prompt: StoryRefSchema,
  /** Situation text shown on screen (task 2 only; the real tester reads it aloud — both). */
  situation: LocalizedTextSchema.optional(),
  /** Reuses M17 verbatim: slots + accept paraphrases; accept[0] is the model answer. */
  expect: ExpectationSchema,
  /** «да / нет / не знаю» is not a full answer: minimum content tokens for full credit. */
  minTokens: z.number().int().min(1).default(4),
});
export type SpeakingTurnItem = z.infer<typeof SpeakingTurnItemSchema>;

/** Говорение task 3: monologue. Two items sharing `group` = «choose one of two topics». */
export const SpeakingMonologueItemSchema = z.strictObject({
  ...ItemBase,
  kind: z.literal('speaking-monologue'),
  group: StableIdSchema.optional(),
  /** «О себе» / «Мой дом» */
  topicTitle: LocalizedTextSchema,
  questions: z
    .array(z.strictObject({ ru: z.string().min(1), cues: z.array(z.string().min(1)).min(1) }))
    .min(4)
    .max(12),
  minSentences: z.number().int().default(10),
  maxSentences: z.number().int().default(12),
  prepSec: z.number().int().default(480),
  answerSec: z.number().int().default(120),
  model: StoryRefSchema.optional(),
});
export type SpeakingMonologueItem = z.infer<typeof SpeakingMonologueItemSchema>;

export const ExamItemSchema = z.discriminatedUnion('kind', [
  ChoiceItemSchema,
  TypedItemSchema,
  WritingItemSchema,
  SpeakingTurnItemSchema,
  SpeakingMonologueItemSchema,
]);
export type ExamItem = z.infer<typeof ExamItemSchema>;
export type ExamItemKind = ExamItem['kind'];

export const ExamPartSchema = z.strictObject({
  id: StableIdSchema,
  /** The official-style instruction («Задания 1–24. Выберите один вариант ответа.»). */
  instructions: LocalizedTextSchema,
  items: z.array(ExamItemSchema).min(1),
  /** Speaking: part time budget (task 1 = 300, task 2 = 300, task 3 = 600). */
  timeSec: z.number().int().positive().optional(),
});
export type ExamPart = z.infer<typeof ExamPartSchema>;

export const ExamSubtestSchema = z.strictObject({
  id: StableIdSchema,
  kind: ExamSubtestKindSchema,
  /** «Лексика. Грамматика» */
  title: LocalizedTextSchema,
  /** Official instruction screen text (time, item count, dictionary rule). */
  instructions: LocalizedTextSchema,
  durationMin: z.number().int().positive(),
  dictionary: z.boolean(),
  /** 'free' = jump between items (paper exam); 'linear' = forward only (listening, speaking). */
  navigation: z.enum(['free', 'linear']),
  /** Objective subtests. */
  pointsPerItem: z.number().positive().optional(),
  /** §1.3 decision 5. */
  maxPoints: z.number().positive(),
  /** Listening: how many times each audio plays in a mock (official: 2). */
  audioPlays: z.number().int().min(1).max(3).optional(),
  parts: z.array(ExamPartSchema).min(1),
});
export type ExamSubtest = z.infer<typeof ExamSubtestSchema>;

/** Item kinds each subtest kind may hold (§3.2 invariant 2). */
const KINDS_BY_SUBTEST: Record<ExamSubtestKind, readonly ExamItemKind[]> = {
  lexgram: ['choice', 'typed'],
  reading: ['choice', 'typed'],
  listening: ['choice', 'typed'],
  writing: ['writing'],
  speaking: ['speaking-reply', 'speaking-situation', 'speaking-monologue'],
};

/** Fill-in gap markers in a choice stem: «…» (U+2026), ASCII "...", or a run of ≥ 3 underscores. */
const GAP_RE = /…|\.\.\.|_{3,}/g;

/** Count the gaps in a stem (§3.2 invariant 3: at most one). */
export function countStemGaps(stem: string): number {
  return stem.match(GAP_RE)?.length ?? 0;
}

/** Option normalization for the uniqueness check: NFC, lower-case, ё → е, collapsed spaces. */
function normalizeOption(text: string): string {
  return text.normalize('NFC').toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();
}

/** Points an objective item is worth: its own `points`, else the subtest's `pointsPerItem`, else 0. */
export function itemPoints(subtest: Pick<ExamSubtest, 'pointsPerItem'>, item: ExamItem): number {
  return item.points ?? subtest.pointsPerItem ?? 0;
}

/**
 * The audio ref an item plays (§3.2 invariant 5): its own `audio`, else — one
 * dialogue → several questions — the FIRST item of its part's `audio`.
 * Undefined for items with no audio at either place (and for non-choice/typed
 * kinds, whose audio is their `prompt`). T70/T71 use this; never re-derive.
 */
export function resolveItemAudio(
  part: Pick<ExamPart, 'items'>,
  itemIdx: number,
): StoryRef | undefined {
  const item = part.items[itemIdx];
  if (item === undefined) return undefined;
  if ((item.kind === 'choice' || item.kind === 'typed') && item.audio !== undefined) {
    return item.audio;
  }
  if (item.kind !== 'choice' && item.kind !== 'typed') return undefined;
  const first = part.items[0];
  return first !== undefined && (first.kind === 'choice' || first.kind === 'typed')
    ? first.audio
    : undefined;
}

export type ExamRefField = 'passage' | 'audio' | 'prompt' | 'model';

/** One story ref inside an exam, with its path relative to the exam. */
export interface ExamStoryRef {
  ref: StoryRef;
  field: ExamRefField;
  subtestId: string;
  itemId: string;
  path: (string | number)[];
}

/** Every story ref an exam carries, in declaration order (refs as authored — inheritance not applied). */
export function examStoryRefs(exam: Exam): ExamStoryRef[] {
  const out: ExamStoryRef[] = [];
  exam.subtests.forEach((subtest, si) => {
    subtest.parts.forEach((part, pi) => {
      part.items.forEach((item, ii) => {
        const base = ['subtests', si, 'parts', pi, 'items', ii];
        const push = (field: ExamRefField, ref: StoryRef | undefined) => {
          if (ref !== undefined) {
            out.push({
              ref,
              field,
              subtestId: subtest.id,
              itemId: item.id,
              path: [...base, field],
            });
          }
        };
        if (item.kind === 'choice' || item.kind === 'typed') {
          push('passage', item.passage);
          push('audio', item.audio);
        } else if (item.kind === 'writing' || item.kind === 'speaking-monologue') {
          push('model', item.model);
        } else {
          push('prompt', item.prompt);
        }
      });
    });
  });
  return out;
}

/** Walk every string under `value` (skipping `{ru, en}` LocalizedText pairs, which check themselves). */
function walkStrings(
  value: unknown,
  path: (string | number)[],
  visit: (s: string, path: (string | number)[]) => void,
): void {
  if (typeof value === 'string') {
    visit(value, path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, [...path, i], visit));
  } else if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 2 && keys.includes('ru') && keys.includes('en')) return;
    for (const [k, v] of Object.entries(value)) walkStrings(v, [...path, k], visit);
  }
}

/** The raw (pre-refinement) exam shape. */
const ExamShape = z.strictObject({
  id: StableIdSchema,
  /** Future: 'tbu' / 'trki-1' via a new literal. */
  format: z.literal('torfl'),
  level: CefrLevelSchema,
  mode: z.enum(['mock', 'drill']),
  /** «Вариант 1» / «Падежи: предложный» */
  title: LocalizedTextSchema,
  /** Drills: a one-line EN description for the hub card. */
  blurb: z.string().optional(),
  subtests: z.array(ExamSubtestSchema).min(1),
});

/**
 * One exam. Invariants (TORFL §3.2 items 1–9), path-precise — T68–T74 and the
 * CT sessions debug against these:
 *
 * 1. subtest ids unique per exam; part ids unique per subtest; item ids
 *    unique per exam; every string NFC;
 * 2. kind compatibility — lexgram/reading/listening hold only choice/typed,
 *    a writing part exactly one writing item, speaking only speaking kinds;
 * 3. `choice.answer < options.length`; options unique after normalization;
 *    at most one gap («…», "...", "___") per stem;
 * 4. objective subtests: `pointsPerItem` set or every item has `points`;
 *    Σ item points == `maxPoints` (±0.001); `points` only on objective items;
 * 5. listening: every item has `audio` or inherits its part's first item's
 *    (so a part's first item needs one); `audioPlays` on listening subtests
 *    of `mock` exams;
 * 6. (reading passages may be omitted — not judged; refs resolve at pack level);
 * 8. `speaking-situation` has `situation`; monologue groups have exactly 2
 *    members; `minSentences ≤ maxSentences`;
 * 9. writing `minQuestions ≤ maxQuestions`; bullet ids unique per item; every
 *    cue (writing bullets, monologue questions, speaking `expect` slot forms)
 *    passes the M17 slot-form rule (NFC, punctuation-free, trailing-`*` only).
 *
 * Invariant 7 (refs resolve) lives in `PackSchema`; invariant 10 (official
 * shape) is the non-fatal {@link officialShapeIssues}.
 */
export const ExamSchema = ExamShape.superRefine((exam, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });

  // --- 1. NFC everywhere ------------------------------------------------
  walkStrings(exam, [], (s, path) => {
    if (s !== s.normalize('NFC')) issue(path, 'text must be UTF-8 NFC-normalized');
  });

  // --- 1. ids -----------------------------------------------------------
  const subtestIds = new Set<string>();
  const itemIds = new Map<string, string>();
  const groups = new Map<string, { count: number; path: (string | number)[] }>();
  exam.subtests.forEach((subtest, si) => {
    const sp = ['subtests', si];
    if (subtestIds.has(subtest.id)) issue([...sp, 'id'], `duplicate subtest id "${subtest.id}"`);
    subtestIds.add(subtest.id);

    const objective = OBJECTIVE_SUBTEST_KINDS.includes(subtest.kind);
    const allowed = KINDS_BY_SUBTEST[subtest.kind];
    const partIds = new Set<string>();
    let total = 0;
    let unpriced = false;

    subtest.parts.forEach((part, pi) => {
      const pp = [...sp, 'parts', pi];
      if (partIds.has(part.id)) {
        issue([...pp, 'id'], `duplicate part id "${part.id}" in subtest "${subtest.id}"`);
      }
      partIds.add(part.id);

      // --- 2. kind compatibility ------------------------------------------
      if (subtest.kind === 'writing' && part.items.length !== 1) {
        issue(
          [...pp, 'items'],
          `a writing part holds exactly one writing item (part "${part.id}" has ${part.items.length})`,
        );
      }

      part.items.forEach((item, ii) => {
        const ip = [...pp, 'items', ii];
        const seenIn = itemIds.get(item.id);
        if (seenIn !== undefined) {
          issue(
            [...ip, 'id'],
            `duplicate item id "${item.id}" (already used in subtest "${seenIn}") — item ids are unique per exam`,
          );
        }
        itemIds.set(item.id, subtest.id);

        if (!allowed.includes(item.kind)) {
          issue(
            [...ip, 'kind'],
            `a ${subtest.kind} subtest holds only ${allowed.join(' / ')} items (item "${item.id}" is ${item.kind})`,
          );
        }

        // --- 4. points ------------------------------------------------------
        if (objective) {
          if (item.points === undefined && subtest.pointsPerItem === undefined) unpriced = true;
          total += itemPoints(subtest, item);
        } else if (item.points !== undefined) {
          issue(
            [...ip, 'points'],
            `"points" is the objective score field — ${subtest.kind} items are scored by rubric % against the subtest's maxPoints`,
          );
        }

        // --- 3. choice --------------------------------------------------------
        if (item.kind === 'choice') {
          if (item.answer >= item.options.length) {
            issue(
              [...ip, 'answer'],
              `answer ${item.answer} is out of range for ${item.options.length} options (0-based)`,
            );
          }
          const seen = new Map<string, number>();
          item.options.forEach((option, oi) => {
            const norm = normalizeOption(option);
            const prev = seen.get(norm);
            if (prev !== undefined) {
              issue(
                [...ip, 'options', oi],
                `option "${option}" duplicates option ${prev} (after normalization)`,
              );
            }
            seen.set(norm, oi);
          });
          const gaps = countStemGaps(item.stem);
          if (gaps > 1) {
            issue(
              [...ip, 'stem'],
              `a stem has at most one gap («…», "..." or "___") — found ${gaps}`,
            );
          }
        }

        // --- 5. listening audio ---------------------------------------------
        if (
          subtest.kind === 'listening' &&
          (item.kind === 'choice' || item.kind === 'typed') &&
          resolveItemAudio(part, ii) === undefined
        ) {
          issue(
            [...ip, 'audio'],
            ii === 0
              ? `listening item "${item.id}" has no audio — the first item of a listening part must carry one`
              : `listening item "${item.id}" has no audio and its part's first item has none to inherit`,
          );
        }

        // --- 8. speaking ------------------------------------------------------
        if (item.kind === 'speaking-situation' && item.situation === undefined) {
          issue([...ip, 'situation'], `a speaking-situation item needs its "situation" text`);
        }
        if (item.kind === 'speaking-reply' || item.kind === 'speaking-situation') {
          item.expect.slots.forEach((slot, sli) => {
            if (slot.kind !== 'forms') return;
            slot.options.forEach((opt, oi) => {
              opt.forms.forEach((form, fi) => {
                const formIssue = slotFormIssue(form);
                if (formIssue !== null) {
                  issue([...ip, 'expect', 'slots', sli, 'options', oi, 'forms', fi], formIssue);
                }
              });
            });
          });
        }
        if (item.kind === 'speaking-monologue') {
          if (item.minSentences > item.maxSentences) {
            issue(
              [...ip, 'minSentences'],
              `minSentences ${item.minSentences} exceeds maxSentences ${item.maxSentences}`,
            );
          }
          if (item.group !== undefined) {
            const g = groups.get(item.group);
            if (g) g.count += 1;
            else groups.set(item.group, { count: 1, path: [...ip, 'group'] });
          }
          item.questions.forEach((q, qi) => {
            q.cues.forEach((cue, ci) => {
              const cueIssue = slotFormIssue(cue);
              if (cueIssue !== null)
                issue([...ip, 'questions', qi, 'cues', ci], cueIssue.replace(/^form/, 'cue'));
            });
          });
        }

        // --- 9. writing -------------------------------------------------------
        if (item.kind === 'writing') {
          if (item.maxQuestions !== undefined && item.minQuestions > item.maxQuestions) {
            issue(
              [...ip, 'minQuestions'],
              `minQuestions ${item.minQuestions} exceeds maxQuestions ${item.maxQuestions}`,
            );
          }
          const bulletIds = new Set<string>();
          item.bullets.forEach((bullet, bi) => {
            if (bulletIds.has(bullet.id)) {
              issue(
                [...ip, 'bullets', bi, 'id'],
                `duplicate bullet id "${bullet.id}" in item "${item.id}"`,
              );
            }
            bulletIds.add(bullet.id);
            bullet.cues.forEach((cue, ci) => {
              const cueIssue = slotFormIssue(cue);
              if (cueIssue !== null)
                issue([...ip, 'bullets', bi, 'cues', ci], cueIssue.replace(/^form/, 'cue'));
            });
          });
        }
      });
    });

    // --- 4. Σ points == maxPoints ---------------------------------------------
    if (objective) {
      if (unpriced) {
        issue(
          [...sp, 'pointsPerItem'],
          `objective subtest "${subtest.id}" needs "pointsPerItem" or "points" on every item`,
        );
      } else if (Math.abs(total - subtest.maxPoints) > 0.001) {
        issue(
          [...sp, 'maxPoints'],
          `item points add up to ${+total.toFixed(3)} but subtest "${subtest.id}" declares maxPoints ${subtest.maxPoints}`,
        );
      }
    }

    // --- 5. audioPlays on mock listening -------------------------------------
    if (subtest.kind === 'listening' && exam.mode === 'mock' && subtest.audioPlays === undefined) {
      issue(
        [...sp, 'audioPlays'],
        `a mock's listening subtest must set "audioPlays" (official: 2)`,
      );
    }
  });

  // --- 8. monologue groups of exactly two ----------------------------------
  for (const [group, { count, path }] of groups) {
    if (count !== 2) {
      issue(
        path,
        `monologue group "${group}" has ${count} member${count === 1 ? '' : 's'} — «choose one of two topics» needs exactly 2`,
      );
    }
  }
});
export type Exam = z.infer<typeof ExamSchema>;

/** The official A1 numbers (TORFL §2, demo v2) — the one place they live. */
export const TORFL_A1_SHAPE = {
  lexgram: { items: 70, maxPoints: 70, durationMin: 40, dictionary: false, navigation: 'free' },
  reading: { items: 25, maxPoints: 100, durationMin: 40, dictionary: true, navigation: 'free' },
  listening: {
    items: 20,
    maxPoints: 100,
    durationMin: 30,
    dictionary: false,
    navigation: 'linear',
    audioPlays: 2,
  },
  writing: { durationMin: 30, dictionary: true },
  speaking: { durationMin: 20, navigation: 'linear', partTimes: [300, 300, 600] },
} as const;

/**
 * Invariant 10 — the official-shape check (non-fatal; `validate` prints it).
 * For a `mock` with `format: 'torfl'`, `level: 'A1'`: the five subtests in
 * {@link TORFL_SUBTEST_ORDER}; lexgram 70 items / 70 points / 40 min, reading
 * 25 / 100 / 40, listening 20 / 100 / 30 with `audioPlays: 2`, writing 30 min,
 * speaking 20 min with parts 300 / 300 / 600 s; plus the dictionary rule
 * (decision 8) and navigation (free for paper subtests, linear for listening
 * and speaking). Returns `⚠ official-shape: …` lines, `[]` when conforming or
 * when the exam is not an A1 TORFL mock. Pure; never throws.
 */
export function officialShapeIssues(exam: Exam): string[] {
  if (exam.mode !== 'mock' || exam.format !== 'torfl' || exam.level !== 'A1') return [];
  const out: string[] = [];
  const warn = (msg: string) => out.push(`⚠ official-shape: ${msg}`);

  const kinds = exam.subtests.map((s) => s.kind);
  if (kinds.join(',') !== TORFL_SUBTEST_ORDER.join(',')) {
    warn(
      `subtests are [${kinds.join(', ')}] — the official order is [${TORFL_SUBTEST_ORDER.join(', ')}]`,
    );
  }

  for (const subtest of exam.subtests) {
    const label = `${subtest.kind} "${subtest.id}"`;
    const items = subtest.parts.reduce((n, p) => n + p.items.length, 0);
    const check = (what: string, got: unknown, want: unknown) => {
      if (got !== want) warn(`${label} ${what} ${String(got)} — official ${String(want)}`);
    };
    switch (subtest.kind) {
      case 'lexgram':
      case 'reading':
      case 'listening': {
        const shape = TORFL_A1_SHAPE[subtest.kind];
        check('has items', items, shape.items);
        check('maxPoints', subtest.maxPoints, shape.maxPoints);
        check('durationMin', subtest.durationMin, shape.durationMin);
        check('dictionary', subtest.dictionary, shape.dictionary);
        check('navigation', subtest.navigation, shape.navigation);
        if (subtest.kind === 'listening') {
          check('audioPlays', subtest.audioPlays, TORFL_A1_SHAPE.listening.audioPlays);
        }
        break;
      }
      case 'writing':
        check('durationMin', subtest.durationMin, TORFL_A1_SHAPE.writing.durationMin);
        check('dictionary', subtest.dictionary, TORFL_A1_SHAPE.writing.dictionary);
        break;
      case 'speaking': {
        check('durationMin', subtest.durationMin, TORFL_A1_SHAPE.speaking.durationMin);
        check('navigation', subtest.navigation, TORFL_A1_SHAPE.speaking.navigation);
        const times = subtest.parts.map((p) => p.timeSec ?? '—');
        const want = TORFL_A1_SHAPE.speaking.partTimes;
        if (times.join('/') !== want.join('/')) {
          warn(`${label} part times are ${times.join('/')} s — official ${want.join('/')} s`);
        }
        break;
      }
    }
  }
  return out;
}
