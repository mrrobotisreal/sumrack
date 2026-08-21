import { useQuery } from '@tanstack/react-query';

import { repos } from '@/db';
import type { PackRow } from '@/db/repositories/content';
import type { SyncStateRow } from '@/db/repositories/sync-state';

export const syncQueryKeys = {
  installedPacks: ['sync-state', 'installed-packs'] as const,
};

export interface InstalledPack {
  state: SyncStateRow;
  /** Content row — null if content tables were wiped but sync_state survives (restore case). */
  pack: PackRow | null;
}

/** Installed packs for the management screen: sync_state joined with content. */
export function useInstalledPacks() {
  return useQuery({
    queryKey: syncQueryKeys.installedPacks,
    queryFn: async (): Promise<InstalledPack[]> => {
      const [states, packs] = await Promise.all([
        repos.syncState.listInstalled(),
        repos.content.listPacks(),
      ]);
      const byId = new Map(packs.map((p) => [p.id, p]));
      return states
        .map((state) => ({ state, pack: byId.get(state.packId) ?? null }))
        .sort((a, b) => a.state.packId.localeCompare(b.state.packId));
    },
  });
}
