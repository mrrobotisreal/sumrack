import type { TokenRow } from '@/db/repositories/content';

/**
 * Chunking turns a sentence's token list into the visual words TokenText
 * lays out: consecutive tokens with no space between them render as one
 * unbreakable unit («Это, соседи»., etc.), so wrapping can never separate
 * a word from its attached punctuation. The importer stored the *effective*
 * spaceBefore per token (schema defaults already applied), and the schema's
 * reconstruction invariant guarantees chunks joined with single spaces
 * reproduce `Sentence.ru` exactly.
 */
export interface TokenChunk {
  /** Index of this chunk within the sentence's chunk list. */
  index: number;
  tokens: TokenRow[];
  /** Concatenated surface text (no internal spaces by construction). */
  text: string;
  /**
   * The token a tap/selection refers to — the first word (non-punct) token.
   * Null for punctuation-only chunks (e.g. a free-standing dash), which are
   * neither tappable nor selection endpoints.
   */
  wordToken: TokenRow | null;
}

export function buildChunks(tokens: TokenRow[]): TokenChunk[] {
  const chunks: TokenChunk[] = [];
  let cur: TokenRow[] = [];
  const push = () => {
    if (cur.length === 0) return;
    chunks.push({
      index: chunks.length,
      tokens: cur,
      text: cur.map((t) => t.text).join(''),
      wordToken: cur.find((t) => !t.isPunct) ?? null,
    });
    cur = [];
  };
  for (const tok of tokens) {
    if (tok.spaceBefore && cur.length > 0) push();
    cur.push(tok);
  }
  push();
  return chunks;
}

/** A contiguous phrase selection, expressed in chunk indices (inclusive). */
export interface ChunkRange {
  start: number;
  end: number;
}

export function normalizeRange(a: number, b: number): ChunkRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/**
 * Snap a range's endpoints inward to chunks that contain a word token, so a
 * selection never starts or ends on bare punctuation. Returns null when the
 * range covers no words at all.
 */
export function snapRangeToWords(chunks: TokenChunk[], range: ChunkRange): ChunkRange | null {
  let { start, end } = range;
  while (start <= end && !chunks[start]?.wordToken) start++;
  while (end >= start && !chunks[end]?.wordToken) end--;
  if (start > end) return null;
  return { start, end };
}

/** All tokens covered by a chunk range, in sentence order. */
export function tokensInRange(chunks: TokenChunk[], range: ChunkRange): TokenRow[] {
  return chunks.slice(range.start, range.end + 1).flatMap((c) => c.tokens);
}

/** Word (non-punct) tokens covered by a chunk range. */
export function wordTokensInRange(chunks: TokenChunk[], range: ChunkRange): TokenRow[] {
  return tokensInRange(chunks, range).filter((t) => !t.isPunct);
}

/**
 * The selected phrase's surface text, reconstructed with the same
 * spaceBefore rule the schema invariant uses — an exact substring of the
 * sentence text.
 */
export function phraseSurface(chunks: TokenChunk[], range: ChunkRange): string {
  return chunks
    .slice(range.start, range.end + 1)
    .map((c) => c.text)
    .join(' ');
}

/**
 * Naive translation assembled from token glosses (design §7.1). Reads
 * roughly by design — the phrase card is editable before save, which is
 * what makes gloss concatenation acceptable (ticket technical note).
 */
export function glossTranslation(chunks: TokenChunk[], range: ChunkRange): string {
  return wordTokensInRange(chunks, range)
    .map((t) => t.translation)
    .filter((tr): tr is string => !!tr)
    .join(' ');
}
