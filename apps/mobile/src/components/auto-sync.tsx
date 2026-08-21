import { useAutoSync } from '@/features/sync/use-auto-sync';

/**
 * Renders nothing; mounts the throttled content-sync auto-check (T07).
 * Must sit inside DbProvider — sync reads settings and sync_state.
 */
export function AutoSync() {
  useAutoSync();
  return null;
}
