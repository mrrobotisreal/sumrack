/**
 * Per-passage scroll memory (T76, TORFL_A2 §5.4) — PURE module state. A part
 * can hang 15 items on one ≈ 450-word passage (A2 reading P3); moving from
 * item 11 to 12 must not throw the reader back to the top, so the passage
 * panel stores its offset here keyed by `packId/storyId` and restores it when
 * the next item mounts the same story's panel. Cleared when the objective
 * runner leaves (subtest change / exit) so a fresh sitting starts at the top.
 */
const offsets = new Map<string, number>();

/** Offsets within a pixel of the top are "at the top" (no chip, nothing to restore). */
export const TOP_EPSILON = 24;

export const passageKey = (packId: string, storyId: string): string => `${packId}/${storyId}`;

export function rememberPassageOffset(key: string, y: number): void {
  if (y <= TOP_EPSILON) offsets.delete(key);
  else offsets.set(key, Math.round(y));
}

export function recallPassageOffset(key: string): number {
  return offsets.get(key) ?? 0;
}

export function clearPassageOffsets(): void {
  offsets.clear();
}

/** Show the «▲ к началу» chip once the reader is past the top. */
export function showToTop(y: number): boolean {
  return y > TOP_EPSILON * 3;
}
