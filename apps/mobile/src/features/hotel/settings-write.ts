import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * ISS-006: an optimistic settings write that an OLDER in-flight read cannot
 * undo. `hotel.building` / `hotel.lastFloor` are read with the default
 * staleTime 0, so a mount or a focus invalidation (Today invalidates
 * `['hotel']`) starts a re-read; if that read began before the row was written
 * it resolved with the OLD value after the optimistic `setQueryData` — the
 * warm deep link «switched» (and logged it) but the screen flipped back.
 *
 * Cancel any read in flight (synchronous: the query reverts at once), set the
 * cache (synchronous — the screen sees the value this render), write the row,
 * then cancel a read that started meanwhile and re-apply. `update` must be
 * idempotent.
 */
export async function writeSettingThrough<T>(
  qc: QueryClient,
  queryKey: QueryKey,
  update: (current: T | undefined) => T,
  persist: (value: T) => Promise<void>,
): Promise<void> {
  void qc.cancelQueries({ queryKey, exact: true });
  const value = qc.setQueryData<T>(queryKey, (current) => update(current)) as T;
  try {
    await persist(value);
  } catch {
    // A failed write only loses the choice; this visit still shows it.
  }
  void qc.cancelQueries({ queryKey, exact: true });
  qc.setQueryData<T>(queryKey, (current) => update(current));
}
