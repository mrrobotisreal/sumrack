import { SentenceSchema, TokenSchema, type Token } from '@sumrak/schema';
import { z } from 'zod';

import { splitSentences } from '@/features/import/import-core';

import type { ChatMessage, ChatResult } from './client';
import { AiError, friendlyAiMessage, isRetriable, toAiError } from './errors';
import {
  buildImportAnnotateMessages,
  buildImportAnnotateRetryMessages,
  type AnnotateSentenceInput,
} from './prompts/import-annotate';
import {
  CEFR_LEVELS,
  extractJsonObject,
  ImportAnnotateResponseSchema,
  type AnnotateToken,
} from './schemas';

/**
 * Pure import-annotation logic (T29, design V2 §4.2) — no DB, network, or
 * store imports, per the T16 core/wired split. The wired worker lives in
 * import-annotate.ts.
 *
 * The durable unit is the ANNOTATION ENVELOPE, stored as JSON in
 * `import_requests.annotationJson`: the request's sentence list with
 * per-sentence status. It is written after every batch, so progress
 * survives restarts (a half-annotated request resumes from its pending
 * sentences) and the review screen's boundary edits persist without
 * touching any content table.
 */

/** Sentences per model request (recorded T29 decision: 4, in the 3–5 band). */
export const ANNOTATE_BATCH_SIZE = 4;

/** Annotation responses are token-table heavy — allow long completions. */
export const ANNOTATE_MAX_TOKENS = 8192;

// --- envelope ---------------------------------------------------------------

export const EnvelopeSentenceSchema = z.object({
  /** Envelope-local stable uid (`c1`, `c2`, …) — NOT the final pack sentence id. */
  uid: z.string().min(1),
  /** The sentence text (NFC, single spaces — splitSentences output). */
  ru: z.string().min(1),
  /**
   * pending = not yet annotated (new, boundary-edited, or awaiting re-run);
   * ok = annotated and reconstruction-verified;
   * needs-review = failed the shown-error retry — never silently mangled.
   */
  status: z.enum(['pending', 'ok', 'needs-review']),
  en: z.string().min(1).optional(),
  /** Schema-valid tokens (present iff status 'ok'). */
  tokens: z.array(TokenSchema).min(1).optional(),
  /** Low-confidence token indexes (model `uncertain` + heuristics). */
  flagged: z.array(z.number().int().nonnegative()).optional(),
  /** The exact validation error (status 'needs-review'). */
  error: z.string().optional(),
  /** The model's raw token attempt, preserved for review (status 'needs-review'). */
  raw: z.unknown().optional(),
});
export type EnvelopeSentence = z.infer<typeof EnvelopeSentenceSchema>;

export const AnnotationEnvelopeSchema = z.object({
  v: z.literal(1),
  /** Counter for allocating fresh uids across merges/splits. */
  nextUid: z.number().int().positive(),
  /** Merged CEFR estimate (max across batches — a text is as hard as its hardest chunk). */
  level: z.enum(CEFR_LEVELS).optional(),
  /** The model that served the most recent batch. */
  model: z.string().optional(),
  sentences: z.array(EnvelopeSentenceSchema),
});
export type AnnotationEnvelope = z.infer<typeof AnnotationEnvelopeSchema>;

/** Parse a stored annotationJson value; null = absent/unreadable (start fresh). */
export function parseEnvelope(raw: string | null): AnnotationEnvelope | null {
  if (!raw) return null;
  try {
    const parsed = AnnotationEnvelopeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Fresh envelope from request text: rule-based sentence split, all pending. */
export function newEnvelope(text: string): AnnotationEnvelope {
  const sentences = splitSentences(text).map((ru, i) => ({
    uid: `c${i + 1}`,
    ru,
    status: 'pending' as const,
  }));
  return { v: 1, nextUid: sentences.length + 1, sentences };
}

export function envelopeProgress(env: AnnotationEnvelope): {
  done: number;
  total: number;
  flagged: number;
} {
  const total = env.sentences.length;
  const done = env.sentences.filter((s) => s.status !== 'pending').length;
  const flagged = env.sentences.filter(
    (s) => s.status === 'needs-review' || (s.flagged?.length ?? 0) > 0,
  ).length;
  return { done, total, flagged };
}

// --- boundary edits (review screen, pure) -----------------------------------

/** Merge sentence `uid` with the one after it; the result needs re-annotation. */
export function mergeWithNext(env: AnnotationEnvelope, uid: string): AnnotationEnvelope {
  const i = env.sentences.findIndex((s) => s.uid === uid);
  const next = env.sentences[i + 1];
  const cur = env.sentences[i];
  if (!cur || !next) return env;
  const merged: EnvelopeSentence = {
    uid: cur.uid,
    ru: `${cur.ru} ${next.ru}`,
    status: 'pending',
  };
  return {
    ...env,
    sentences: [...env.sentences.slice(0, i), merged, ...env.sentences.slice(i + 2)],
  };
}

/** The whitespace-chunk words of a sentence (split-point choices in review). */
export function sentenceWords(ru: string): string[] {
  return ru.split(' ').filter(Boolean);
}

/**
 * Split sentence `uid` after word `wordIdx` (0-based whitespace chunk);
 * both halves need re-annotation. No-op for out-of-range indexes.
 */
export function splitAfterWord(
  env: AnnotationEnvelope,
  uid: string,
  wordIdx: number,
): AnnotationEnvelope {
  const i = env.sentences.findIndex((s) => s.uid === uid);
  const cur = env.sentences[i];
  if (!cur) return env;
  const words = sentenceWords(cur.ru);
  if (wordIdx < 0 || wordIdx >= words.length - 1) return env;
  const first: EnvelopeSentence = {
    uid: cur.uid,
    ru: words.slice(0, wordIdx + 1).join(' '),
    status: 'pending',
  };
  const second: EnvelopeSentence = {
    uid: `c${env.nextUid}`,
    ru: words.slice(wordIdx + 1).join(' '),
    status: 'pending',
  };
  return {
    ...env,
    nextUid: env.nextUid + 1,
    sentences: [...env.sentences.slice(0, i), first, second, ...env.sentences.slice(i + 1)],
  };
}

export function deleteSentence(env: AnnotationEnvelope, uid: string): AnnotationEnvelope {
  return { ...env, sentences: env.sentences.filter((s) => s.uid !== uid) };
}

// --- token building + the reconstruction invariant --------------------------

/**
 * Word/punctuation classification — the pipeline's rule (assemble.ts): a
 * token whose text has no letters or digits is punctuation. Emoji and
 * symbols pass through as punctuation tokens (recorded T29 edge rule).
 */
export function isPunctText(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/** A short excerpt of the sentence around an offset (pipeline align.ts style). */
function excerpt(ru: string, at: number): string {
  const from = Math.max(0, at - 10);
  const to = Math.min(ru.length, at + 15);
  return `${from > 0 ? '…' : ''}${ru.slice(from, at)}⟨here⟩${ru.slice(at, to)}${to < ru.length ? '…' : ''}`;
}

/** Content POS whose words should always carry grammar+level (confidence heuristic). */
const CONTENT_POS = new Set(['noun', 'verb', 'adj', 'adv']);

/**
 * Low-confidence rule (recorded T29 decision): a token is flagged when the
 * model marked it `uncertain`, OR it is a word token with a content POS
 * (noun/verb/adj/adv) missing `grammar` or `level`, OR a word token with
 * no `pos` at all. Names/foreign/num/other are exempt from the level
 * heuristic — the edge rules deliberately omit `level` for them.
 */
export function tokenIsLowConfidence(raw: AnnotateToken, built: Token): boolean {
  if (raw.uncertain) return true;
  if (built.isPunct) return false;
  if (!built.pos) return true;
  if (CONTENT_POS.has(built.pos)) return !built.grammar || !built.level;
  return false;
}

export interface BuiltSentence {
  en: string;
  tokens: Token[];
  flagged: number[];
}

/**
 * Turn one model sentence into schema-valid tokens: NFC + trim each text,
 * auto-classify punctuation (annotations on punctuation are dropped — they
 * carry no meaning; a WORD token missing lemma/translation is an error,
 * never auto-filled), derive `spaceBefore` by walking the sentence text
 * (the pipeline align.ts walk — derivation IS the reconstruction
 * invariant), then run the shared SentenceSchema as the authoritative
 * gate. Throws Error with the exact ⟨here⟩-marked message for the retry
 * prompt.
 */
export function buildSentenceFromResponse(
  ru: string,
  en: string,
  rawTokens: AnnotateToken[],
): BuiltSentence {
  const tokens: Token[] = [];
  const flagged: number[] = [];

  for (const raw of rawTokens) {
    const text = raw.text.normalize('NFC').trim();
    if (!text) continue; // stray whitespace token — spacing is derived, skip
    let tok: Token;
    if (isPunctText(text)) {
      tok = { text, isPunct: true, ...(raw.note ? { note: raw.note } : {}) };
    } else {
      if (!raw.lemma || !raw.translation) {
        throw new Error(
          `word token "${text}" is missing ${!raw.lemma ? 'lemma' : 'translation'} — every word token needs both`,
        );
      }
      tok = {
        text,
        lemma: raw.lemma.normalize('NFC'),
        translation: raw.translation,
        ...(raw.pos ? { pos: raw.pos } : {}),
        ...(raw.grammar ? { grammar: raw.grammar } : {}),
        ...(raw.level ? { level: raw.level } : {}),
        ...(raw.note ? { note: raw.note } : {}),
      };
    }
    if (tokenIsLowConfidence(raw, tok)) flagged.push(tokens.length);
    tokens.push(tok);
  }
  if (tokens.length === 0) throw new Error('no tokens returned');

  // Derive spacing by walking the sentence (pipeline align.ts): a token
  // that cannot be consumed in order fails with a precise ⟨here⟩ marker.
  let pos = 0;
  tokens.forEach((tok, i) => {
    let space = false;
    if (ru[pos] === ' ') {
      space = true;
      pos += 1;
    }
    if (!ru.startsWith(tok.text, pos)) {
      throw new Error(
        `token "${tok.text}" does not match the sentence at offset ${pos}: "${excerpt(ru, pos)}" — token texts must appear in order and rebuild the sentence exactly`,
      );
    }
    pos += tok.text.length;
    const schemaDefault = i > 0 && !tok.isPunct;
    if (space !== schemaDefault) tok.spaceBefore = space;
    else delete tok.spaceBefore;
  });
  if (pos !== ru.length) {
    throw new Error(`tokens end before the sentence does — unconsumed text: "${excerpt(ru, pos)}"`);
  }

  // The shared invariant from packages/schema is the authoritative gate.
  const parsed = SentenceSchema.safeParse({ id: 'chk-1', ru, en, tokens });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      issue ? `${issue.path.join('.')}: ${issue.message}` : 'sentence failed validation',
    );
  }
  return { en: parsed.data.en, tokens: parsed.data.tokens, flagged };
}

/** max() over CEFR order — a text is as hard as its hardest chunk. */
export function mergeLevel(
  a: AnnotationEnvelope['level'],
  b: AnnotationEnvelope['level'],
): AnnotationEnvelope['level'] {
  if (!a) return b;
  if (!b) return a;
  return CEFR_LEVELS.indexOf(b) > CEFR_LEVELS.indexOf(a) ? b : a;
}

// --- the annotation pass ----------------------------------------------------

/** Transient-failure retries within one batch (same ladder as journal feedback). */
export const RETRY_DELAYS_MS = [2_000, 8_000];

export interface AnnotatePassDeps {
  chat: (req: {
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
  }) => Promise<ChatResult>;
  sleep: (ms: number) => Promise<void>;
  retryDelaysMs?: number[];
  /** Analytics hook: a semantic (reconstruction) retry round-trip happened. */
  onRetry?: (count: number) => void;
}

/** One transport call with the T16 retry ladder + JSON/Zod parse inside it. */
async function chatParsed(deps: AnnotatePassDeps, messages: ChatMessage[]) {
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  let lastError: AiError = new AiError('unknown', 'annotation did not run');
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const result = await deps.chat({
        messages,
        maxTokens: ANNOTATE_MAX_TOKENS,
        temperature: 0.2,
      });
      const json = extractJsonObject(result.content);
      const parsed = ImportAnnotateResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new AiError('invalid-response', 'annotation did not match the expected shape');
      }
      return { response: parsed.data, rawContent: result.content, model: result.model };
    } catch (err) {
      lastError = toAiError(err);
      if (!isRetriable(lastError) || attempt === delays.length) break;
      await deps.sleep(delays[attempt]!);
    }
  }
  throw lastError;
}

/**
 * Annotate the target sentences of an envelope (a queue batch pass or a
 * single-sentence re-run), mutating nothing — returns the updated
 * envelope. Per-sentence reconstruction failures get ONE retry with the
 * exact error text shown to the model; still-failing sentences become
 * `needs-review` with the raw attempt preserved. Transport errors (after
 * the ladder) propagate as AiError — the caller decides queue behavior.
 */
export async function annotateSentences(
  deps: AnnotatePassDeps,
  env: AnnotationEnvelope,
  uids: string[],
): Promise<AnnotationEnvelope> {
  const targets = env.sentences.filter((s) => uids.includes(s.uid));
  if (targets.length === 0) return env;
  const batch: AnnotateSentenceInput[] = targets.map((s) => ({ id: s.uid, ru: s.ru }));

  const first = await chatParsed(deps, buildImportAnnotateMessages(batch));
  let level = mergeLevel(env.level, first.response.level);

  const results = new Map<string, EnvelopeSentence>();
  const failures: { id: string; error: string; raw: unknown }[] = [];

  const applyOne = (uid: string, ru: string, got: (typeof first.response.sentences)[number]) => {
    try {
      const built = buildSentenceFromResponse(ru, got.en, got.tokens);
      results.set(uid, {
        uid,
        ru,
        status: 'ok',
        en: built.en,
        tokens: built.tokens,
        ...(built.flagged.length > 0 ? { flagged: built.flagged } : {}),
      });
      return null;
    } catch (err) {
      return { id: uid, error: err instanceof Error ? err.message : String(err), raw: got.tokens };
    }
  };

  const byId = new Map(first.response.sentences.map((s) => [s.id, s]));
  for (const t of targets) {
    const got = byId.get(t.uid);
    if (!got) {
      failures.push({ id: t.uid, error: 'sentence was not returned', raw: undefined });
      continue;
    }
    const fail = applyOne(t.uid, t.ru, got);
    if (fail) failures.push(fail);
  }

  let finalFailures = failures;
  if (failures.length > 0) {
    deps.onRetry?.(failures.length);
    const retry = await chatParsed(
      deps,
      buildImportAnnotateRetryMessages(
        batch,
        first.rawContent,
        failures.map((f) => ({ id: f.id, error: f.error })),
      ),
    );
    level = mergeLevel(level, retry.response.level);
    const retryById = new Map(retry.response.sentences.map((s) => [s.id, s]));
    finalFailures = [];
    for (const f of failures) {
      const target = targets.find((t) => t.uid === f.id);
      const got = retryById.get(f.id);
      if (!target) continue;
      if (!got) {
        finalFailures.push(f);
        continue;
      }
      const fail = applyOne(f.id, target.ru, got);
      if (fail) finalFailures.push(fail);
    }
  }

  for (const f of finalFailures) {
    const ru = targets.find((t) => t.uid === f.id)?.ru ?? '';
    results.set(f.id, {
      uid: f.id,
      ru,
      status: 'needs-review',
      error: f.error,
      ...(f.raw !== undefined ? { raw: f.raw } : {}),
    });
  }

  return {
    ...env,
    level,
    model: first.model,
    sentences: env.sentences.map((s) => results.get(s.uid) ?? s),
  };
}

// --- queue processor ---------------------------------------------------------

export type AnnotatePhase = 'queued' | 'sending' | 'error';

export interface RequestAnnotateState {
  phase: AnnotatePhase;
  /** Sentences annotated / total, for the N/M progress line. */
  done?: number;
  total?: number;
  /** Plain-language error for phase 'error' (friendlyAiMessage — key-free). */
  message?: string;
}

export interface AnnotateQueueDeps extends AnnotatePassDeps {
  listQueued: () => Promise<{ id: string; text: string; annotationJson: string | null }[]>;
  saveEnvelope: (requestId: string, envelopeJson: string) => Promise<void>;
  markAnnotated: (requestId: string, envelopeJson: string) => Promise<void>;
  isOnline: () => Promise<boolean>;
  onPhase: (requestId: string, state: RequestAnnotateState | null) => void;
  onRequestDone?: (requestId: string, stats: { sentences: number; flagged: number }) => void;
  onRequestFailed?: (requestId: string, code: AiError['code']) => void;
}

/**
 * Drain every queued import request (T16 queue-core pattern): the durable
 * queue IS the `'queued'` request rows; the durable progress is the
 * envelope, saved after every batch so a killed app resumes from the
 * pending sentences. Failures keep the row queued with an ephemeral error
 * phase; a key problem halts the pass. Returns requests fully annotated.
 */
export async function processAnnotateQueue(deps: AnnotateQueueDeps): Promise<number> {
  const queued = await deps.listQueued();
  if (queued.length === 0) return 0;

  let doneCount = 0;
  for (const req of queued) {
    if (!(await deps.isOnline())) {
      deps.onPhase(req.id, { phase: 'queued' });
      break;
    }

    let env = parseEnvelope(req.annotationJson);
    if (!env) {
      env = newEnvelope(req.text);
      if (env.sentences.length === 0) {
        // Degenerate request (whitespace-only text) — flag rather than loop.
        deps.onPhase(req.id, { phase: 'error', message: 'No sentences found in this text.' });
        continue;
      }
      await deps.saveEnvelope(req.id, JSON.stringify(env));
    }

    const progress = () => envelopeProgress(env!);
    deps.onPhase(req.id, { phase: 'sending', ...progress() });

    let halted: AiError | null = null;
    while (env.sentences.some((s) => s.status === 'pending')) {
      if (!(await deps.isOnline())) {
        deps.onPhase(req.id, { phase: 'queued', ...progress() });
        return doneCount;
      }
      const batch = env.sentences
        .filter((s) => s.status === 'pending')
        .slice(0, ANNOTATE_BATCH_SIZE)
        .map((s) => s.uid);
      try {
        env = await annotateSentences(deps, env, batch);
      } catch (err) {
        halted = toAiError(err);
        break;
      }
      await deps.saveEnvelope(req.id, JSON.stringify(env));
      deps.onPhase(req.id, { phase: 'sending', ...progress() });
    }

    if (halted) {
      deps.onPhase(req.id, { phase: 'error', ...progress(), message: friendlyAiMessage(halted) });
      deps.onRequestFailed?.(req.id, halted.code);
      // A key problem will fail every remaining request identically.
      if (halted.code === 'no-key' || halted.code === 'http-auth') break;
      continue;
    }

    await deps.markAnnotated(req.id, JSON.stringify(env));
    deps.onPhase(req.id, null);
    const { total, flagged } = envelopeProgress(env);
    deps.onRequestDone?.(req.id, { sentences: total, flagged });
    doneCount++;
  }
  return doneCount;
}

// --- commit: envelope → pack ------------------------------------------------

/**
 * Assemble the local pack from an envelope (V2 §4.3): `type:'stories'`,
 * tag `imported`, no audio; only `'ok'` sentences are included — flagged/
 * pending sentences are EXCLUDED at commit after explicit confirmation
 * (recorded T29 decision). Returned untyped: the commit gate
 * (`commitRequestAsPack`) runs it through `parsePack` like any pack.
 */
export function buildPackFromEnvelope(input: {
  packId: string;
  title: string;
  env: AnnotationEnvelope;
}): { pack: unknown; included: number; excluded: number } {
  const ok = input.env.sentences.filter((s) => s.status === 'ok' && s.en && s.tokens);
  const excluded = input.env.sentences.length - ok.length;
  const title = { ru: input.title.normalize('NFC'), en: input.title.normalize('NFC') };
  const level = input.env.level ?? 'A1';
  const sentences = ok.map((s, i) => ({
    id: `s1-${String(i + 1).padStart(3, '0')}`,
    ru: s.ru,
    en: s.en!,
    tokens: s.tokens!,
  }));
  return {
    pack: {
      id: input.packId,
      version: 1,
      type: 'stories',
      title,
      level,
      tags: ['imported'],
      stories: [{ id: 's1', title, level, sentences, audio: [] }],
    },
    included: ok.length,
    excluded,
  };
}
