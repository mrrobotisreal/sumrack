import { eq } from 'drizzle-orm';

import { syncState } from '../schema';
import type { SumrakDB } from '../types';

export type SyncStateRow = typeof syncState.$inferSelect;
export type PackSource = 'bundled' | 'github' | 'local-file';

/**
 * User-owned record of installed packs (survives content wipes so restore
 * knows what to re-download, design §9). Written by the importer; read by
 * content sync (T07) to diff against the remote manifest.
 */
export function createSyncStateRepo(db: SumrakDB) {
  return {
    async getInstalled(packId: string): Promise<SyncStateRow | null> {
      const rows = await db.select().from(syncState).where(eq(syncState.packId, packId)).limit(1);
      return rows[0] ?? null;
    },

    async listInstalled(): Promise<SyncStateRow[]> {
      return db.select().from(syncState);
    },

    async recordInstalled(packId: string, version: number, source: PackSource): Promise<void> {
      const now = Date.now();
      await db
        .insert(syncState)
        .values({ packId, version, source, installedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: syncState.packId,
          set: { version, source, updatedAt: now },
        });
    },

    async removeInstalled(packId: string): Promise<void> {
      await db.delete(syncState).where(eq(syncState.packId, packId));
    },
  };
}

export type SyncStateRepo = ReturnType<typeof createSyncStateRepo>;
