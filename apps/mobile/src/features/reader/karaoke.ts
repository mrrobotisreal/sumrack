/**
 * Karaoke timing logic (T10, design §7.1/§11) — pure functions, no RN/audio
 * imports, fully unit-tested. Builds a time index for one audio track and
 * answers "what is active at time t":
 *
 * - **word mode** — the track has word stamps (T09 pipeline output): active
 *   word by binary search over stamp start times; sentence spans derived
 *   from each sentence's first/last stamp.
 * - **sentence mode** — the §11 degradation path for a stampless track: the
 *   only timing we have is the track duration, so sentence spans are
 *   estimated proportionally by character weight of each sentence's `ru`.
 *   Highlighting is per-sentence and tap-to-seek lands on the estimate.
 */

export interface KaraokeStampInput {
  sentenceId: string;
  tokenIndex: number;
  startMs: number;
  endMs: number;
}

export interface KaraokeSentenceInput {
  id: string;
  ru: string;
}

export type KaraokeMode = 'word' | 'sentence';

export interface ActiveWord {
  sentenceId: string;
  tokenIndex: number;
}

export interface SentenceSpan {
  sentenceId: string;
  /** Index into the reader's sentence list (drives auto-scroll targets). */
  sentenceIdx: number;
  startMs: number;
  endMs: number;
}

interface IndexedStamp extends KaraokeStampInput {
  /** End of this word's *highlight* window (extends into trailing silence). */
  activeEndMs: number;
}

export interface KaraokeIndex {
  mode: KaraokeMode;
  durationMs: number;
  /** Sorted by startMs. Empty in sentence mode. */
  stamps: IndexedStamp[];
  /** Sorted by startMs, one per sentence that has timing. */
  spans: SentenceSpan[];
  /** `${sentenceId}:${tokenIndex}` → stamp (word mode; word-popup segments). */
  stampByToken: Map<string, KaraokeStamp>;
}

export type KaraokeStamp = KaraokeStampInput;

/** Hold a word's highlight through a trailing gap up to this long (anti-flicker). */
const WORD_HOLD_MS = 600;
/** Highlight grace after the very last word of the track. */
const FINAL_WORD_HOLD_MS = 300;

export const tokenKey = (sentenceId: string, tokenIndex: number): string =>
  `${sentenceId}:${tokenIndex}`;

/**
 * Build the time index for one track. `sentences` must be in reading order —
 * their positions become `sentenceIdx`. Zero stamps ⇒ sentence mode.
 */
export function buildKaraokeIndex(
  sentences: readonly KaraokeSentenceInput[],
  stamps: readonly KaraokeStampInput[],
  durationMs: number,
): KaraokeIndex {
  const sentenceIdxById = new Map<string, number>();
  sentences.forEach((s, i) => sentenceIdxById.set(s.id, i));

  if (stamps.length === 0) {
    return {
      mode: 'sentence',
      durationMs,
      stamps: [],
      spans: proportionalSpans(sentences, durationMs),
      stampByToken: new Map(),
    };
  }

  const sorted = [...stamps].sort((a, b) => a.startMs - b.startMs);
  const indexed: IndexedStamp[] = sorted.map((s, i) => {
    const next = sorted[i + 1];
    const activeEndMs =
      next != null ? Math.min(next.startMs, s.endMs + WORD_HOLD_MS) : s.endMs + FINAL_WORD_HOLD_MS;
    // A stamp overlapped by its successor still gets its own start instant.
    return { ...s, activeEndMs: Math.max(activeEndMs, s.startMs) };
  });

  // Sentence spans: first-stamp start → last-stamp end per sentence.
  const bySentence = new Map<string, { startMs: number; endMs: number }>();
  for (const s of sorted) {
    const cur = bySentence.get(s.sentenceId);
    if (!cur) bySentence.set(s.sentenceId, { startMs: s.startMs, endMs: s.endMs });
    else {
      cur.startMs = Math.min(cur.startMs, s.startMs);
      cur.endMs = Math.max(cur.endMs, s.endMs);
    }
  }
  const spans: SentenceSpan[] = [...bySentence.entries()]
    .map(([sentenceId, t]) => ({
      sentenceId,
      sentenceIdx: sentenceIdxById.get(sentenceId) ?? -1,
      startMs: t.startMs,
      endMs: t.endMs,
    }))
    .filter((s) => s.sentenceIdx >= 0)
    .sort((a, b) => a.startMs - b.startMs);

  const stampByToken = new Map<string, KaraokeStamp>();
  for (const s of sorted) {
    const key = tokenKey(s.sentenceId, s.tokenIndex);
    // First stamp wins if a token were ever stamped twice.
    if (!stampByToken.has(key)) stampByToken.set(key, s);
  }

  return { mode: 'word', durationMs, stamps: indexed, spans, stampByToken };
}

/**
 * Sentence-mode spans: distribute the track duration across sentences
 * proportionally to their text length. Contiguous, covering [0, durationMs].
 */
function proportionalSpans(
  sentences: readonly KaraokeSentenceInput[],
  durationMs: number,
): SentenceSpan[] {
  if (sentences.length === 0 || durationMs <= 0) return [];
  // +4 per sentence stands in for the inter-sentence pause so very short
  // sentences don't collapse to near-zero windows.
  const weights = sentences.map((s) => s.ru.length + 4);
  const total = weights.reduce((a, b) => a + b, 0);
  const spans: SentenceSpan[] = [];
  let cum = 0;
  for (let i = 0; i < sentences.length; i++) {
    const startMs = Math.round((cum / total) * durationMs);
    cum += weights[i]!;
    const endMs = i === sentences.length - 1 ? durationMs : Math.round((cum / total) * durationMs);
    spans.push({ sentenceId: sentences[i]!.id, sentenceIdx: i, startMs, endMs });
  }
  return spans;
}

/** Index of the last element with startMs <= t, or -1. */
function lastStartedIdx(items: readonly { startMs: number }[], tMs: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.startMs <= tMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** The word to highlight at `tMs`, or null (lead-in, or a long silence). */
export function activeWordAt(index: KaraokeIndex, tMs: number): ActiveWord | null {
  if (index.mode !== 'word') return null;
  const i = lastStartedIdx(index.stamps, tMs);
  if (i < 0) return null;
  const stamp = index.stamps[i]!;
  if (tMs >= stamp.activeEndMs) return null;
  return { sentenceId: stamp.sentenceId, tokenIndex: stamp.tokenIndex };
}

/**
 * The sentence to treat as active at `tMs` — the last one whose span has
 * started (holds through inter-sentence pauses so auto-scroll stays put).
 * Null during the lead-in before the first span.
 */
export function activeSentenceAt(index: KaraokeIndex, tMs: number): SentenceSpan | null {
  const i = lastStartedIdx(index.spans, tMs);
  if (i < 0) return null;
  const span = index.spans[i]!;
  // Past the end of the last span (plus grace): nothing is active anymore.
  if (i === index.spans.length - 1 && tMs >= span.endMs + FINAL_WORD_HOLD_MS) return null;
  return span;
}

/** Where tapping a sentence should seek to on this track (null if unknown). */
export function seekTargetForSentence(index: KaraokeIndex, sentenceId: string): number | null {
  const span = index.spans.find((s) => s.sentenceId === sentenceId);
  return span ? span.startMs : null;
}

/**
 * Where to resume after switching tracks: the start of the sentence that was
 * active on the old track, resolved on the new track — different voices pace
 * differently, so restarting the current sentence beats a raw-time carryover.
 * Falls back to proportional time when either side lacks the sentence.
 */
export function mapPositionAcrossTracks(
  from: KaraokeIndex,
  to: KaraokeIndex,
  fromMs: number,
): number {
  const active = activeSentenceAt(from, fromMs);
  if (active) {
    const target = seekTargetForSentence(to, active.sentenceId);
    if (target != null) return target;
  }
  if (from.durationMs <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, fromMs / from.durationMs));
  return Math.round(ratio * to.durationMs);
}
