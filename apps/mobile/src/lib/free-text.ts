import type { InlineRun } from './markdown';

/**
 * Free-text chunking (T15): the token-chunks analogue for text that has no
 * `tokens` rows behind it — journal entries and notes (design §7.4). Chunks
 * are whitespace-delimited visual words; punctuation stays glued to its
 * word, exactly like the reader, so the same tap/drag selection mechanics
 * apply. A chunk carries styled segments so markdown bold/italic/code can
 * cross into the selectable preview.
 */

export interface FreeChunkSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export interface FreeChunk {
  /** Index within the chunk list. */
  index: number;
  /** Full visual text (segments concatenated). */
  text: string;
  segments: FreeChunkSegment[];
  /** Contains at least one letter/digit — tappable and a valid selection endpoint. */
  isWord: boolean;
}

export interface FreeRange {
  start: number;
  end: number;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Split styled runs into whitespace-delimited chunks, styles preserved per segment. */
export function chunkRuns(runs: InlineRun[]): FreeChunk[] {
  const chunks: FreeChunk[] = [];
  let segments: FreeChunkSegment[] = [];

  const push = () => {
    if (segments.length === 0) return;
    const text = segments.map((s) => s.text).join('');
    chunks.push({ index: chunks.length, text, segments, isWord: WORD_CHAR.test(text) });
    segments = [];
  };

  for (const run of runs) {
    const style = { bold: run.bold, italic: run.italic, code: run.code };
    // Split keeping nothing: whitespace only ever separates chunks.
    const parts = run.text.split(/\s+/);
    parts.forEach((part, i) => {
      // A run starting/ending with whitespace breaks the chunk at that edge.
      if (i > 0) push();
      if (part.length === 0) return;
      const prev = segments[segments.length - 1];
      if (
        prev &&
        prev.bold === style.bold &&
        prev.italic === style.italic &&
        prev.code === style.code
      ) {
        prev.text += part;
      } else {
        segments.push({ text: part, ...style });
      }
    });
  }
  push();
  return chunks;
}

/** Chunk a plain (unstyled) text — journal entries. */
export function chunkText(text: string): FreeChunk[] {
  return chunkRuns([{ text }]);
}

export function normalizeFreeRange(a: number, b: number): FreeRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/**
 * Snap range endpoints inward to word chunks (selection never starts/ends
 * on bare punctuation). Null when the range contains no words.
 */
export function snapFreeRangeToWords(chunks: FreeChunk[], range: FreeRange): FreeRange | null {
  let { start, end } = range;
  while (start <= end && !chunks[start]?.isWord) start++;
  while (end >= start && !chunks[end]?.isWord) end--;
  if (start > end) return null;
  return { start, end };
}

/**
 * The clean surface form for the bank: edge punctuation stripped («слышу,»
 * → «слышу»), inner punctuation kept (то-то, где-нибудь). Null when nothing
 * word-like remains.
 */
export function cleanSurface(raw: string): string | null {
  const trimmed = raw.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
  return trimmed.length > 0 ? trimmed : null;
}

/** Phrase surface across a snapped range: chunks joined by single spaces, edges cleaned. */
export function phraseSurface(chunks: FreeChunk[], range: FreeRange): string | null {
  const joined = chunks
    .slice(range.start, range.end + 1)
    .map((c) => c.text)
    .join(' ');
  return cleanSurface(joined);
}

/** Count of word chunks inside a range — 1 means "treat as word tap, not phrase". */
export function wordCountInRange(chunks: FreeChunk[], range: FreeRange): number {
  let n = 0;
  for (let i = range.start; i <= range.end; i++) if (chunks[i]?.isWord) n++;
  return n;
}
