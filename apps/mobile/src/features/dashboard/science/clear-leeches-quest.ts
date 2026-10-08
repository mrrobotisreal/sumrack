/**
 * The `clear-leeches` daily-quest kind (T38 → registers with T34's quest
 * registry when T34 lands — T34 was not built when T38 shipped, so the kind
 * ships as this pure contract and T34 wires it in; recorded decision).
 *
 * SEMANTICS (recorded):
 * - **available** when the inbox is non-empty at the moment the day's quest
 *   is picked;
 * - the day's **flagged set** is snapshotted at assignment (card ids);
 * - **complete** when no card of that snapshot is still visible in the inbox
 *   — each one was drilled out of the leech rule (enough non-Again reviews
 *   pushed Agains out of the last 10) or dismissed. Leeches that appear
 *   later the same day do not extend the target.
 * - progress = cleared / snapshot size.
 */

export interface ClearLeechesProgress {
  cleared: number;
  target: number;
  complete: boolean;
}

export function isClearLeechesAvailable(visibleLeechCount: number): boolean {
  return visibleLeechCount > 0;
}

export function clearLeechesProgress(
  snapshot: readonly string[],
  visibleNow: ReadonlySet<string>,
): ClearLeechesProgress {
  const remaining = snapshot.filter((id) => visibleNow.has(id)).length;
  const cleared = snapshot.length - remaining;
  return { cleared, target: snapshot.length, complete: snapshot.length > 0 && remaining === 0 };
}
