export interface TimedSegment {
  startMs: number;
  endMs: number;
}

/**
 * Index of the segment containing `ms` (FULL_STORY_LISTEN §5.3). A segment owns
 * [startMs, nextStartMs): inter-part silence belongs to the part before it,
 * `ms` before the first start -> 0, past the last end -> last index.
 * Binary search; segments are sorted and non-overlapping.
 */
export function partAt(segments: readonly TimedSegment[], ms: number): number {
  if (segments.length === 0) return 0;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.startMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
