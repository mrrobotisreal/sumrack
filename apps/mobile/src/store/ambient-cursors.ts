import { create } from 'zustand';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import type { AmbientThemeId } from '@/features/ambient-audio/beds';
import {
  parseAmbientCursors,
  type AmbientCursor,
  type AmbientCursors,
} from '@/features/ambient-audio/cursors';
import { logError } from '@/services/error-log';

// Serialize writes so rapid snapshots cannot persist in the wrong order
// (same pattern as `ambient-prefs.ts`). Each write stores the full map.
let pendingWrite = Promise.resolve();

function persist(cursors: AmbientCursors) {
  pendingWrite = pendingWrite
    .then(() => repos.settings.set(SETTING_KEYS.ambientCursors, cursors))
    .catch((error) => logError('manual', error));
}

/**
 * Per-theme resume cursors (M15/T48). The ambient controller reads a theme's
 * cursor when it starts and writes snapshots as it plays; T49's Settings
 * panel reads them for «Up next» and resets them.
 */
export const useAmbientCursors = create<{
  cursors: AmbientCursors;
  /**
   * Bumped by every `resetCursor` (T49): the ambient host watches it and asks
   * the controller to restart that theme from bed 1 @ 0 if it is the one
   * loaded — the engine's same-theme branch would otherwise resume in place.
   */
  resetRevision: number;
  lastReset: AmbientThemeId | null;
  setCursor(theme: AmbientThemeId, cursor: AmbientCursor): void;
  resetCursor(theme: AmbientThemeId): void;
}>((set, get) => ({
  cursors: {},
  resetRevision: 0,
  lastReset: null,
  setCursor(theme, cursor) {
    const cursors = parseAmbientCursors({ ...get().cursors, [theme]: cursor });
    set({ cursors });
    persist(cursors);
  },
  resetCursor(theme) {
    const cursors = { ...get().cursors };
    delete cursors[theme];
    set({ cursors, resetRevision: get().resetRevision + 1, lastReset: theme });
    persist(cursors);
  },
}));

export async function hydrateAmbientCursorsFromDb(): Promise<void> {
  useAmbientCursors.setState({
    cursors: parseAmbientCursors(await repos.settings.get(SETTING_KEYS.ambientCursors)),
  });
}
