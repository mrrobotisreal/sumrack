import type { Token } from '@sumrak/schema';
import { z } from 'zod';

/**
 * Pure Share-to-Сумрак intake logic (T28, design V2 §4.1/§4.3): text
 * normalization, sentence splitting, the length-cap split plan, imported-
 * pack id generation, and the dev-only stub pack builder. No I/O — the
 * wired flows live in import-service.ts; unit tests exercise this directly.
 */

/** V2 §4.1: ~4000 chars per import; longer input splits at sentence boundaries. */
export const IMPORT_CHAR_CAP = 4000;

/** Absolute guard on raw share payloads before any processing (untrusted input). */
export const RAW_SHARE_MAX_CHARS = 200_000;

/** The share-intent payload boundary — shared text is untrusted input. */
export const SharePayloadSchema = z.object({
  text: z.string().min(1).max(RAW_SHARE_MAX_CHARS),
});

/** The intake record the screen commits (post-normalization lengths). */
export const ImportIntakeSchema = z.strictObject({
  text: z.string().min(1).max(RAW_SHARE_MAX_CHARS),
  title: z.string().min(1).max(120),
  sourceLabel: z.string().min(1).max(120).optional(),
});
export type ImportIntake = z.infer<typeof ImportIntakeSchema>;

/**
 * NFC-normalize untrusted shared/pasted text (chat apps produce decomposed
 * Unicode — T08 lore), strip BOM/zero-width characters, unify newlines.
 * ё is preserved (NFC never touches it); inner whitespace is kept — only
 * sentence assembly collapses runs.
 */
export function normalizeIntakeText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[﻿​‌‍]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** Title suggestion: the first sentence's opening words, ≤40 chars, punctuation-trimmed. */
export function suggestTitle(text: string): string {
  const firstLine = (text.split('\n', 1)[0] ?? '').trim();
  const firstSentence = splitSentences(firstLine)[0] ?? firstLine;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  let title = '';
  for (const w of words) {
    const next = title ? `${title} ${w}` : w;
    if (title && next.length > 40) break;
    title = next;
    if (title.length >= 40) break;
  }
  title = title.replace(/[\s.,:;!?…«»„""'()-]+$/u, '');
  return title || 'Импорт';
}

/**
 * Rule-based sentence split: paragraphs by newline, sentences by terminal
 * punctuation (. ! ? …) with trailing closers (» " )) kept attached.
 * Whitespace runs collapse to single spaces — pack sentences must
 * reconstruct from single-space-joined tokens, so the collapse happens
 * here, at the boundary. Deliberately simple (dev-stub + split-plan use;
 * T29's review screen lets boundaries be edited).
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const collapsed = para.replace(/\s+/g, ' ').trim();
    if (!collapsed) continue;
    for (const m of collapsed.match(/[^.!?…]+(?:[.!?…]+[»")\]]*)?/gu) ?? []) {
      const s = m.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

function hardSplit(sentence: string, cap: number): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const word of sentence.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && next.length > cap) {
      parts.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * The over-cap split plan (V2 §4.1): greedy sentence-boundary packing into
 * parts of ≤cap chars. A pathological single sentence longer than the cap
 * hard-splits at whitespace. Under-cap input returns itself untouched.
 */
export function planImportSplit(text: string, cap = IMPORT_CHAR_CAP): string[] {
  if (text.length <= cap) return [text];
  const sentences = splitSentences(text).flatMap((s) =>
    s.length <= cap ? [s] : hardSplit(s, cap),
  );
  const parts: string[] = [];
  let cur = '';
  for (const s of sentences) {
    const next = cur ? `${cur} ${s}` : s;
    if (cur && next.length > cap) {
      parts.push(cur);
      cur = s;
    } else {
      cur = next;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** GOST-ish lowercase transliteration for slug generation only. */
const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Title → StableId-safe slug (`/^[a-z0-9][a-z0-9-]*$/`), ≤24 chars, 'tekst' fallback. */
export function slugify(title: string): string {
  let out = '';
  for (const ch of title.normalize('NFC').toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (/[\s_-]/.test(ch)) out += '-';
    // anything else is dropped
  }
  out = out
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return /^[a-z0-9]/.test(out) ? out : 'tekst';
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * `imported-<yyyymmdd>-<slug>` with a deterministic `-2`/`-3` dedup suffix
 * for same-day same-title collisions (recorded T28 decision). `existing`
 * must cover installed pack ids ∪ imported_packs ids (a removed-but-backed-
 * up id must not be reused by a different text).
 */
export function buildImportedPackId(title: string, existing: Iterable<string>, now: Date): string {
  const taken = new Set(existing);
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const base = `imported-${date}-${slugify(title)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const WORD_CHAR = /[\p{L}\p{N}́]/u;

/**
 * Stub tokenizer (dev-only path, replaced by T29's AI annotation):
 * whitespace chunks; leading/trailing punctuation split into `isPunct`
 * tokens; the word core keeps interior punctuation (кто-то stays one
 * token) and gets lemma = surface (T15's provisional-lemma convention —
 * enrichment/annotation corrects it later). `spaceBefore` overrides are
 * emitted only where they differ from the schema defaults, and the result
 * reconstructs the sentence exactly by construction (single-space joins).
 */
export function tokenizeSentence(ru: string): Token[] {
  const tokens: Token[] = [];
  for (const chunk of ru.split(' ').filter(Boolean)) {
    const chars = [...chunk];
    let start = 0;
    let end = chars.length;
    while (start < end && !WORD_CHAR.test(chars[start]!)) start += 1;
    while (end > start && !WORD_CHAR.test(chars[end - 1]!)) end -= 1;
    const parts: Token[] = [];
    const leading = chars.slice(0, start).join('');
    const core = chars.slice(start, end).join('');
    const trailing = chars.slice(end).join('');
    if (leading) parts.push({ text: leading, isPunct: true });
    if (core) parts.push({ text: core, lemma: core });
    if (trailing) parts.push({ text: trailing, isPunct: true });
    parts.forEach((tok, i) => {
      const index = tokens.length;
      const desired = i === 0 && index > 0; // space only before each chunk's first token
      const schemaDefault = index > 0 && !tok.isPunct;
      tokens.push(desired === schemaDefault ? tok : { ...tok, spaceBefore: desired });
    });
  }
  return tokens;
}

/**
 * DEV-ONLY stub annotator (T28 scope item 6): a minimal schema-valid
 * `type:'stories'` pack from an intake — rule-based sentence split, stub
 * tokens, NO translations (sentence `en` is a placeholder dash: the schema
 * requires non-empty, real translations are T29's job). Level 'A1' by
 * convention until T29 estimates one. Returned untyped: the caller MUST
 * gate it through `parsePack` (the commit gate) like any other pack.
 */
export function buildStubPack(input: { packId: string; title: string; text: string }): unknown {
  const title = { ru: input.title.normalize('NFC'), en: input.title };
  const sentences = splitSentences(input.text).map((ru, i) => ({
    id: `s1-${String(i + 1).padStart(3, '0')}`,
    ru,
    en: '—',
    tokens: tokenizeSentence(ru),
  }));
  return {
    id: input.packId,
    version: 1,
    type: 'stories',
    title,
    level: 'A1',
    tags: ['imported'],
    stories: [{ id: 's1', title, level: 'A1', sentences, audio: [] }],
  };
}
