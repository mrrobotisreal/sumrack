import { z } from 'zod';

/**
 * Pure Share-to-Сумрак intake logic (T28, design V2 §4.1/§4.3): text
 * normalization, sentence splitting, the length-cap split plan, and
 * imported-pack id generation. No I/O — the wired flows live in
 * import-service.ts; unit tests exercise this directly. (The T28 dev-only
 * stub annotator was removed in T29 — the real annotation service lives in
 * `features/ai/import-annotate*.ts`.)
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
 * Abbreviations whose trailing dot essentially never ends a sentence —
 * they lead into what they abbreviate («ул. Ленина», «т. д.», initials
 * like «А. С. Пушкин» via the single-uppercase-letter rule).
 */
const ABBREV_ALWAYS = new Set(['т', 'ул', 'им', 'напр', 'см', 'гл', 'стр', 'рис', 'табл']);

/**
 * Abbreviations that CAN end a sentence («Это было в 1999 г.») — treated
 * as sentence-internal only when the next fragment starts with a
 * lowercase letter or digit (a real sentence start is capitalized).
 */
const ABBREV_IF_LOWER = new Set([
  'г',
  'гг',
  'в',
  'вв',
  'д',
  'е',
  'п',
  'кв',
  'с',
  'ок',
  'руб',
  'коп',
  'тыс',
  'млн',
  'млрд',
]);

/** Does this fragment end in an abbreviation dot (vs. a true sentence end)? */
function endsWithAbbreviation(fragment: string, next: string): boolean {
  // Only a bare '.' can be an abbreviation dot — !?… and closers end sentences.
  const m = /(\S+)\.$/u.exec(fragment.trim());
  if (!m) return false;
  const base = m[1]!.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\.$/u, '');
  const last = (base.split('.').pop() ?? '').normalize('NFC');
  if (/^\p{Lu}$/u.test(last)) return true; // single-letter initial
  const lower = last.toLowerCase();
  if (ABBREV_ALWAYS.has(lower)) return true;
  return ABBREV_IF_LOWER.has(lower) && /^[\p{Ll}\p{N}]/u.test(next.trim());
}

/**
 * Rule-based sentence split (T28, made abbreviation-aware in T29):
 * paragraphs by newline, sentences by terminal punctuation (. ! ? …) with
 * trailing closers (» " )) kept attached; a '.' after a known abbreviation
 * or a single-letter initial does not split (heuristic — T29's review
 * screen lets boundaries be merged/split by hand). Whitespace runs
 * collapse to single spaces — pack sentences must reconstruct from
 * single-space-joined tokens, so the collapse happens here, at the
 * boundary.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const collapsed = para.replace(/\s+/g, ' ').trim();
    if (!collapsed) continue;
    const spans: { start: number; end: number }[] = [];
    const re = /[^.!?…]+(?:[.!?…]+[»")\]]*)?/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(collapsed)) !== null) {
      if (m[0].trim()) spans.push({ start: m.index, end: m.index + m[0].length });
    }
    let i = 0;
    while (i < spans.length) {
      let j = i;
      while (
        j < spans.length - 1 &&
        endsWithAbbreviation(
          collapsed.slice(spans[i]!.start, spans[j]!.end),
          collapsed.slice(spans[j + 1]!.start, spans[j + 1]!.end),
        )
      ) {
        j += 1;
      }
      const s = collapsed.slice(spans[i]!.start, spans[j]!.end).trim();
      if (s) out.push(s);
      i = j + 1;
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
