import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  EndingSchema,
  LocalizedTextSchema,
  ScenarioCharacterSchema,
  ScenarioSceneSchema,
  SlotSchema,
  TurnNextSchema,
  type Ending,
  type ScenarioCharacter,
  type ScenarioScene,
} from '@sumrak/schema';
import { z } from 'zod';

import { track } from '@/services/analytics';

import { newId } from '../ids';
import { normalizeRu } from '../normalize';
import {
  packs,
  scenarioAssets,
  scenarioAttempts,
  scenarioGlossary,
  scenarioLineAudio,
  scenarioLineStamps,
  scenarioRuns,
  scenarioTurns,
  scenarios,
  sentences,
  tokens,
} from '../schema';
import type { SumrakDB } from '../types';
import type { SentenceWithTokens } from './content';

/**
 * Scenarios repository (T58, SPEAKING_SCENARIOS §4.3): the read side T60's
 * judge/engine and T62's screens consume (installed scenarios grouped by
 * family, the full runtime graph with sentences + audio + mouth tracks
 * inline, glossary lookup, per-line stamps) and the run lifecycle over the
 * two user tables (`scenario_runs` / `scenario_attempts`). No screens
 * consume this yet.
 *
 * Every JSON column is a CONTRACT parsed here through the exported Zod
 * schemas — T60/T62 never re-parse. An unreadable value (a future shape,
 * a corrupt row) resolves to `null` and fires exactly one `app_error`
 * per row (the T52 word-profile pattern); it is never a crash.
 */

export type ScenarioRow = typeof scenarios.$inferSelect;
export type ScenarioTurnRow = typeof scenarioTurns.$inferSelect;
export type ScenarioGlossaryRow = typeof scenarioGlossary.$inferSelect;
export type ScenarioLineAudioRow = typeof scenarioLineAudio.$inferSelect;
export type ScenarioLineStampRow = typeof scenarioLineStamps.$inferSelect;
export type ScenarioAssetRow = typeof scenarioAssets.$inferSelect;
export type ScenarioRunRow = typeof scenarioRuns.$inferSelect;
export type ScenarioAttemptRow = typeof scenarioAttempts.$inferSelect;

// --- JSON contracts (exported: T60/T62 consume them) ---------------------

/**
 * THE `scenario_runs.pathJson` contract (§4.2). One step per turn visited,
 * in walk order — replayable: the engine re-walks `branchKey`s from
 * `startTurnId` to resume in place (T27's resume precedent). Counters are
 * per turn; `meta` counts meta-intent asks made during that turn.
 */
export const ScenarioRunStepSchema = z.strictObject({
  turnId: z.string().min(1),
  /** The branch key that LEFT this turn (absent on linear / ending turns and while the turn is open). */
  branchKey: z.string().min(1).optional(),
  misses: z.number().int().min(0),
  assisted: z.boolean(),
  skipped: z.boolean(),
  rescued: z.boolean(),
  meta: z.number().int().min(0),
});
export type ScenarioRunStep = z.infer<typeof ScenarioRunStepSchema>;

export const ScenarioRunPathSchema = z.strictObject({
  v: z.literal(1),
  steps: z.array(ScenarioRunStepSchema),
});
export type ScenarioRunPath = z.infer<typeof ScenarioRunPathSchema>;

/** `scenario_runs.statsJson` (§4.2) — written once at finish, from the attempts. */
export const ScenarioRunStatsSchema = z.strictObject({
  turns: z.number().int().min(0),
  cleanTurns: z.number().int().min(0),
  misses: z.number().int().min(0),
  lifelines: z.number().int().min(0),
  skips: z.number().int().min(0),
  metaAsks: z.number().int().min(0),
  rescues: z.number().int().min(0),
  /** Mean judge score over answer attempts (0–100), null when none. */
  avgScore: z.number().min(0).max(100).nullable(),
});
export type ScenarioRunStats = z.infer<typeof ScenarioRunStatsSchema>;

/** `scenario_attempts.detailJson` (§4.2): the judge's per-word view or the meta-intent resolution. */
export const AttemptDetailSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('answer'),
    target: z.string(),
    words: z.array(
      z.strictObject({
        display: z.string(),
        target: z.string(),
        heard: z.string().nullable(),
        matched: z.boolean(),
      }),
    ),
    score: z.number().min(0).max(100),
    /** Slot id → matched option key (null = slot not satisfied). */
    slots: z.record(z.string(), z.string().nullable()),
  }),
  z.strictObject({
    kind: z.literal('meta'),
    query: z.string(),
    /** Glossary entry id when resolved. */
    hit: z.string().nullable(),
    source: z.enum(['glossary', 'whisper', 'online', 'none']),
  }),
]);
export type AttemptDetail = z.infer<typeof AttemptDetailSchema>;

export const ScenarioAttemptKindSchema = z.enum(['answer', 'meta']);
export const AnswerOutcomeSchema = z.enum(['matched', 'rescued', 'miss', 'skipped']);
export const MetaOutcomeSchema = z.enum([
  'explain',
  'howtosay',
  'repeat',
  'slower',
  'dont-understand',
  'unknown',
]);
export type AnswerOutcome = z.infer<typeof AnswerOutcomeSchema>;
export type MetaOutcome = z.infer<typeof MetaOutcomeSchema>;

/** The turn's stored `retryJson`: retry lines by sentence id + the lifeline text. */
export const ScenarioRetryRuntimeSchema = z.strictObject({
  confused: z.string().min(1),
  hint: z.string().min(1),
  second: z.string().min(1).optional(),
  lifeline: LocalizedTextSchema,
});

/**
 * The turn's stored `expectJson`: the Expectation with reject reacts by
 * sentence id and the coach clip (T57 `coachAudio`) by its synthetic
 * sentence id `<turnId>:coach` (the audio row lives in scenario_line_audio,
 * variant 'coach'). Written out in full — not derived from the schema
 * package's ExpectationSchema — so the stored contract stays stable while
 * the authoring schema grows.
 */
export const ScenarioExpectRuntimeSchema = z.strictObject({
  slots: z.array(SlotSchema).min(1),
  accept: z.array(z.string().min(1)).min(1),
  branchOn: z.string().min(1).optional(),
  reject: z
    .array(
      z.strictObject({
        forms: z.array(z.string().min(1)).min(1),
        reactSentenceId: z.string().min(1).optional(),
      }),
    )
    .optional(),
  coachSentenceId: z.string().min(1).optional(),
});

/**
 * THE runtime turn (§4.1): the `scenario_turns` row with its JSON columns
 * parsed. `say` are sentence ids in order (the last is the prompt);
 * `expect` / `retry` are null for monologue turns; exactly one of `next` /
 * `endingId` is set.
 */
export const ScenarioTurnRuntimeSchema = z.strictObject({
  id: z.string().min(1),
  orderIdx: z.number().int(),
  speakerId: z.string().min(1),
  say: z.array(z.string().min(1)).min(1),
  expect: ScenarioExpectRuntimeSchema.nullable(),
  retry: ScenarioRetryRuntimeSchema.nullable(),
  next: TurnNextSchema.nullable(),
  endingId: z.string().min(1).nullable(),
});
export type ScenarioTurnRuntime = z.infer<typeof ScenarioTurnRuntimeSchema>;

const NudgeRefSchema = z.strictObject({
  kind: z.enum(['silence', 'which-word', 'dont-know']),
  speakerId: z.string().min(1),
  sentenceId: z.string().min(1),
});
export type NudgeRef = z.infer<typeof NudgeRefSchema>;

// --- read shapes -----------------------------------------------------------

export interface ScenarioRung {
  packId: string;
  id: string;
  familyId: string;
  titleRu: string;
  titleEn: string;
  level: ScenarioRow['level'];
  language: ScenarioRow['language'];
  briefRu: string;
  briefEn: string;
  packTitleRu: string;
  packTitleEn: string;
  turnCount: number;
  glossaryCount: number;
  /** Every line rendered AND staged (`localUri` set) — false ⇒ the run needs the speech-service fallback. */
  audioReady: boolean;
  runCount: number;
  lastRun: ScenarioRunRow | null;
  /** The finished run with the most clean turns (ties → newest); null when none finished. */
  bestStats: ScenarioRunStats | null;
}

export interface ScenarioFamily {
  familyId: string;
  /** Rungs ordered A1 → C1 (then by pack id). */
  rungs: ScenarioRung[];
}

export interface ScenarioGlossaryEntry {
  id: string;
  ru: string;
  ruNorm: string;
  en: string;
  forms: string[];
  translit: string[];
  explainSentenceId: string;
  howToSaySentenceId: string;
}

export interface ScenarioLineResolved {
  sentence: SentenceWithTokens | null;
  audio: ScenarioLineAudioRow | null;
}

export interface ScenarioDetail {
  scenario: Omit<ScenarioRow, 'castJson' | 'sceneJson' | 'endingsJson' | 'nudgesJson'>;
  cast: ScenarioCharacter[];
  scene: ScenarioScene | null;
  endings: Ending[];
  nudges: NudgeRef[];
  /** Declaration order; JSON parsed. A turn whose JSON is unreadable is dropped (and logged once). */
  turns: ScenarioTurnRuntime[];
  glossary: ScenarioGlossaryEntry[];
  /** Every line of the scenario by sentence id: annotated sentence + audio row (with `mouth`). */
  lines: Record<string, ScenarioLineResolved>;
  /** `scene/**` rows of the pack (art staged or not). */
  assets: ScenarioAssetRow[];
}

export interface ScenarioRunDebrief {
  run: ScenarioRunRow;
  path: ScenarioRunPath | null;
  stats: ScenarioRunStats | null;
  /** Walk order; each turn's attempts in attemptNo order with the detail parsed. */
  turns: {
    turnId: string;
    step: ScenarioRunStep;
    attempts: (ScenarioAttemptRow & { detail: AttemptDetail | null })[];
  }[];
}

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;

function parseJsonText(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function createScenariosRepo(db: SumrakDB) {
  const parseWarned = new Set<string>();

  /** Zod-on-read with the one-app_error-per-row rule; `null` on failure. */
  function parseWith<T>(schema: z.ZodType<T>, raw: unknown, key: string, scope: string): T | null {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    if (!parseWarned.has(key)) {
      parseWarned.add(key);
      track('app_error', { scope, fatal: false });
    }
    return null;
  }

  function turnRuntime(row: ScenarioTurnRow): ScenarioTurnRuntime | null {
    const key = `${row.packId}/${row.scenarioId}/${row.id}`;
    return parseWith(
      ScenarioTurnRuntimeSchema,
      {
        id: row.id,
        orderIdx: row.orderIdx,
        speakerId: row.speakerId,
        say: parseJsonText(row.sayJson),
        expect: parseJsonText(row.expectJson),
        retry: parseJsonText(row.retryJson),
        next: parseJsonText(row.nextJson),
        endingId: row.endingId,
      },
      key,
      'scenario-turn-parse',
    );
  }

  function glossaryEntry(row: ScenarioGlossaryRow): ScenarioGlossaryEntry | null {
    const key = `${row.packId}/${row.scenarioId}/gl/${row.id}`;
    const lists = parseWith(
      z.strictObject({ forms: z.array(z.string()), translit: z.array(z.string()) }),
      { forms: parseJsonText(row.formsJson), translit: parseJsonText(row.translitJson) },
      key,
      'scenario-glossary-parse',
    );
    if (!lists) return null;
    return {
      id: row.id,
      ru: row.ru,
      ruNorm: row.ruNorm,
      en: row.en,
      forms: lists.forms,
      translit: lists.translit,
      explainSentenceId: row.explainSentenceId,
      howToSaySentenceId: row.howToSaySentenceId,
    };
  }

  function runPath(run: ScenarioRunRow): ScenarioRunPath | null {
    return parseWith(
      ScenarioRunPathSchema,
      parseJsonText(run.pathJson),
      `run/${run.id}/path`,
      'scenario-run-path-parse',
    );
  }

  function runStats(run: ScenarioRunRow): ScenarioRunStats | null {
    if (run.statsJson === null) return null;
    return parseWith(
      ScenarioRunStatsSchema,
      parseJsonText(run.statsJson),
      `run/${run.id}/stats`,
      'scenario-run-stats-parse',
    );
  }

  function attemptDetail(row: ScenarioAttemptRow): AttemptDetail | null {
    return parseWith(
      AttemptDetailSchema,
      parseJsonText(row.detailJson),
      `attempt/${row.id}`,
      'scenario-attempt-parse',
    );
  }

  async function getRunOrThrow(runId: string): Promise<ScenarioRunRow> {
    const rows = await db.select().from(scenarioRuns).where(eq(scenarioRuns.id, runId)).limit(1);
    const run = rows[0];
    if (!run) throw new Error(`scenario run "${runId}" does not exist`);
    return run;
  }

  async function writePath(runId: string, path: ScenarioRunPath): Promise<ScenarioRunPath> {
    const validated = ScenarioRunPathSchema.parse(path);
    await db
      .update(scenarioRuns)
      .set({ pathJson: JSON.stringify(validated) })
      .where(eq(scenarioRuns.id, runId));
    return validated;
  }

  /** Stats from the attempts + path (§4.2 statsJson), computed at finish. */
  function computeStats(path: ScenarioRunPath, attempts: ScenarioAttemptRow[]): ScenarioRunStats {
    const answered = path.steps.filter((s) => s.turnId !== '');
    const scores: number[] = [];
    let rescues = 0;
    let metaAsks = 0;
    for (const a of attempts) {
      if (a.kind === 'meta') {
        metaAsks += 1;
        continue;
      }
      if (a.outcome === 'rescued') rescues += 1;
      const detail = attemptDetail(a);
      if (detail?.kind === 'answer') scores.push(detail.score);
    }
    return ScenarioRunStatsSchema.parse({
      turns: answered.length,
      cleanTurns: answered.filter((s) => s.misses === 0 && !s.assisted && !s.skipped && !s.rescued)
        .length,
      misses: answered.reduce((n, s) => n + s.misses, 0),
      lifelines: answered.filter((s) => s.assisted).length,
      skips: answered.filter((s) => s.skipped).length,
      metaAsks,
      rescues,
      avgScore:
        scores.length > 0
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : null,
    });
  }

  return {
    // --- content reads -------------------------------------------------

    /**
     * Installed scenarios grouped by family, rungs A1 → C1, each with its
     * run summary (`runCount`, `lastRun`, `bestStats`) — the hub's shape
     * (§9.1) and the Today card's input.
     */
    async listScenarios(): Promise<ScenarioFamily[]> {
      const rows = await db
        .select({ scenario: scenarios, packTitleEn: packs.titleEn, packTitleRu: packs.titleRu })
        .from(scenarios)
        .innerJoin(packs, eq(scenarios.packId, packs.id))
        .orderBy(asc(scenarios.familyId), asc(scenarios.packId), asc(scenarios.orderIdx));
      if (rows.length === 0) return [];

      const ids = [...new Set(rows.map((r) => r.scenario.id))];
      const packIds = [...new Set(rows.map((r) => r.scenario.packId))];
      const [turnCounts, audioCounts, runRows] = await Promise.all([
        db
          .select({
            packId: scenarioTurns.packId,
            scenarioId: scenarioTurns.scenarioId,
            n: sql<number>`COUNT(*)`,
          })
          .from(scenarioTurns)
          .where(inArray(scenarioTurns.packId, packIds))
          .groupBy(scenarioTurns.packId, scenarioTurns.scenarioId),
        db
          .select({
            packId: scenarioLineAudio.packId,
            scenarioId: scenarioLineAudio.scenarioId,
            n: sql<number>`COUNT(*)`,
            staged: sql<number>`SUM(CASE WHEN ${scenarioLineAudio.localUri} IS NULL THEN 0 ELSE 1 END)`,
          })
          .from(scenarioLineAudio)
          .where(inArray(scenarioLineAudio.packId, packIds))
          .groupBy(scenarioLineAudio.packId, scenarioLineAudio.scenarioId),
        db
          .select()
          .from(scenarioRuns)
          .where(inArray(scenarioRuns.scenarioId, ids))
          .orderBy(desc(scenarioRuns.startedAt)),
      ]);
      // Line counts per scenario (audio is all-or-nothing per scenario, so
      // "ready" = every sentence of the scenario has a staged audio row).
      const lineCounts = await db
        .select({
          packId: sentences.packId,
          scenarioId: sentences.storyId,
          n: sql<number>`COUNT(*)`,
        })
        .from(sentences)
        .where(and(inArray(sentences.packId, packIds), inArray(sentences.storyId, ids)))
        .groupBy(sentences.packId, sentences.storyId);

      const key = (packId: string, id: string) => `${packId} ${id}`;
      const turnsByKey = new Map(turnCounts.map((r) => [key(r.packId, r.scenarioId), r.n]));
      const linesByKey = new Map(lineCounts.map((r) => [key(r.packId, r.scenarioId), r.n]));
      const audioByKey = new Map(
        audioCounts.map((r) => [key(r.packId, r.scenarioId), { n: r.n, staged: r.staged ?? 0 }]),
      );
      const runsById = new Map<string, ScenarioRunRow[]>();
      for (const run of runRows) {
        const list = runsById.get(run.scenarioId);
        if (list) list.push(run);
        else runsById.set(run.scenarioId, [run]);
      }

      const families = new Map<string, ScenarioRung[]>();
      for (const { scenario, packTitleEn, packTitleRu } of rows) {
        const k = key(scenario.packId, scenario.id);
        const runs = runsById.get(scenario.id) ?? [];
        let best: ScenarioRunStats | null = null;
        for (const run of runs) {
          if (run.finishedAt === null) continue;
          const stats = runStats(run);
          if (stats && (best === null || stats.cleanTurns > best.cleanTurns)) best = stats;
        }
        const audio = audioByKey.get(k);
        const lines = linesByKey.get(k) ?? 0;
        const rung: ScenarioRung = {
          packId: scenario.packId,
          id: scenario.id,
          familyId: scenario.familyId,
          titleRu: scenario.titleRu,
          titleEn: scenario.titleEn,
          level: scenario.level,
          language: scenario.language,
          briefRu: scenario.briefRu,
          briefEn: scenario.briefEn,
          packTitleRu,
          packTitleEn,
          turnCount: turnsByKey.get(k) ?? 0,
          glossaryCount: scenario.glossaryCount,
          audioReady: !!audio && lines > 0 && audio.n >= lines && audio.staged >= lines,
          runCount: runs.length,
          lastRun: runs[0] ?? null,
          bestStats: best,
        };
        const list = families.get(scenario.familyId);
        if (list) list.push(rung);
        else families.set(scenario.familyId, [rung]);
      }
      return [...families.entries()].map(([familyId, rungs]) => ({
        familyId,
        rungs: rungs.sort(
          (a, b) =>
            LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
            a.packId.localeCompare(b.packId),
        ),
      }));
    },

    /**
     * The full runtime object the engine walks: cast/scene/endings/nudges
     * parsed, turns parsed, glossary, every line's sentence + tokens + audio
     * row (mouth included), and the pack's scene assets. Null-safe on
     * sentences by convention, though a consistent import always resolves.
     */
    async getScenario(packId: string, id: string): Promise<ScenarioDetail | null> {
      const rows = await db
        .select()
        .from(scenarios)
        .where(and(eq(scenarios.packId, packId), eq(scenarios.id, id)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;

      const [turnRows, glossaryRows, audioRows, sentenceRows, tokenRows, assetRows] =
        await Promise.all([
          db
            .select()
            .from(scenarioTurns)
            .where(and(eq(scenarioTurns.packId, packId), eq(scenarioTurns.scenarioId, id)))
            .orderBy(asc(scenarioTurns.orderIdx)),
          db
            .select()
            .from(scenarioGlossary)
            .where(and(eq(scenarioGlossary.packId, packId), eq(scenarioGlossary.scenarioId, id)))
            .orderBy(asc(scenarioGlossary.ruNorm)),
          db
            .select()
            .from(scenarioLineAudio)
            .where(and(eq(scenarioLineAudio.packId, packId), eq(scenarioLineAudio.scenarioId, id))),
          db
            .select()
            .from(sentences)
            .where(and(eq(sentences.packId, packId), eq(sentences.storyId, id)))
            .orderBy(asc(sentences.orderIdx)),
          db
            .select()
            .from(tokens)
            .where(and(eq(tokens.packId, packId), eq(tokens.storyId, id)))
            .orderBy(asc(tokens.sentenceId), asc(tokens.tokenIndex)),
          db.select().from(scenarioAssets).where(eq(scenarioAssets.packId, packId)),
        ]);

      const tokensBySentence = new Map<string, typeof tokenRows>();
      for (const tok of tokenRows) {
        const list = tokensBySentence.get(tok.sentenceId);
        if (list) list.push(tok);
        else tokensBySentence.set(tok.sentenceId, [tok]);
      }
      const audioBySentence = new Map(audioRows.map((a) => [a.sentenceId, a]));
      const lines: Record<string, ScenarioLineResolved> = {};
      for (const s of sentenceRows) {
        lines[s.id] = {
          sentence: { ...s, tokens: tokensBySentence.get(s.id) ?? [] },
          audio: audioBySentence.get(s.id) ?? null,
        };
      }
      // Audio rows whose sentence vanished still surface (null sentence).
      for (const a of audioRows) {
        if (!lines[a.sentenceId]) lines[a.sentenceId] = { sentence: null, audio: a };
      }

      const rowKey = `${packId}/${id}`;
      const { castJson, sceneJson, endingsJson, nudgesJson, ...scenario } = row;
      return {
        scenario,
        cast:
          parseWith(
            z.array(ScenarioCharacterSchema),
            parseJsonText(castJson),
            `${rowKey}/cast`,
            'scenario-cast-parse',
          ) ?? [],
        scene: parseWith(
          ScenarioSceneSchema,
          parseJsonText(sceneJson),
          `${rowKey}/scene`,
          'scenario-scene-parse',
        ),
        endings:
          parseWith(
            z.array(EndingSchema),
            parseJsonText(endingsJson),
            `${rowKey}/endings`,
            'scenario-endings-parse',
          ) ?? [],
        nudges:
          parseWith(
            z.array(NudgeRefSchema),
            parseJsonText(nudgesJson),
            `${rowKey}/nudges`,
            'scenario-nudges-parse',
          ) ?? [],
        turns: turnRows.map(turnRuntime).filter((t): t is ScenarioTurnRuntime => t !== null),
        glossary: glossaryRows
          .map(glossaryEntry)
          .filter((g): g is ScenarioGlossaryEntry => g !== null),
        lines,
        assets: assetRows,
      };
    },

    /** Karaoke / mouth-sync stamps for one scenario line. */
    async getStampsForSentence(
      packId: string,
      sentenceId: string,
    ): Promise<ScenarioLineStampRow[]> {
      return db
        .select()
        .from(scenarioLineStamps)
        .where(
          and(eq(scenarioLineStamps.packId, packId), eq(scenarioLineStamps.sentenceId, sentenceId)),
        )
        .orderBy(asc(scenarioLineStamps.stampIndex));
    },

    /**
     * «Что значит X?» lookup: the query (a headword or any surface form the
     * ASR heard) matched ё/е-tolerantly against `ruNorm` first, then against
     * each entry's `forms` (trailing `*` = stem glob). First hit wins; null
     * when nothing matches (⇒ the which-word nudge).
     */
    async findGlossary(
      scenarioId: string,
      ruNormOrForm: string,
      packId?: string,
    ): Promise<ScenarioGlossaryEntry | null> {
      const q = normalizeRu(ruNormOrForm).trim();
      if (!q) return null;
      const scope = packId
        ? and(eq(scenarioGlossary.packId, packId), eq(scenarioGlossary.scenarioId, scenarioId))
        : eq(scenarioGlossary.scenarioId, scenarioId);
      const exact = await db
        .select()
        .from(scenarioGlossary)
        .where(and(scope, eq(scenarioGlossary.ruNorm, q)))
        .limit(1);
      if (exact[0]) return glossaryEntry(exact[0]);
      const all = await db.select().from(scenarioGlossary).where(scope);
      for (const row of all) {
        const entry = glossaryEntry(row);
        if (!entry) continue;
        for (const form of entry.forms) {
          const f = normalizeRu(form);
          const hit = f.endsWith('*') ? q.startsWith(f.slice(0, -1)) : q === f;
          if (hit) return entry;
        }
      }
      return null;
    },

    /** All scenario audio rows of a pack (sync's Wi-Fi backfill walks this). */
    async listAudioForPack(packId: string): Promise<ScenarioLineAudioRow[]> {
      return db.select().from(scenarioLineAudio).where(eq(scenarioLineAudio.packId, packId));
    },

    /** Record where a staged scenario audio file landed (sync backfill). */
    async setAudioLocalUri(packId: string, file: string, localUri: string): Promise<void> {
      await db
        .update(scenarioLineAudio)
        .set({ localUri })
        .where(and(eq(scenarioLineAudio.packId, packId), eq(scenarioLineAudio.file, file)));
    },

    /** All `scene/**` rows of a pack (sync's backfill walks this too). */
    async listAssetsForPack(packId: string): Promise<ScenarioAssetRow[]> {
      return db.select().from(scenarioAssets).where(eq(scenarioAssets.packId, packId));
    },

    /** Record where a staged scene layer landed (upsert: sync may learn of a file after import). */
    async setAssetLocalUri(
      packId: string,
      file: string,
      localUri: string,
      bytes?: number | null,
    ): Promise<void> {
      await db
        .insert(scenarioAssets)
        .values({ packId, file, localUri, bytes: bytes ?? null })
        .onConflictDoUpdate({
          target: [scenarioAssets.packId, scenarioAssets.file],
          set: { localUri, ...(bytes !== undefined ? { bytes } : {}) },
        });
    },

    // --- run lifecycle (user tables) -------------------------------------

    /** Start a run at the scenario's start turn (one open step). */
    async startRun(input: {
      packId: string;
      scenarioId: string;
      familyId: string;
      level: string;
      startTurnId: string;
      gameSessionId?: string | null;
    }): Promise<ScenarioRunRow> {
      const path = ScenarioRunPathSchema.parse({
        v: 1,
        steps: [
          {
            turnId: input.startTurnId,
            misses: 0,
            assisted: false,
            skipped: false,
            rescued: false,
            meta: 0,
          },
        ],
      });
      const row: ScenarioRunRow = {
        id: newId(),
        packId: input.packId,
        scenarioId: input.scenarioId,
        familyId: input.familyId,
        level: input.level,
        startedAt: Date.now(),
        finishedAt: null,
        endingId: null,
        pathJson: JSON.stringify(path),
        statsJson: null,
        pinned: false,
        mediaLocal: true,
        mediaBundleState: null,
        mediaBundleName: null,
        gameSessionId: input.gameSessionId ?? null,
      };
      await db.insert(scenarioRuns).values(row);
      return row;
    },

    /**
     * Record a walk step: the counters of the turn being LEFT are merged
     * onto the last step (with the branch key taken), and the turn arrived
     * at is appended as a fresh open step. Zod-validated both ways.
     */
    async recordStep(
      runId: string,
      step: {
        /** Counters of the turn being left (merged onto the current last step). */
        leaving?: Partial<Omit<ScenarioRunStep, 'turnId'>>;
        /** The turn arrived at; absent when the turn just ended the run. */
        nextTurnId?: string;
      },
    ): Promise<ScenarioRunPath> {
      const run = await getRunOrThrow(runId);
      if (run.finishedAt !== null) throw new Error(`scenario run "${runId}" is already finished`);
      const path = runPath(run);
      if (!path) throw new Error(`scenario run "${runId}" has an unreadable path`);
      const last = path.steps[path.steps.length - 1];
      if (last && step.leaving)
        Object.assign(last, ScenarioRunStepSchema.partial().parse(step.leaving));
      if (step.nextTurnId !== undefined) {
        path.steps.push({
          turnId: step.nextTurnId,
          misses: 0,
          assisted: false,
          skipped: false,
          rescued: false,
          meta: 0,
        });
      }
      return writePath(runId, path);
    },

    /** Append one attempt (answer or meta) to an open run; `attemptNo` is assigned per turn. */
    async recordAttempt(input: {
      runId: string;
      turnId: string;
      kind: 'answer' | 'meta';
      outcome: AnswerOutcome | MetaOutcome;
      transcript: string;
      detail: AttemptDetail;
      audioFile?: string | null;
      audioDurationMs?: number | null;
    }): Promise<ScenarioAttemptRow> {
      const run = await getRunOrThrow(input.runId);
      if (run.finishedAt !== null) {
        throw new Error(`scenario run "${input.runId}" is already finished`);
      }
      if (input.kind === 'answer') AnswerOutcomeSchema.parse(input.outcome);
      else MetaOutcomeSchema.parse(input.outcome);
      const detail = AttemptDetailSchema.parse(input.detail);
      if (detail.kind !== input.kind) throw new Error('attempt detail kind mismatch');
      const prior = await db
        .select({ n: sql<number>`COALESCE(MAX(${scenarioAttempts.attemptNo}), 0)` })
        .from(scenarioAttempts)
        .where(
          and(eq(scenarioAttempts.runId, input.runId), eq(scenarioAttempts.turnId, input.turnId)),
        );
      const row: ScenarioAttemptRow = {
        id: newId(),
        runId: input.runId,
        turnId: input.turnId,
        attemptNo: (prior[0]?.n ?? 0) + 1,
        kind: input.kind,
        outcome: input.outcome,
        transcript: input.transcript,
        detailJson: JSON.stringify(detail),
        audioFile: input.audioFile ?? null,
        audioDurationMs: input.audioDurationMs ?? null,
        createdAt: Date.now(),
      };
      await db.insert(scenarioAttempts).values(row);
      return row;
    },

    /**
     * Finish a run: stamps finishedAt/endingId, computes statsJson from the
     * path + attempts, and reports whether this ending is new for the
     * scenario (first finished run with it).
     */
    async finishRun(
      runId: string,
      opts: { endingId: string },
    ): Promise<{ run: ScenarioRunRow; stats: ScenarioRunStats; newEnding: boolean }> {
      const run = await getRunOrThrow(runId);
      if (run.finishedAt !== null) throw new Error(`scenario run "${runId}" is already finished`);
      const path = runPath(run) ?? { v: 1 as const, steps: [] };
      const attempts = await db
        .select()
        .from(scenarioAttempts)
        .where(eq(scenarioAttempts.runId, runId));
      const stats = computeStats(path, attempts);
      const seen = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(scenarioRuns)
        .where(
          and(
            eq(scenarioRuns.scenarioId, run.scenarioId),
            eq(scenarioRuns.endingId, opts.endingId),
            sql`${scenarioRuns.finishedAt} IS NOT NULL`,
          ),
        );
      const newEnding = (seen[0]?.n ?? 0) === 0;
      const finishedAt = Date.now();
      const statsJson = JSON.stringify(stats);
      await db
        .update(scenarioRuns)
        .set({ finishedAt, endingId: opts.endingId, statsJson })
        .where(eq(scenarioRuns.id, runId));
      return { run: { ...run, finishedAt, endingId: opts.endingId, statsJson }, stats, newEnding };
    },

    /** Newest unfinished run of a scenario whose path parses (⇒ resumable in place), else null. */
    async findResumableRun(scenarioId: string): Promise<ScenarioRunRow | null> {
      const rows = await db
        .select()
        .from(scenarioRuns)
        .where(and(eq(scenarioRuns.scenarioId, scenarioId), isNull(scenarioRuns.finishedAt)))
        .orderBy(desc(scenarioRuns.startedAt))
        .limit(5);
      for (const run of rows) {
        const path = runPath(run);
        if (path && path.steps.length > 0) return run;
      }
      return null;
    },

    async getRun(runId: string): Promise<ScenarioRunRow | null> {
      const rows = await db.select().from(scenarioRuns).where(eq(scenarioRuns.id, runId)).limit(1);
      return rows[0] ?? null;
    },

    /** Parse a run's path / stats (the Zod boundary for anything reading the columns). */
    parseRunPath: runPath,
    parseRunStats: runStats,

    /** Runs of one scenario (or all), newest first, paged. */
    async listRuns(
      scenarioId?: string,
      opts: { limit?: number; offset?: number } = {},
    ): Promise<ScenarioRunRow[]> {
      const base = db.select().from(scenarioRuns);
      const query = scenarioId ? base.where(eq(scenarioRuns.scenarioId, scenarioId)) : base;
      return query
        .orderBy(desc(scenarioRuns.startedAt))
        .limit(opts.limit ?? 50)
        .offset(opts.offset ?? 0);
    },

    /** Turns × attempts of one run, walk order, details parsed — the debrief's input (§10.2). */
    async getRunDebrief(runId: string): Promise<ScenarioRunDebrief | null> {
      const rows = await db.select().from(scenarioRuns).where(eq(scenarioRuns.id, runId)).limit(1);
      const run = rows[0];
      if (!run) return null;
      const attempts = await db
        .select()
        .from(scenarioAttempts)
        .where(eq(scenarioAttempts.runId, runId))
        .orderBy(asc(scenarioAttempts.createdAt), asc(scenarioAttempts.attemptNo));
      const path = runPath(run);
      const byTurn = new Map<string, ScenarioRunDebrief['turns'][number]['attempts']>();
      for (const a of attempts) {
        const list = byTurn.get(a.turnId) ?? [];
        list.push({ ...a, detail: attemptDetail(a) });
        byTurn.set(a.turnId, list);
      }
      return {
        run,
        path,
        stats: runStats(run),
        turns: (path?.steps ?? []).map((step) => ({
          turnId: step.turnId,
          step,
          attempts: byTurn.get(step.turnId) ?? [],
        })),
      };
    },

    async setPinned(runId: string, pinned: boolean): Promise<void> {
      await db.update(scenarioRuns).set({ pinned }).where(eq(scenarioRuns.id, runId));
    },

    /** Prune bookkeeping (T63): recordings gone locally; attempts lose their file refs. */
    async markMediaPruned(runIds: string[]): Promise<void> {
      if (runIds.length === 0) return;
      await db
        .update(scenarioRuns)
        .set({ mediaLocal: false })
        .where(inArray(scenarioRuns.id, runIds));
      await db
        .update(scenarioAttempts)
        .set({ audioFile: null })
        .where(inArray(scenarioAttempts.runId, runIds));
    },

    async setMediaBundle(
      runId: string,
      state: 'pending' | 'uploaded' | 'failed' | null,
      name: string | null,
    ): Promise<void> {
      await db
        .update(scenarioRuns)
        .set({ mediaBundleState: state, mediaBundleName: name })
        .where(eq(scenarioRuns.id, runId));
    },
  };
}

export type ScenariosRepo = ReturnType<typeof createScenariosRepo>;
