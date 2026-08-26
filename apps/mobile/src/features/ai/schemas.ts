import { z } from 'zod';

/**
 * Zod boundaries for everything AI (T16). The model's output is untrusted
 * input: every response is parsed through these schemas before any DB
 * write or render. These live app-side (not packages/schema) — the AI
 * contract is between the app and its prompts only; packs/pipeline never
 * see it. T18's assessment feature will add its own schemas here.
 */

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
const LevelSchema = z.enum(CEFR_LEVELS);

// --- OpenRouter envelope ----------------------------------------------------

/** The slice of an OpenRouter chat completion we actually consume. */
export const OpenRouterResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
  model: z.string().optional(),
});

export type OpenRouterResponse = z.infer<typeof OpenRouterResponseSchema>;

/** OpenRouter error body ({ error: { message } }) — parsed for status text only. */
export const OpenRouterErrorSchema = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
});

// --- Journal feedback -------------------------------------------------------

/** One correction the model made, with its teaching note. */
export const FeedbackChangeSchema = z.object({
  /** Exact snippet from the original entry (may be '' for pure insertions). */
  before: z.string().max(500),
  /** The corrected snippet (may be '' for pure deletions). */
  after: z.string().max(500),
  /** Short English explanation of the rule/why. */
  explanation: z.string().min(1).max(1000),
});

/** What the model must return for a journal-feedback request. */
export const JournalFeedbackSchema = z.object({
  /** The full corrected entry text. */
  corrected: z.string().min(1).max(40_000),
  changes: z.array(FeedbackChangeSchema).max(100),
  /** Overall comment — encouragement + the main pattern to work on. */
  summary: z.string().min(1).max(2000),
});

export type JournalFeedback = z.infer<typeof JournalFeedbackSchema>;

/**
 * What actually persists into `journal_entries.aiFeedback` (JSON string).
 * Carries the source text the feedback was computed against, so the diff
 * stays truthful even if the entry is edited afterwards.
 */
export const StoredFeedbackSchema = JournalFeedbackSchema.extend({
  v: z.literal(1),
  /** The entry text that was corrected. */
  sourceRu: z.string().min(1),
  model: z.string(),
  createdAt: z.number(),
});

export type StoredFeedback = z.infer<typeof StoredFeedbackSchema>;

/** Parse a stored aiFeedback column value; null = unreadable (re-request). */
export function parseStoredFeedback(raw: string | null): StoredFeedback | null {
  if (!raw) return null;
  try {
    const parsed = StoredFeedbackSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// --- Batch enrichment -------------------------------------------------------

/** The model's proposed fill-in for one flagged bank item. */
export const EnrichmentProposalSchema = z.object({
  /** Echoed bank item id — proposals with unknown ids are dropped. */
  id: z.string().min(1),
  /** Dictionary form (words only; omitted for phrases). */
  lemma: z.string().min(1).max(100).optional(),
  translation: z.string().min(1).max(300),
  /** Compact grammar note ("gen.pl.", "pf. of говорить"). */
  grammar: z.string().max(300).optional(),
  pos: z.string().max(40).optional(),
  level: LevelSchema.optional(),
});

export const EnrichmentResponseSchema = z.object({
  items: z.array(EnrichmentProposalSchema).max(100),
});

export type EnrichmentProposal = z.infer<typeof EnrichmentProposalSchema>;
export type EnrichmentResponse = z.infer<typeof EnrichmentResponseSchema>;

// --- CEFR assessment (T18) --------------------------------------------------

/** The four assessed skills. "speaking" is a proxy from pronunciation
 *  practice scores — there is no live conversational signal; the UI must
 *  label it as such (ticket's overstating-precision warning). */
export const ASSESSMENT_SKILLS = ['reading', 'listening', 'writing', 'speaking'] as const;
export type AssessmentSkill = (typeof ASSESSMENT_SKILLS)[number];

export const SkillEstimateSchema = z.object({
  level: LevelSchema,
  /** One-two sentences: what the evidence shows for this skill. */
  note: z.string().min(1).max(500),
});

/** What the model must return for an assessment request. */
export const AssessmentResponseSchema = z.object({
  skills: z.object({
    reading: SkillEstimateSchema,
    listening: SkillEstimateSchema,
    writing: SkillEstimateSchema,
    speaking: SkillEstimateSchema,
  }),
  /** 2–4 concrete focus recommendations, most important first. */
  recommendations: z.array(z.string().min(1).max(500)).min(2).max(4),
  /** Short overall picture in English. */
  summary: z.string().min(1).max(2000),
});

export type AssessmentResponse = z.infer<typeof AssessmentResponseSchema>;

/**
 * What persists into `assessments.payload` (JSON). Carries the aggregate
 * numbers the estimate was computed from, so a stored assessment stays
 * interpretable even after the underlying stats move on.
 */
export const StoredAssessmentSchema = AssessmentResponseSchema.extend({
  v: z.literal(1),
  model: z.string(),
  createdAt: z.number(),
  /** Snapshot of the bundled aggregate numbers (loose by design). */
  stats: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

export type StoredAssessment = z.infer<typeof StoredAssessmentSchema>;

/** Parse a stored assessments.payload value; null = unreadable (skip row). */
export function parseStoredAssessment(payload: unknown): StoredAssessment | null {
  const parsed = StoredAssessmentSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

// --- Import annotation (T29) ------------------------------------------------

/**
 * One token row the model returns for import annotation — the draft-table
 * contract (AUTHORING.md token-table columns) as JSON. Punctuation rows
 * carry `text` only; the app derives `isPunct` (no letters/digits — the
 * pipeline's rule) and spacing itself, so the model never authors either.
 * `uncertain` is the model-reported confidence signal (ticket item 6).
 */
export const AnnotateTokenSchema = z.object({
  text: z.string().min(1).max(100),
  lemma: z.string().min(1).max(100).optional(),
  translation: z.string().min(1).max(300).optional(),
  pos: z.string().min(1).max(40).optional(),
  grammar: z.string().min(1).max(300).optional(),
  level: LevelSchema.optional(),
  note: z.string().min(1).max(500).optional(),
  uncertain: z.boolean().optional(),
});
export type AnnotateToken = z.infer<typeof AnnotateTokenSchema>;

/** One annotated sentence: echoed uid + EN translation + the token rows. */
export const AnnotateSentenceSchema = z.object({
  /** Echoed sentence uid — results with unknown uids are dropped. */
  id: z.string().min(1).max(40),
  en: z.string().min(1).max(2000),
  tokens: z.array(AnnotateTokenSchema).min(1).max(300),
});
export type AnnotateSentence = z.infer<typeof AnnotateSentenceSchema>;

/** What the model must return for one import-annotation batch. */
export const ImportAnnotateResponseSchema = z.object({
  /** Overall CEFR difficulty estimate for this batch's sentences. */
  level: LevelSchema.optional(),
  sentences: z.array(AnnotateSentenceSchema).min(1).max(20),
});
export type ImportAnnotateResponse = z.infer<typeof ImportAnnotateResponseSchema>;

// --- Explain this -----------------------------------------------------------

/** Explain-this returns prose (markdown), not JSON — just bound it. */
export const ExplainResponseSchema = z.string().min(1).max(20_000);

// --- JSON extraction --------------------------------------------------------

/**
 * Models occasionally wrap JSON in ```json fences or add a lead-in line
 * despite instructions. Extract the outermost object tolerantly; the
 * result still has to survive the feature schema, so this can't smuggle
 * anything past validation.
 */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
