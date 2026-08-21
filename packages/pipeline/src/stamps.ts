import type { WordStamp } from '@sumrak/schema';
import type { NarrationText } from './narration.ts';

/**
 * Character-timestamp → WordStamp mapping (T09, design §8 step 3 + §11).
 *
 * ElevenLabs returns per-character times for the text it spoke. We map those
 * onto our token character spans with *tolerant* matching (the provider may
 * normalize characters slightly), then enforce the hard invariants the ticket
 * demands programmatically:
 *
 * - stamps are monotonic (non-decreasing starts, no overlapping spans) —
 *   small overlaps are clamped, real violations mark the whole track
 *   untrusted, and an untrusted track ships with NO stamps rather than bad
 *   ones (T10's karaoke has a sentence-level fallback for exactly this);
 * - every stamp is a positive-width span inside the track duration;
 * - coverage of non-punctuation tokens is measured and reported (>95% is the
 *   ticket's acceptance bar).
 */

/** Per-character alignment as returned by ElevenLabs (times in seconds). */
export interface CharAlignment {
  characters: string[];
  startSeconds: number[];
  endSeconds: number[];
}

export interface StampResult {
  /** The stamps to ship. Empty when the alignment was untrusted. */
  stamps: WordStamp[];
  /** True when the mapping passed all invariants and stamps are usable. */
  trusted: boolean;
  /** Non-punctuation token count in the narration. */
  wordTokens: number;
  /** How many of them received a stamp (before any untrusted wipe). */
  stampedTokens: number;
  /** stampedTokens / wordTokens (1 when there are no word tokens). */
  coverage: number;
  /** Fraction of narration characters matched against the provider alignment. */
  matchedCharRatio: number;
  /** Human-readable problems found (also present when trusted, e.g. clamps). */
  issues: string[];
}

/** Overlaps up to this size are clamped silently; anything larger is a violation. */
const OVERLAP_CLAMP_MS = 60;
/** Below this matched-character ratio the provider text diverged too far to trust. */
const MIN_MATCHED_CHAR_RATIO = 0.95;
/** How far ahead the tolerant matcher searches to resynchronize after a mismatch. */
const RESYNC_WINDOW = 24;

/**
 * Tolerantly align our narration text against the provider's character list.
 * Returns, for each narration char index, the matching provider index or -1.
 *
 * Fast path: the provider echoes our text exactly (the un-normalized
 * `alignment` field usually does). Slow path: a greedy two-pointer walk that
 * skips unmatched characters on either side, resynchronizing on the next
 * agreeing character within a small window — enough for the occasional
 * normalization drift, while a genuinely different text fails the
 * matched-ratio gate downstream.
 */
export function alignCharacters(text: string, providerChars: readonly string[]): Int32Array {
  const chars = Array.from(text);
  const map = new Int32Array(chars.length).fill(-1);

  if (chars.length === providerChars.length && chars.every((c, i) => c === providerChars[i])) {
    for (let i = 0; i < chars.length; i++) map[i] = i;
    return map;
  }

  let j = 0;
  for (let i = 0; i < chars.length && j < providerChars.length;) {
    if (chars[i] === providerChars[j]) {
      map[i] = j;
      i++;
      j++;
      continue;
    }
    // Mismatch: look for the nearest resync point within the window, trying
    // provider-side skips first (normalization usually inserts characters).
    let resynced = false;
    for (let d = 1; d <= RESYNC_WINDOW && !resynced; d++) {
      if (j + d < providerChars.length && chars[i] === providerChars[j + d]) {
        j += d; // provider inserted d characters we never sent
        resynced = true;
      } else if (i + d < chars.length && chars[i + d] === providerChars[j]) {
        i += d; // provider dropped d of our characters
        resynced = true;
      }
    }
    if (!resynced) {
      // Give up on this pair and move both — the ratio gate judges the damage.
      i++;
      j++;
    }
  }
  return map;
}

/** Map a rendered track's character alignment onto the narration's tokens. */
export function mapAlignmentToStamps(
  narration: NarrationText,
  alignment: CharAlignment,
  durationMs: number,
): StampResult {
  const issues: string[] = [];
  const { characters, startSeconds, endSeconds } = alignment;
  if (characters.length !== startSeconds.length || characters.length !== endSeconds.length) {
    return untrusted(narration, 0, [
      `provider alignment arrays disagree in length (${characters.length} chars, ${startSeconds.length} starts, ${endSeconds.length} ends)`,
    ]);
  }

  const charMap = alignCharacters(narration.text, characters);
  const textChars = Array.from(narration.text);
  // Ratio over non-whitespace characters — separators carry no timing value.
  let significant = 0;
  let matched = 0;
  // Cumulative char offset → index into charMap is by *code point*; token
  // spans are in UTF-16 units, so build a UTF-16 → code point index map.
  const utf16ToCp = new Int32Array(narration.text.length).fill(-1);
  {
    let cp = 0;
    let u = 0;
    for (const ch of textChars) {
      utf16ToCp[u] = cp;
      if (ch.length === 2) utf16ToCp[u + 1] = cp;
      u += ch.length;
      cp++;
    }
  }
  textChars.forEach((ch, cpIdx) => {
    if (/\s/.test(ch)) return;
    significant++;
    if (charMap[cpIdx] !== -1) matched++;
  });
  const matchedCharRatio = significant === 0 ? 1 : matched / significant;
  if (matchedCharRatio < MIN_MATCHED_CHAR_RATIO) {
    return untrusted(narration, matchedCharRatio, [
      `only ${(matchedCharRatio * 100).toFixed(1)}% of narration characters matched the provider alignment (need ≥ ${MIN_MATCHED_CHAR_RATIO * 100}%)`,
    ]);
  }

  // Build one candidate stamp per word token from its matched characters.
  const wordSpans = narration.spans.filter((s) => !s.isPunct);
  const stamps: WordStamp[] = [];
  let stampedTokens = 0;
  for (const span of wordSpans) {
    let minS = Infinity;
    let maxE = -Infinity;
    for (let u = span.start; u < span.end; u++) {
      const cpIdx = utf16ToCp[u]!;
      const p = charMap[cpIdx]!;
      if (p === -1) continue;
      const s = startSeconds[p]!;
      const e = endSeconds[p]!;
      if (s < minS) minS = s;
      if (e > maxE) maxE = e;
    }
    if (!Number.isFinite(minS) || !Number.isFinite(maxE)) continue; // token had no matched chars
    let startMs = Math.round(minS * 1000);
    let endMs = Math.round(maxE * 1000);
    if (endMs > durationMs) {
      if (startMs >= durationMs) continue; // fully past the audio — unusable
      endMs = durationMs;
    }
    if (endMs <= startMs) continue; // zero-width after rounding — drop, don't fabricate
    stampedTokens++;
    stamps.push({ sentenceId: span.sentenceId, tokenIndex: span.tokenIndex, startMs, endMs });
  }

  // Monotonicity: non-decreasing starts, non-overlapping spans (hard invariant).
  let violations = 0;
  let clamps = 0;
  for (let i = 1; i < stamps.length; i++) {
    const prev = stamps[i - 1]!;
    const cur = stamps[i]!;
    if (cur.startMs < prev.startMs) {
      violations++;
      continue;
    }
    if (cur.startMs < prev.endMs) {
      const overlap = prev.endMs - cur.startMs;
      if (overlap <= OVERLAP_CLAMP_MS && cur.startMs > prev.startMs) {
        prev.endMs = cur.startMs; // clamp the tail of the previous word
        clamps++;
      } else {
        violations++;
      }
    }
  }
  if (clamps > 0) issues.push(`clamped ${clamps} overlap(s) ≤ ${OVERLAP_CLAMP_MS}ms`);
  if (violations > 0) {
    return untrusted(narration, matchedCharRatio, [
      ...issues,
      `${violations} monotonicity violation(s) beyond the ${OVERLAP_CLAMP_MS}ms clamp tolerance — dropping all stamps for this track (karaoke will fall back to sentence level)`,
    ]);
  }

  const wordTokens = wordSpans.length;
  const coverage = wordTokens === 0 ? 1 : stampedTokens / wordTokens;
  return {
    stamps,
    trusted: true,
    wordTokens,
    stampedTokens,
    coverage,
    matchedCharRatio,
    issues,
  };
}

function untrusted(
  narration: NarrationText,
  matchedCharRatio: number,
  issues: string[],
): StampResult {
  const wordTokens = narration.spans.filter((s) => !s.isPunct).length;
  return {
    stamps: [],
    trusted: false,
    wordTokens,
    stampedTokens: 0,
    coverage: 0,
    matchedCharRatio,
    issues,
  };
}
