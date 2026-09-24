import { z } from 'zod';

/**
 * The word-profile contract (M16/T52, WORD_FORMS §5.1, ADR-0018 decision 1):
 * the JSON one generation returns and the shape `word_profiles.payload`
 * stores. App-local like the other AI contracts (T16). The model's output
 * is untrusted input (§1.2): this Zod parse is the first gate, the
 * structural validator in `profile-core.ts` (§5.2) is the second — both run
 * before anything is stored, and again (safeParse) on every read.
 */

/** The combining acute accent U+0301 — the stress mark, placed after the stressed vowel. */
export const STRESS = '́';

const Ru = z.string().min(1).max(120); // forms: NFC enforced in the validator
const RuLong = z.string().min(1).max(240); // example sentences (may contain digits/Latin/punctuation)

export const CellSchema = z
  .object({
    /** With stress marks (U+0301 after the stressed vowel). Several forms may be joined with " / ". */
    ru: Ru,
    /** ru with every U+0301 removed — must match exactly. */
    plain: Ru,
    gloss: z.string().max(80).optional(),
    note: z.string().max(200).optional(),
  })
  .nullable();

export const RowSchema = z.object({
  ru: Ru,
  plain: Ru,
  gloss: z.string().min(1).max(80),
  note: z.string().max(240).optional(),
  tags: z.array(z.string().max(24)).max(6).optional(),
  example: z.object({ ru: RuLong, en: z.string().max(240) }).optional(),
});

export const SectionSchema = z.object({
  /** Catalog ids (`usage`, `verb-nonpast`, …) or model-added `x-…` ids. */
  id: z.string().regex(/^(?:[a-z]+(?:-[a-z-]+)?|x-[a-z-]+)$/),
  title: z.object({ en: z.string().min(1).max(60), ru: z.string().min(1).max(60) }),
  layout: z.enum(['grid', 'list']),
  grid: z
    .object({
      rowLabels: z.array(z.string().min(1)).min(1).max(12),
      colLabels: z.array(z.string().min(1)).min(1).max(6),
      cells: z.array(z.array(CellSchema)),
    })
    .optional(),
  rows: z.array(RowSchema).max(20).optional(),
  note: z.string().max(400).optional(),
});

export const PROFILE_POS = [
  'verb',
  'noun',
  'adj',
  'adv',
  'pron',
  'num',
  'prep',
  'conj',
  'part',
  'name',
  'phrase',
  'other',
] as const;

export const WordProfileSchema = z.object({
  v: z.literal(1),
  language: z.enum(['ru', 'uk']),
  kind: z.enum(['word', 'phrase']),
  pos: z.enum(PROFILE_POS),
  headword: z.object({ ru: Ru, plain: Ru }),
  overview: z.object({
    gloss: z.string().min(1).max(120),
    // aspect / partner / conjugation class / stress pattern / gender / animacy / declension / register…
    facts: z.array(z.object({ label: z.string().max(32), value: z.string().max(120) })).max(10),
    notes: z.array(z.string().max(300)).max(6),
  }),
  sections: z.array(SectionSchema).min(1).max(14),
});

export type WordProfile = z.infer<typeof WordProfileSchema>;
export type ProfileSection = z.infer<typeof SectionSchema>;
export type ProfileRow = z.infer<typeof RowSchema>;
export type ProfileCell = z.infer<typeof CellSchema>;
export type ProfilePos = WordProfile['pos'];
export type ProfileLanguage = WordProfile['language'];
