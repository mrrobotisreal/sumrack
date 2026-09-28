import { z } from 'zod';
import { CefrLevelSchema, LocalizedTextSchema, RelativePathSchema, StableIdSchema } from './common';
import {
  CharacterSchema,
  EndingSchema,
  NodeAudioSchema,
  PLAYER_CHARACTER_ID,
  analyzeDialogueGraph,
  type DialogueGraphInput,
} from './dialogue';
import { SentenceSchema } from './sentence';

/**
 * The `scenario` pack type (T56, design SPEAKING_SCENARIOS §2): a blind
 * speaking scenario — a cast with one drawn host, a scene, and a graph of
 * *turns*. Each turn is 1–3 host lines; a prompting turn carries an authored
 * *expectation* (slots + paraphrases + confusable rejects) that the on-device
 * judge scores the learner's spoken answer against, *retry* material
 * (confused / hint / second / lifeline), and slot-keyed branching
 * (`next.on[key]` + `next.default`, ≤ 4 branches). Every line — turn lines,
 * retry lines, reject reactions, glossary clips, nudges — is a fully
 * annotated {@link SentenceSchema} so scenario speech is tap-word explorable
 * in the debrief and feeds the word bank exactly like story sentences.
 *
 * Shares T25's primitives (`Character`, `Ending`, `NodeAudio`) and — through
 * {@link scenarioGraphInput} — the graph analysis `analyzeDialogueGraph`
 * verbatim (ADR-0019 decision 1). The `dialogue` type is untouched.
 */

/** Graph bounds (SCENARIOS §2.1). */
export const SCENARIO_MAX_TURNS = 40;
export const SCENARIO_MAX_LINES_PER_TURN = 3;
export const SCENARIO_MAX_BRANCHES = 4;
/** One mouth-track digit covers this many milliseconds of audio (§8.2). */
export const MOUTH_TRACK_STEP_MS = 40;

/** The branch key a `number` slot (or a forms slot with `acceptsNumber`) exposes. */
export const NUMBER_BRANCH_KEY = 'number';

export const ScenarioRoleSchema = z.enum(['host', 'npc', 'player']);
export type ScenarioRole = z.infer<typeof ScenarioRoleSchema>;

/**
 * Cast art. `body` is the PNG layer with the mouth CLOSED and eyes OPEN;
 * `eyelids` the same-canvas eyelids-closed layer (blink); `mouthAnchor` the
 * box (fractions of the body image) the SVG mouth is drawn inside.
 * `placeholder` asks the app to draw its code-drawn stand-in bust with this
 * palette (§8.3) — the PNG layers and the anchor may then be absent (T56
 * deviation from §2.1 as first written, where `body`/`mouthAnchor` were
 * unconditionally required: a placeholder cast ships no PNGs at all).
 */
export const PortraitSchema = z
  .strictObject({
    /** scene/<charId>/body.png — required unless `placeholder` is set. */
    body: RelativePathSchema.optional(),
    /** Same canvas, eyelids-closed layer (blink). */
    eyelids: RelativePathSchema.optional(),
    /** Fractions of the body image (0–1); the SVG mouth is drawn inside this box. Required with `body`. */
    mouthAnchor: z
      .strictObject({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        rotate: z.number().optional(),
      })
      .optional(),
    mouthStyle: z.enum(['default', 'wide', 'small', 'beard']).default('default'),
    /** 'placeholder' asks the app to draw its SVG stand-in with this palette; PNGs may be absent then. */
    placeholder: z
      .strictObject({
        kind: z.enum(['woman', 'man', 'youth', 'elder']),
        hue: z.number().min(0).max(360),
      })
      .optional(),
  })
  .superRefine((portrait, ctx) => {
    if (portrait.placeholder !== undefined) return;
    if (portrait.body === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'portrait needs a "body" PNG layer unless "placeholder" is set',
      });
    }
    if (portrait.mouthAnchor === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['mouthAnchor'],
        message: 'portrait needs a "mouthAnchor" box unless "placeholder" is set',
      });
    }
  });
export type Portrait = z.infer<typeof PortraitSchema>;

/** Reuses T25's Character (id/name/voice/style/audioTag) and adds the on-screen role + art. */
export const ScenarioCharacterSchema = CharacterSchema.extend({
  /** Exactly one 'host' (the one drawn); 'player' is the reserved learner. */
  role: ScenarioRoleSchema,
  portrait: PortraitSchema.optional(),
});
export type ScenarioCharacter = z.infer<typeof ScenarioCharacterSchema>;

export const ScenarioSceneSchema = z.strictObject({
  /** scene/backdrop.png 1080×1920 (portrait), optional (gradient fallback). */
  backdrop: RelativePathSchema.optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'accent is a hex color like "#c26a3a"')
    .optional(),
  /** Bundled room-tone bed slug (§8.4); the app owns the known set, unknown ⇒ no bed. */
  bed: z.string().min(1).optional(),
  /** Where the host stands: the renderer's layout preset. */
  layout: z.enum(['center', 'left', 'desk']).default('center'),
});
export type ScenarioScene = z.infer<typeof ScenarioSceneSchema>;

/** One rendered line variant. `mouth` is the viseme track: one char '0'–'4' per 40 ms (§8.2). */
export const LineAudioSchema = NodeAudioSchema.extend({
  mouth: z
    .string()
    .regex(/^[0-4]*$/, 'mouth track is a string of viseme digits 0–4, one per 40 ms')
    .optional(),
});
export type LineAudio = z.infer<typeof LineAudioSchema>;

/**
 * A spoken line: annotated sentence + optional audio (same all-or-nothing
 * rule as dialogues, enforced per scenario on {@link ScenarioSchema}). The
 * per-line audio invariants live here so every line kind shares them:
 * stamps reference the line's OWN sentence and fit the duration; the mouth
 * track has one digit per 40 ms (±1).
 */
export const ScenarioLineSchema = z
  .strictObject({
    sentence: SentenceSchema,
    audio: LineAudioSchema.optional(),
  })
  .superRefine((line, ctx) => {
    const audio = line.audio;
    if (audio === undefined) return;
    audio.timestamps?.forEach((stamp, wi) => {
      const path = ['audio', 'timestamps', wi];
      if (stamp.sentenceId !== line.sentence.id) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'sentenceId'],
          message: `line audio stamp references sentence "${stamp.sentenceId}", but the line speaks sentence "${line.sentence.id}"`,
        });
        return;
      }
      if (stamp.tokenIndex >= line.sentence.tokens.length) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'tokenIndex'],
          message: `tokenIndex ${stamp.tokenIndex} is out of range for sentence "${stamp.sentenceId}" (${line.sentence.tokens.length} tokens)`,
        });
      }
      if (stamp.endMs > audio.durationMs) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'endMs'],
          message: `line audio stamp ends at ${stamp.endMs}ms, past the audio duration ${audio.durationMs}ms`,
        });
      }
    });
    if (audio.mouth !== undefined) {
      const expected = Math.ceil(audio.durationMs / MOUTH_TRACK_STEP_MS);
      if (Math.abs(audio.mouth.length - expected) > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['audio', 'mouth'],
          message: `mouth track has ${audio.mouth.length} steps but the audio lasts ${audio.durationMs}ms = ${expected} steps of ${MOUTH_TRACK_STEP_MS}ms (±1 allowed)`,
        });
      }
    }
  });
export type ScenarioLine = z.infer<typeof ScenarioLineSchema>;

export const SlotOptionSchema = z.strictObject({
  /** Branch key + debrief label; unique within the slot. */
  key: StableIdSchema,
  /** Dictionary lemma (for FSRS grading + «Practice these»); ё preserved. */
  lemma: z.string().min(1),
  /** Accepted surface forms; a trailing `*` makes a stem glob («голов*»). Normalized by the app (ё/е-tolerant). */
  forms: z.array(z.string().min(1)).min(1),
});
export type SlotOption = z.infer<typeof SlotOptionSchema>;

export const SlotSchema = z.discriminatedUnion('kind', [
  /** `acceptsNumber`: a numeral (§5.1 RU_NUMERALS or digits) also satisfies the slot, with option key 'number' (draft: a trailing `| number`). */
  z.strictObject({
    kind: z.literal('forms'),
    id: StableIdSchema,
    required: z.boolean(),
    options: z.array(SlotOptionSchema).min(1),
    acceptsNumber: z.boolean().default(false),
  }),
  /** Anything with ≥ minTokens content tokens; `cues` (optional) are phrases at least one of which must appear («зовут», «я …»). */
  z.strictObject({
    kind: z.literal('free'),
    id: StableIdSchema,
    required: z.boolean(),
    minTokens: z.number().int().min(1).default(1),
    cues: z.array(z.string().min(1)).optional(),
  }),
  /** A Russian numeral word (1–100, compounds) or digits; `key` in branches is 'number'. */
  z.strictObject({ kind: z.literal('number'), id: StableIdSchema, required: z.boolean() }),
]);
export type Slot = z.infer<typeof SlotSchema>;

export const ExpectationSchema = z
  .strictObject({
    slots: z.array(SlotSchema).min(1).max(6),
    /** Whole-utterance paraphrases (natural text) accepted via the T27 scorer at ≥ 60 — the first one is the debrief's model answer and gets coach audio. */
    accept: z.array(z.string().min(1)).min(1),
    /** Which slot's matched option key drives `next.on`. Required when next has `on`. */
    branchOn: StableIdSchema.optional(),
    /** Confusables: forms that mean the answer was of the wrong type; `react` (optional) is a targeted line played instead of the generic confused line. */
    reject: z
      .array(
        z.strictObject({
          forms: z.array(z.string().min(1)).min(1),
          react: ScenarioLineSchema.optional(),
        }),
      )
      .max(4)
      .optional(),
    /**
     * Optional coach audio for `accept[0]` («hear how to say it» in the
     * debrief), rendered by `pipeline audio --player-audio` in the reserved
     * `player` character's voice (T57; the T26 `Choice.audio` precedent).
     * `accept[0]` is free text with no annotated sentence, so coach audio
     * carries a duration + mouth track but never word stamps.
     */
    coachAudio: LineAudioSchema.optional(),
  })
  .superRefine((expectation, ctx) => {
    const audio = expectation.coachAudio;
    if (audio === undefined) return;
    if (audio.timestamps !== undefined && audio.timestamps.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['coachAudio', 'timestamps'],
        message: 'coach audio speaks free text (accept[0]) and carries no word stamps',
      });
    }
    if (audio.mouth !== undefined) {
      const expected = Math.ceil(audio.durationMs / MOUTH_TRACK_STEP_MS);
      if (Math.abs(audio.mouth.length - expected) > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['coachAudio', 'mouth'],
          message: `mouth track has ${audio.mouth.length} steps but the audio lasts ${audio.durationMs}ms = ${expected} steps of ${MOUTH_TRACK_STEP_MS}ms (±1 allowed)`,
        });
      }
    }
  });
export type Expectation = z.infer<typeof ExpectationSchema>;

export const RetrySchema = z.strictObject({
  /** Miss #1: played, then the turn's last line (the prompt) replays. */
  confused: ScenarioLineSchema,
  /** Miss #2+: an in-character audio hint, then the prompt replays. */
  hint: ScenarioLineSchema,
  /** Miss #3+ (optional): a stronger hint, typically the model answer spoken by the host («Скажи, например: …»). */
  second: ScenarioLineSchema.optional(),
  /** The lifeline text (shown only after miss #2, on tap). */
  lifeline: LocalizedTextSchema,
});
export type Retry = z.infer<typeof RetrySchema>;

export const TurnNextSchema = z.union([
  /** Linear: the next turn's id. */
  StableIdSchema,
  /** Branch by the `branchOn` slot's matched option key (≤ 4 keys); `default` when no key matched. */
  z.strictObject({
    on: z.record(StableIdSchema, StableIdSchema),
    default: StableIdSchema,
  }),
]);
export type TurnNext = z.infer<typeof TurnNextSchema>;

export const ScenarioTurnSchema = z.strictObject({
  id: StableIdSchema,
  /** Who speaks — never 'player'. */
  speakerId: StableIdSchema,
  /** 1–3 lines said in a row; when `expect` is present the LAST line is the prompt that replays on retry. */
  say: z.array(ScenarioLineSchema).min(1).max(SCENARIO_MAX_LINES_PER_TURN),
  /** Absent ⇒ monologue turn (host talks, then `next`). */
  expect: ExpectationSchema.optional(),
  /** Required iff `expect` is present (enforced on the scenario). */
  retry: RetrySchema.optional(),
  next: TurnNextSchema.optional(),
  /** Exactly one of `next` | `endingId` (enforced on the scenario). */
  endingId: StableIdSchema.optional(),
});
export type ScenarioTurn = z.infer<typeof ScenarioTurnSchema>;

export const GlossaryEntrySchema = z.strictObject({
  id: StableIdSchema,
  /** Headword, ё preserved. */
  ru: z.string().min(1),
  /** The English the learner might say/ask. */
  en: z.string().min(1),
  /** Recognizable surface forms/globs of the RU headword (for «Что значит X?»). */
  forms: z.array(z.string().min(1)).min(1),
  /** Cyrillic renderings of `en` as the RU ASR tends to hear it (pipeline-generated + hand overrides). */
  translit: z.array(z.string().min(1)).min(1),
  /** Pre-rendered clips (host voice): «Живот — это stomach.» and «Stomach — по-русски «живот».» */
  explain: ScenarioLineSchema,
  howToSay: ScenarioLineSchema,
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;

export const NudgeKindSchema = z.enum(['silence', 'which-word', 'dont-know']);
export type NudgeKind = z.infer<typeof NudgeKindSchema>;
export const NUDGE_KINDS = NudgeKindSchema.options;

export const NudgeSchema = z.strictObject({
  kind: NudgeKindSchema,
  speakerId: StableIdSchema,
  line: ScenarioLineSchema,
});
export type Nudge = z.infer<typeof NudgeSchema>;

/** The raw (pre-refinement) scenario shape — what {@link scenarioLines} and the adapter accept. */
const ScenarioShape = z.strictObject({
  id: StableIdSchema,
  familyId: StableIdSchema,
  title: LocalizedTextSchema,
  level: CefrLevelSchema,
  language: z.enum(['ru', 'uk']).default('ru'),
  /** One-paragraph brief shown on the intro card (who you are, what you want) — the only text before the run. */
  brief: LocalizedTextSchema,
  /** ≥ one host + the player. */
  cast: z.array(ScenarioCharacterSchema).min(2),
  scene: ScenarioSceneSchema,
  startTurnId: StableIdSchema,
  turns: z.array(ScenarioTurnSchema).min(1).max(SCENARIO_MAX_TURNS),
  /** T25's Ending (title/recap/tone). */
  endings: z.array(EndingSchema).min(1),
  glossary: z.array(GlossaryEntrySchema).max(180), // 120 → 180 (T64, Mitch 2026-09-28)
  /**
   * Host-voiced service lines the engine needs at any turn — exactly one of each kind:
   * 'silence' («Ты здесь?» after 25 s of nothing), 'which-word' («Какое слово? Скажи ещё раз» when
   * «что значит…» finds nothing), 'dont-know' («Не знаю, извини. Спроси по-другому» when «как сказать…» finds nothing).
   */
  nudges: z.array(NudgeSchema).length(3),
});
type ScenarioInput = z.infer<typeof ScenarioShape>;

/** Every line kind a scenario can speak (= the T58 `scenario_line_audio.variant` set minus 'coach'). */
export type ScenarioLineKind =
  'say' | 'confused' | 'hint' | 'second' | 'react' | 'explain' | 'howtosay' | 'nudge';

export interface ScenarioLineRef {
  kind: ScenarioLineKind;
  line: ScenarioLine;
  /** Path of the line inside the scenario object (for path-precise issues). */
  path: (string | number)[];
  /** Who speaks it (glossary clips: the host). */
  speakerId: string;
}

/**
 * Every spoken line of a scenario with its object path and kind, in a fixed
 * order: turn say lines, retry lines, reject reactions (per turn, in
 * declaration order), then glossary explain/howToSay, then nudges. Shared by
 * the schema refinements, the pack-wide sentence-id check, the pipeline's
 * coverage report and T57's per-line renderer.
 */
export function scenarioLines(
  scenario: Pick<ScenarioInput, 'turns' | 'glossary' | 'nudges' | 'cast'>,
): ScenarioLineRef[] {
  const out: ScenarioLineRef[] = [];
  const host = scenario.cast.find((c) => c.role === 'host')?.id ?? '';
  scenario.turns.forEach((turn, ti) => {
    turn.say.forEach((line, li) => {
      out.push({ kind: 'say', line, path: ['turns', ti, 'say', li], speakerId: turn.speakerId });
    });
    if (turn.retry) {
      out.push({
        kind: 'confused',
        line: turn.retry.confused,
        path: ['turns', ti, 'retry', 'confused'],
        speakerId: turn.speakerId,
      });
      out.push({
        kind: 'hint',
        line: turn.retry.hint,
        path: ['turns', ti, 'retry', 'hint'],
        speakerId: turn.speakerId,
      });
      if (turn.retry.second) {
        out.push({
          kind: 'second',
          line: turn.retry.second,
          path: ['turns', ti, 'retry', 'second'],
          speakerId: turn.speakerId,
        });
      }
    }
    turn.expect?.reject?.forEach((group, ri) => {
      if (group.react) {
        out.push({
          kind: 'react',
          line: group.react,
          path: ['turns', ti, 'expect', 'reject', ri, 'react'],
          speakerId: turn.speakerId,
        });
      }
    });
  });
  scenario.glossary.forEach((entry, gi) => {
    out.push({
      kind: 'explain',
      line: entry.explain,
      path: ['glossary', gi, 'explain'],
      speakerId: host,
    });
    out.push({
      kind: 'howtosay',
      line: entry.howToSay,
      path: ['glossary', gi, 'howToSay'],
      speakerId: host,
    });
  });
  scenario.nudges.forEach((nudge, ni) => {
    out.push({
      kind: 'nudge',
      line: nudge.line,
      path: ['nudges', ni, 'line'],
      speakerId: nudge.speakerId,
    });
  });
  return out;
}

/**
 * THE graph adapter (ADR-0019 decision 1, SCENARIOS §2.2): a scenario's turns
 * as a dialogue graph so `analyzeDialogueGraph` runs unchanged. A linear
 * `next` is the node's `next`; a branching `next` becomes pseudo-choices —
 * one per `on` value plus the `default` — so every branch target is an edge
 * for the reachability and dead-trap checks; `endingId` passes through.
 */
export function scenarioGraphInput(
  scenario: Pick<ScenarioInput, 'turns' | 'startTurnId' | 'endings'>,
): DialogueGraphInput {
  return {
    nodes: scenario.turns.map((turn) => {
      if (typeof turn.next === 'string') return { id: turn.id, next: turn.next };
      if (turn.next !== undefined) {
        const targets = [...Object.values(turn.next.on), turn.next.default];
        return { id: turn.id, choices: targets.map((next) => ({ next })) };
      }
      return { id: turn.id, endingId: turn.endingId };
    }),
    startNodeId: scenario.startTurnId,
    endings: scenario.endings,
  };
}

/** The branch keys a slot exposes to `next.on`. */
export function slotBranchKeys(slot: Slot): string[] {
  switch (slot.kind) {
    case 'forms': {
      const keys = slot.options.map((o) => o.key);
      return slot.acceptsNumber ? [...keys, NUMBER_BRANCH_KEY] : keys;
    }
    case 'number':
      return [NUMBER_BRANCH_KEY];
    case 'free':
      return [];
  }
}

/** Letters, digits, spaces and in-word hyphens; a single trailing `*` glob. */
const FORM_RE = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*\*?$/u;

/**
 * Validate one slot form: NFC, free of punctuation, glob only as a trailing
 * `*`. Returns the issue message or null.
 */
export function slotFormIssue(form: string): string | null {
  if (form !== form.normalize('NFC')) return `form "${form}" must be UTF-8 NFC-normalized`;
  const stars = form.split('*').length - 1;
  if (stars > 1 || (stars === 1 && !form.endsWith('*'))) {
    return `form "${form}" — a glob is a single TRAILING "*" («голов*»)`;
  }
  if (!FORM_RE.test(form)) {
    return `form "${form}" must be letters/digits/spaces/hyphens only (no punctuation), optionally ending in "*"`;
  }
  return null;
}

/**
 * One blind speaking scenario. Invariants (SCENARIOS §2.2), all with
 * path-precise messages — T57/T58/T60 sessions debug against these:
 *
 * - cast ids unique; exactly one `role: 'host'`; the reserved `player` is
 *   present with `role: 'player'` (and only it has that role); every
 *   `speakerId` resolves and is never `player`;
 * - `expect` ⇔ `retry`; exactly one of `next` | `endingId`; `next.on` has
 *   ≤ 4 keys and requires `expect.branchOn`, whose slot must exist and be a
 *   `forms` or `number` slot (never `free`); every `on` key is one of that
 *   slot's branch keys (`number` for number slots and `acceptsNumber` forms);
 * - `startTurnId`, every `next` target (linear, `on`, `default`) and every
 *   `endingId` resolves; graph via {@link scenarioGraphInput}: no unreachable
 *   turn, no dead trap, no unreferenced ending;
 * - audio all-or-nothing PER SCENARIO across every line kind (turn lines,
 *   retry lines, reject reacts, glossary clips, nudges);
 * - glossary `id` and `ru` unique; `forms`/`translit` NFC; slot ids unique per
 *   expectation; option keys unique per slot; slot forms NFC, punctuation-free,
 *   trailing-`*` globs only; nudges exactly one per kind, speaking as a
 *   resolvable non-player character.
 */
export const ScenarioSchema = ScenarioShape.superRefine((scenario, ctx) => {
  // --- cast -----------------------------------------------------------
  const castIds = new Set<string>();
  let hosts = 0;
  scenario.cast.forEach((c, i) => {
    if (castIds.has(c.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['cast', i, 'id'],
        message: `duplicate cast id "${c.id}"`,
      });
    }
    castIds.add(c.id);
    if (c.role === 'host') hosts += 1;
    if (c.role === 'player' && c.id !== PLAYER_CHARACTER_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['cast', i, 'role'],
        message: `only the reserved "${PLAYER_CHARACTER_ID}" character may have role "player" (got "${c.id}")`,
      });
    }
    if (c.id === PLAYER_CHARACTER_ID && c.role !== 'player') {
      ctx.addIssue({
        code: 'custom',
        path: ['cast', i, 'role'],
        message: `the reserved "${PLAYER_CHARACTER_ID}" character must have role "player" (got "${c.role}")`,
      });
    }
  });
  if (hosts !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['cast'],
      message: `a scenario has exactly one character with role "host" (found ${hosts})`,
    });
  }
  if (!castIds.has(PLAYER_CHARACTER_ID)) {
    ctx.addIssue({
      code: 'custom',
      path: ['cast'],
      message: `the cast must include the reserved "${PLAYER_CHARACTER_ID}" character (role "player")`,
    });
  }
  const checkSpeaker = (speakerId: string, path: (string | number)[], what: string) => {
    if (!castIds.has(speakerId)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: `${what} speakerId "${speakerId}" does not resolve to a cast member`,
      });
    } else if (speakerId === PLAYER_CHARACTER_ID) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: `${what} speaks as "${PLAYER_CHARACTER_ID}" — the player never has scripted lines in a scenario`,
      });
    }
  };

  // --- endings / turns: id uniqueness ---------------------------------
  const endingIds = new Set<string>();
  scenario.endings.forEach((e, i) => {
    if (endingIds.has(e.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endings', i, 'id'],
        message: `duplicate ending id "${e.id}"`,
      });
    }
    endingIds.add(e.id);
  });
  const turnIds = new Set<string>();
  scenario.turns.forEach((t, i) => {
    if (turnIds.has(t.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['turns', i, 'id'],
        message: `duplicate turn id "${t.id}"`,
      });
    }
    turnIds.add(t.id);
  });

  // --- per-turn checks -------------------------------------------------
  let refsResolve = true;
  scenario.turns.forEach((turn, ti) => {
    const tp = ['turns', ti];
    checkSpeaker(turn.speakerId, [...tp, 'speakerId'], `turn "${turn.id}"`);

    if ((turn.expect === undefined) !== (turn.retry === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [...tp, turn.expect === undefined ? 'expect' : 'retry'],
        message:
          turn.expect === undefined
            ? `turn "${turn.id}" has "retry" but no "expect" — retry material belongs to a prompting turn`
            : `turn "${turn.id}" has "expect" but no "retry" — every prompting turn needs confused/hint/lifeline material`,
      });
    }

    const present = (['next', 'endingId'] as const).filter((k) => turn[k] !== undefined);
    if (present.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: tp,
        message:
          `turn "${turn.id}" must have exactly one of "next" or "endingId"` +
          (present.length === 0 ? ' (has none)' : ' (has both)'),
      });
    }

    // Expectation hygiene.
    const slotById = new Map<string, Slot>();
    if (turn.expect) {
      const ep = [...tp, 'expect'];
      turn.expect.slots.forEach((slot, si) => {
        const sp = [...ep, 'slots', si];
        if (slotById.has(slot.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [...sp, 'id'],
            message: `duplicate slot id "${slot.id}" in turn "${turn.id}"`,
          });
        }
        slotById.set(slot.id, slot);
        if (slot.kind === 'forms') {
          const keys = new Set<string>();
          slot.options.forEach((opt, oi) => {
            if (keys.has(opt.key)) {
              ctx.addIssue({
                code: 'custom',
                path: [...sp, 'options', oi, 'key'],
                message: `duplicate option key "${opt.key}" in slot "${slot.id}"`,
              });
            }
            keys.add(opt.key);
            if (slot.acceptsNumber && opt.key === NUMBER_BRANCH_KEY) {
              ctx.addIssue({
                code: 'custom',
                path: [...sp, 'options', oi, 'key'],
                message: `option key "${NUMBER_BRANCH_KEY}" is reserved for the numeral branch of a slot with acceptsNumber`,
              });
            }
            if (opt.lemma !== opt.lemma.normalize('NFC')) {
              ctx.addIssue({
                code: 'custom',
                path: [...sp, 'options', oi, 'lemma'],
                message: 'lemma must be UTF-8 NFC-normalized',
              });
            }
            opt.forms.forEach((form, fi) => {
              const issue = slotFormIssue(form);
              if (issue !== null) {
                ctx.addIssue({
                  code: 'custom',
                  path: [...sp, 'options', oi, 'forms', fi],
                  message: issue,
                });
              }
            });
          });
        }
        if (slot.kind === 'free') {
          slot.cues?.forEach((cue, ci) => {
            if (cue !== cue.normalize('NFC')) {
              ctx.addIssue({
                code: 'custom',
                path: [...sp, 'cues', ci],
                message: 'cue must be UTF-8 NFC-normalized',
              });
            }
          });
        }
      });
      turn.expect.accept.forEach((text, ai) => {
        if (text !== text.normalize('NFC')) {
          ctx.addIssue({
            code: 'custom',
            path: [...ep, 'accept', ai],
            message: 'accept text must be UTF-8 NFC-normalized',
          });
        }
      });
      turn.expect.reject?.forEach((group, ri) => {
        group.forms.forEach((form, fi) => {
          if (form !== form.normalize('NFC')) {
            ctx.addIssue({
              code: 'custom',
              path: [...ep, 'reject', ri, 'forms', fi],
              message: 'reject form must be UTF-8 NFC-normalized',
            });
          }
        });
      });
      if (turn.expect.branchOn !== undefined) {
        const slot = slotById.get(turn.expect.branchOn);
        if (slot === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [...ep, 'branchOn'],
            message: `branchOn "${turn.expect.branchOn}" is not a slot of turn "${turn.id}" (slots: ${[...slotById.keys()].join(', ')})`,
          });
        } else if (slot.kind === 'free') {
          ctx.addIssue({
            code: 'custom',
            path: [...ep, 'branchOn'],
            message: `branchOn "${slot.id}" is a free slot — only forms/number slots expose branch keys`,
          });
        }
      }
    }

    // Next / ending resolution + branch keys.
    if (typeof turn.next === 'string') {
      if (!turnIds.has(turn.next)) {
        refsResolve = false;
        ctx.addIssue({
          code: 'custom',
          path: [...tp, 'next'],
          message: `turn "${turn.id}" next "${turn.next}" does not resolve to a turn`,
        });
      }
    } else if (turn.next !== undefined) {
      const np = [...tp, 'next'];
      const keys = Object.keys(turn.next.on);
      if (keys.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [...np, 'on'],
          message: `turn "${turn.id}" next.on has no branch keys — use a plain next id for a linear turn`,
        });
      }
      if (keys.length > SCENARIO_MAX_BRANCHES) {
        ctx.addIssue({
          code: 'custom',
          path: [...np, 'on'],
          message: `turn "${turn.id}" branches on ${keys.length} keys — the maximum is ${SCENARIO_MAX_BRANCHES}`,
        });
      }
      const branchOn = turn.expect?.branchOn;
      if (turn.expect === undefined || branchOn === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [...np, 'on'],
          message: `turn "${turn.id}" branches with next.on but has no expect.branchOn naming the slot whose key drives the branch`,
        });
      } else {
        const slot = slotById.get(branchOn);
        if (slot !== undefined && slot.kind !== 'free') {
          const allowed = slotBranchKeys(slot);
          for (const key of keys) {
            if (!allowed.includes(key)) {
              ctx.addIssue({
                code: 'custom',
                path: [...np, 'on', key],
                message: `turn "${turn.id}" next.on key "${key}" is not a branch key of slot "${slot.id}" (allowed: ${allowed.join(', ')})`,
              });
            }
          }
        }
      }
      for (const [key, target] of Object.entries(turn.next.on)) {
        if (!turnIds.has(target)) {
          refsResolve = false;
          ctx.addIssue({
            code: 'custom',
            path: [...np, 'on', key],
            message: `turn "${turn.id}" next.on["${key}"] target "${target}" does not resolve to a turn`,
          });
        }
      }
      if (!turnIds.has(turn.next.default)) {
        refsResolve = false;
        ctx.addIssue({
          code: 'custom',
          path: [...np, 'default'],
          message: `turn "${turn.id}" next.default "${turn.next.default}" does not resolve to a turn`,
        });
      }
    }
    if (turn.endingId !== undefined && !endingIds.has(turn.endingId)) {
      refsResolve = false;
      ctx.addIssue({
        code: 'custom',
        path: [...tp, 'endingId'],
        message: `turn "${turn.id}" endingId "${turn.endingId}" does not resolve to an ending`,
      });
    }
  });
  if (!turnIds.has(scenario.startTurnId)) {
    refsResolve = false;
    ctx.addIssue({
      code: 'custom',
      path: ['startTurnId'],
      message: `startTurnId "${scenario.startTurnId}" does not resolve to a turn`,
    });
  }

  // --- graph properties (only when every reference resolves) -----------
  if (refsResolve) {
    const analysis = analyzeDialogueGraph(scenarioGraphInput(scenario));
    const indexOfTurn = new Map(scenario.turns.map((t, i) => [t.id, i]));
    for (const id of analysis.unreachable) {
      ctx.addIssue({
        code: 'custom',
        path: ['turns', indexOfTurn.get(id)!],
        message: `turn "${id}" is unreachable from startTurnId "${scenario.startTurnId}"`,
      });
    }
    for (const id of analysis.deadTraps) {
      ctx.addIssue({
        code: 'custom',
        path: ['turns', indexOfTurn.get(id)!],
        message: `turn "${id}" can never reach an ending (dead trap — every cycle needs an exit path to an ending)`,
      });
    }
    const indexOfEnding = new Map(scenario.endings.map((e, i) => [e.id, i]));
    for (const id of analysis.unreferencedEndings) {
      ctx.addIssue({
        code: 'custom',
        path: ['endings', indexOfEnding.get(id)!],
        message: `ending "${id}" is never referenced by any turn`,
      });
    }
  }

  // --- glossary --------------------------------------------------------
  const glossaryIds = new Set<string>();
  const glossaryRu = new Set<string>();
  scenario.glossary.forEach((entry, gi) => {
    const gp = ['glossary', gi];
    if (glossaryIds.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [...gp, 'id'],
        message: `duplicate glossary id "${entry.id}"`,
      });
    }
    glossaryIds.add(entry.id);
    if (entry.ru !== entry.ru.normalize('NFC')) {
      ctx.addIssue({
        code: 'custom',
        path: [...gp, 'ru'],
        message: 'headword must be UTF-8 NFC-normalized',
      });
    }
    const ruKey = entry.ru.normalize('NFC').toLowerCase();
    if (glossaryRu.has(ruKey)) {
      ctx.addIssue({
        code: 'custom',
        path: [...gp, 'ru'],
        message: `duplicate glossary headword "${entry.ru}"`,
      });
    }
    glossaryRu.add(ruKey);
    for (const field of ['forms', 'translit'] as const) {
      entry[field].forEach((s, si) => {
        if (s !== s.normalize('NFC')) {
          ctx.addIssue({
            code: 'custom',
            path: [...gp, field, si],
            message: `${field} entry must be UTF-8 NFC-normalized`,
          });
        }
      });
    }
  });

  // --- nudges: one of each kind, host-class speakers --------------------
  const seenKinds = new Set<string>();
  scenario.nudges.forEach((nudge, ni) => {
    if (seenKinds.has(nudge.kind)) {
      ctx.addIssue({
        code: 'custom',
        path: ['nudges', ni, 'kind'],
        message: `duplicate nudge kind "${nudge.kind}" — exactly one nudge per kind (${NUDGE_KINDS.join(', ')})`,
      });
    }
    seenKinds.add(nudge.kind);
    checkSpeaker(nudge.speakerId, ['nudges', ni, 'speakerId'], `nudge "${nudge.kind}"`);
  });
  for (const kind of NUDGE_KINDS) {
    if (!seenKinds.has(kind)) {
      ctx.addIssue({
        code: 'custom',
        path: ['nudges'],
        message: `missing nudge of kind "${kind}"`,
      });
    }
  }

  // --- audio all-or-nothing, per scenario, across every line kind --------
  const lines = scenarioLines(scenario);
  if (lines.some((l) => l.line.audio !== undefined)) {
    for (const ref of lines) {
      if (ref.line.audio === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [...ref.path, 'audio'],
          message: `scenario "${scenario.id}" ships audio but its ${ref.kind} line "${ref.line.sentence.id}" has none — every line needs audio once any line has it`,
        });
      }
    }
  }
});
export type Scenario = z.infer<typeof ScenarioSchema>;
