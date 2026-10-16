import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { sanitizeExpansion, toggleKey } from '@/features/library/expansion';

/**
 * T86: Library accordion expansion (THREE_BODY_SERIES.md §2 rule 4) — the
 * library-prefs.ts pattern: DbProvider hydrates once after migrations (and
 * restore-service re-hydrates after a restore); writes are fire-and-forget
 * under SETTING_KEYS.libraryExpanded. The continue-target auto-expand is NOT
 * stored here — it is an ephemeral per-mount set in the Library screen.
 */
interface LibraryExpansionState {
  /** Expanded section keys, newest toggle last. */
  keys: string[];
  /** Toggle one section; persists. */
  toggle: (key: string, expanded: boolean) => void;
  /** Replace all keys (toolbar expand/collapse); persists. */
  setAll: (keys: string[]) => void;
}

function persist(keys: readonly string[]) {
  void repos.settings.set(SETTING_KEYS.libraryExpanded, { v: 1, keys: [...keys] });
}

export const useLibraryExpansion = create<LibraryExpansionState>((set, get) => ({
  keys: [],
  toggle: (key, expanded) => {
    const next = toggleKey(get().keys, key, expanded);
    set({ keys: next });
    persist(next);
  },
  setAll: (keys) => {
    const next = sanitizeExpansion({ v: 1, keys });
    set({ keys: next });
    persist(next);
  },
}));

/** Load the persisted expansion after the DB is ready (DbProvider + post-restore). */
export async function hydrateLibraryExpansionFromDb(): Promise<void> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.libraryExpanded);
  // No row yet → every section stays collapsed (the default).
  if (stored === null || stored === undefined) {
    useLibraryExpansion.setState({ keys: [] });
    return;
  }
  useLibraryExpansion.setState({ keys: sanitizeExpansion(stored) });
}
