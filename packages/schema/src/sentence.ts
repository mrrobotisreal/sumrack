import { z } from 'zod';
import { CefrLevelSchema, StableIdSchema } from './common';

/**
 * Sentence primitives (design §4.2 `Token`/`Sentence`/`WordStamp`), shared by
 * story content and dialogue content (T25). Split out of `pack.ts` so the
 * dialogue schemas can reuse them without a circular import; the public API
 * (via `index.ts`) is unchanged.
 */

/**
 * One surface word (or punctuation mark) of a sentence (design §4.2 `Token`).
 *
 * Punctuation-flag decision (T02): punctuation is its own token with
 * `isPunct: true`, and punctuation tokens must not carry linguistic
 * annotations (lemma/translation/pos/grammar/level). Word tokens leave
 * `isPunct` unset. This keeps `tokens` a faithful, ordered decomposition of
 * the sentence — `reconstructSentenceRu(tokens)` must reproduce
 * `Sentence.ru` exactly, which the Sentence schema enforces.
 */
export const TokenSchema = z
  .strictObject({
    /** Surface form exactly as it appears in the sentence (NFC, ё preserved). */
    text: z.string().min(1),
    /**
     * Punctuation flag: `true` marks this token as punctuation («, », —, ., …).
     * Punctuation tokens carry no linguistic annotations. Absent = word token.
     */
    isPunct: z.boolean().optional(),
    /**
     * Whether a single space precedes this token when reconstructing the
     * sentence. Defaults: `false` for the first token and for punctuation,
     * `true` for word tokens. Override for cases like an opening « (space
     * before it: `true`) and the word right after it (`false`).
     */
    spaceBefore: z.boolean().optional(),
    /** Dictionary form (absent for punctuation and some proper names). */
    lemma: z.string().min(1).optional(),
    /** Context-appropriate English gloss of this occurrence. */
    translation: z.string().min(1).optional(),
    /** Part of speech: noun/verb/adj/adv/pron/prep/conj/part/num/name/... */
    pos: z.string().min(1).optional(),
    /** Compact grammar notes: "gen.pl.", "pf. of говорить", "1sg. pres.", ... */
    grammar: z.string().min(1).optional(),
    /** CEFR tag of the LEMMA (not the surface form) — drives the progress model. */
    level: CefrLevelSchema.optional(),
    /** Idiom or culture note, shown in the word popup when present. */
    note: z.string().min(1).optional(),
  })
  .superRefine((tok, ctx) => {
    if (tok.text !== tok.text.normalize('NFC')) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'token text must be UTF-8 NFC-normalized',
      });
    }
    if (tok.isPunct) {
      for (const field of ['lemma', 'translation', 'pos', 'grammar', 'level'] as const) {
        if (tok[field] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `punctuation token "${tok.text}" must not carry "${field}"`,
          });
        }
      }
    }
  });
export type Token = z.infer<typeof TokenSchema>;

/**
 * Rebuild the Russian sentence text from its tokens using the `spaceBefore`
 * defaults documented on {@link TokenSchema}. The Sentence schema requires
 * this to equal `Sentence.ru` exactly, so token annotations can never drift
 * from the sentence they annotate.
 */
export function reconstructSentenceRu(tokens: readonly Token[]): string {
  let out = '';
  tokens.forEach((tok, i) => {
    const space = tok.spaceBefore ?? (i > 0 && !tok.isPunct);
    out += (space ? ' ' : '') + tok.text;
  });
  return out;
}

/**
 * One sentence of a story (design §4.2 `Sentence`): the Russian text, its
 * natural English translation (for the reader's reveal), and its tokens.
 * Dialogue nodes and choices (T25) carry the same structure verbatim, so
 * every dialogue line is tap-word explorable and feeds the progress model
 * exactly like story sentences.
 */
export const SentenceSchema = z
  .strictObject({
    /** Stable id, unique across the whole pack (user data references it). */
    id: StableIdSchema,
    /** Full sentence text, Russian, NFC, ё preserved. */
    ru: z.string().min(1),
    /** Natural English translation (for the sentence-reveal toggle). */
    en: z.string().min(1),
    /** Ordered decomposition of `ru` — words and punctuation. */
    tokens: z.array(TokenSchema).min(1),
    /** Grammar topics exercised: "past-tense", "genitive-plural", ... Feeds grammar coverage. */
    grammarTopics: z.array(z.string().min(1)).optional(),
  })
  .superRefine((sentence, ctx) => {
    if (sentence.ru !== sentence.ru.normalize('NFC')) {
      ctx.addIssue({
        code: 'custom',
        path: ['ru'],
        message: 'sentence text must be UTF-8 NFC-normalized',
      });
    }
    const rebuilt = reconstructSentenceRu(sentence.tokens);
    if (rebuilt !== sentence.ru) {
      ctx.addIssue({
        code: 'custom',
        path: ['tokens'],
        message: `tokens do not reconstruct the sentence: expected "${sentence.ru}", got "${rebuilt}"`,
      });
    }
  });
export type Sentence = z.infer<typeof SentenceSchema>;

/**
 * A word-level timestamp on an audio track (design §4.2 `WordStamp`), driving
 * karaoke highlighting: token `tokenIndex` of sentence `sentenceId` is being
 * spoken during [startMs, endMs). Kept deliberately tolerant — no cross-stamp
 * monotonicity is enforced by schema (alignment quality is a pipeline
 * concern, and karaoke degrades gracefully on imperfect stamps).
 */
export const WordStampSchema = z
  .strictObject({
    /** Id of the sentence this stamp points into (must exist in the story). */
    sentenceId: StableIdSchema,
    /** Index into that sentence's `tokens` array (0-based). */
    tokenIndex: z.number().int().nonnegative(),
    /** Start of the word in the audio, milliseconds. */
    startMs: z.number().int().nonnegative(),
    /** End of the word in the audio, milliseconds; must be > startMs. */
    endMs: z.number().int().nonnegative(),
  })
  .refine((s) => s.endMs > s.startMs, {
    message: 'endMs must be greater than startMs',
    path: ['endMs'],
  });
export type WordStamp = z.infer<typeof WordStampSchema>;
