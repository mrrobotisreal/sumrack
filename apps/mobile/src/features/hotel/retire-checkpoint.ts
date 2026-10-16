import { removePack } from '@/db/importer';
import { createSettingsRepo, SETTING_KEYS } from '@/db/repositories/settings';
import { packs } from '@/db/schema';
import type { SumrakDB } from '@/db/types';
import { track } from '@/services/analytics';
import { eq } from 'drizzle-orm';

/** The retired checkpoint pack (HOTEL_PATH D18). */
export const RETIRED_CHECKPOINT_PACK = 'a1-checkpoint-001';

/**
 * One-time retirement of `a1-checkpoint-001` (T89, D18), run once at bootstrap:
 *
 * - idempotent: once `hotel.retiredCheckpoint` is set it does nothing;
 * - removes the pack's content via `removePack` only when it is installed;
 * - records `pack_removed {packId, source:'m25-retire'}` when it removes one;
 * - never touches `checkpoint_results` (past results stay, D18);
 * - sets the flag even when the pack was never installed, so a fresh install
 *   does not re-check every launch.
 *
 * Returns true when this call removed an installed pack.
 */
export async function retireCheckpointOnce(db: SumrakDB): Promise<boolean> {
  const settings = createSettingsRepo(db);
  if ((await settings.get<boolean>(SETTING_KEYS.hotelRetiredCheckpoint)) === true) return false;

  const installed = await db
    .select({ id: packs.id })
    .from(packs)
    .where(eq(packs.id, RETIRED_CHECKPOINT_PACK));
  const wasInstalled = installed.length > 0;
  if (wasInstalled) {
    await removePack(db, RETIRED_CHECKPOINT_PACK);
    track('pack_removed', { packId: RETIRED_CHECKPOINT_PACK, source: 'm25-retire' });
  }
  await settings.set(SETTING_KEYS.hotelRetiredCheckpoint, true);
  return wasInstalled;
}
