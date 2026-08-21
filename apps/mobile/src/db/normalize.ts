/**
 * Russian text normalization for matching/search (roadmap §3: stored text is
 * never mutated — ё is preserved in content and user tables; tolerance lives
 * here, at the matching layer).
 */

/** NFC + lowercase + ё→е fold. The canonical "tolerant match" form of a word. */
export function normalizeRu(text: string): string {
  return text.normalize('NFC').toLowerCase().replaceAll('ё', 'е');
}

/** Phrase key: normalizeRu + whitespace collapse + trim (bank phrase dedup, design §5). */
export function normalizePhrase(text: string): string {
  return normalizeRu(text).replace(/\s+/g, ' ').trim();
}

/**
 * Turn raw user input into a safe FTS5 MATCH expression: normalize, split on
 * non-word characters, quote every term (so FTS operators/quotes in input
 * can't break the query), prefix-match the last term for as-you-type search.
 * Returns null when the input has no searchable content.
 */
export function toFtsQuery(raw: string): string | null {
  const terms = normalizeRu(raw)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return terms.map((t, i) => (i === terms.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}
