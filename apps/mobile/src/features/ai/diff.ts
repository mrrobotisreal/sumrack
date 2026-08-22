/**
 * Word-level diff for journal corrections (T16). Deliberately small: an
 * LCS over whitespace-split words (NFC-normalized exact compare — case
 * and ё fixes are real corrections and must show). No library (ticket
 * note: keep it simple, word/phrase-level).
 */

export type DiffSegment = {
  type: 'same' | 'del' | 'ins';
  text: string;
};

/** Beyond this many words per side, skip the O(n·m) table (UI falls back). */
const MAX_WORDS = 600;

function words(text: string): string[] {
  return text.normalize('NFC').split(/\s+/).filter(Boolean);
}

/**
 * Diff original → corrected as word segments, adjacent same-type words
 * joined with single spaces. Returns null when either text is too long
 * for the quadratic table — callers render the corrected text plainly.
 */
export function diffWords(original: string, corrected: string): DiffSegment[] | null {
  const a = words(original);
  const b = words(corrected);
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) return null;
  if (a.length === 0 && b.length === 0) return [];

  // LCS length table (a.length+1 × b.length+1).
  const n = a.length;
  const m = b.length;
  const table: Uint16Array = new Uint16Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[idx(i, j)] =
        a[i] === b[j]
          ? table[idx(i + 1, j + 1)]! + 1
          : Math.max(table[idx(i + 1, j)]!, table[idx(i, j + 1)]!);
    }
  }

  // Walk the table emitting del/ins/same runs.
  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], word: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += ` ${word}`;
    else segments.push({ type, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (table[idx(i + 1, j)]! >= table[idx(i, j + 1)]!) {
      push('del', a[i]!);
      i++;
    } else {
      push('ins', b[j]!);
      j++;
    }
  }
  while (i < n) {
    push('del', a[i]!);
    i++;
  }
  while (j < m) {
    push('ins', b[j]!);
    j++;
  }
  return segments;
}

/** True when the diff found nothing to change (entry was already correct). */
export function isUnchanged(segments: DiffSegment[]): boolean {
  return segments.every((s) => s.type === 'same');
}
