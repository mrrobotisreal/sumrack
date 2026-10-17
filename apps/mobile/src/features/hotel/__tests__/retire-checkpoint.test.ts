import { describe, expect, it, vi } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { importPack } from '@/db/importer';
import { createSettingsRepo, SETTING_KEYS } from '@/db/repositories/settings';
import { checkpointResults, packs, syncState } from '@/db/schema';
import type { Manifest } from '@sumrak/schema';
import storiesPack from '@sumrak/schema/fixtures/packs/a1-creepypasta-001/pack.json';
import { eq } from 'drizzle-orm';

import { diffManifest, RETIRED_PACKS } from '@/features/sync/sync-core';

import { RETIRED_CHECKPOINT_PACK, retireCheckpointOnce } from '../retire-checkpoint';

const trackMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track: trackMock }));

/**
 * T89 (D18): `a1-checkpoint-001` is retired once. Installed → removed with
 * `pack_removed {source:'m25-retire'}`; checkpoint_results kept; a second run is
 * a no-op; the sync diff never reinstalls it.
 */

describe('retireCheckpointOnce', () => {
  it('removes an installed checkpoint pack once, keeps its results, and records the event', async () => {
    const db = createTestDb();
    // removePack keys only on the pack id, so a valid stories pack stands in for the retired checkpoint.
    await importPack(db, { ...storiesPack, id: RETIRED_CHECKPOINT_PACK } as never);
    await db.insert(checkpointResults).values({
      id: 'cp-1',
      checkpointPackId: RETIRED_CHECKPOINT_PACK,
      scorePercent: 80,
      passed: true,
      completedAt: 1,
    });

    trackMock.mockClear();
    expect(await retireCheckpointOnce(db)).toBe(true);

    expect(await db.select().from(packs).where(eq(packs.id, RETIRED_CHECKPOINT_PACK))).toEqual([]);
    expect(await db.select().from(checkpointResults)).toHaveLength(1);
    expect(trackMock).toHaveBeenCalledWith('pack_removed', {
      packId: RETIRED_CHECKPOINT_PACK,
      source: 'm25-retire',
    });
    expect(await createSettingsRepo(db).get(SETTING_KEYS.hotelRetiredCheckpoint)).toBe(true);
  });

  it('is idempotent: a second run is a no-op and does not re-remove', async () => {
    const db = createTestDb();
    await retireCheckpointOnce(db);
    trackMock.mockClear();
    expect(await retireCheckpointOnce(db)).toBe(false);
    expect(trackMock).not.toHaveBeenCalledWith('pack_removed', expect.anything());
  });

  it('a fresh install (not installed) sets the flag and records no removal', async () => {
    const db = createTestDb();
    trackMock.mockClear();
    expect(await retireCheckpointOnce(db)).toBe(false);
    expect(trackMock).not.toHaveBeenCalledWith('pack_removed', expect.anything());
    expect(await createSettingsRepo(db).get(SETTING_KEYS.hotelRetiredCheckpoint)).toBe(true);
  });

  it('a removed pack that the manifest still lists is never reinstalled by the sync diff', () => {
    expect(RETIRED_PACKS.has(RETIRED_CHECKPOINT_PACK)).toBe(true);
    const manifest = {
      version: 1,
      packs: [
        {
          id: RETIRED_CHECKPOINT_PACK,
          version: 1,
          type: 'checkpoint',
          level: 'A1',
          files: [{ path: 'pack.json', sha256: 'a'.repeat(64), bytes: 1 }],
        },
      ],
    } as unknown as Manifest;
    const diff = diffManifest(manifest, []);
    expect(diff.toInstall).toEqual([]);
    expect(diff.toUpdate).toEqual([]);
  });

  it('the sync-state row of a retired pack is removed along with its content', async () => {
    const db = createTestDb();
    await importPack(db, { ...storiesPack, id: RETIRED_CHECKPOINT_PACK } as never);
    expect(await db.select().from(syncState).where(eq(syncState.packId, RETIRED_CHECKPOINT_PACK))).toHaveLength(1);
    await retireCheckpointOnce(db);
    expect(await db.select().from(syncState).where(eq(syncState.packId, RETIRED_CHECKPOINT_PACK))).toEqual([]);
  });
});
