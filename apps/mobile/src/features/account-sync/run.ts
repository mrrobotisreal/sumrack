import type { SumrakDB } from '@/db/types';

import { SYNC_SCHEMA_VERSION, PULL_PAGE } from './config';
import {
  ackPush,
  applyPage,
  collectPush,
  createCtx,
  readSetting,
  rebuildDirtyCards,
  countParked,
  type Conflict,
} from './engine';
import type { SyncClient } from './wire';

export interface RunStats {
  pushed: number;
  pulled: number;
  merged: number;
  rebuiltCards: number;
  parked: number;
  pages: number;
  ms: number;
  conflicts: Conflict[];
}

export type RunStage = 'push' | 'pull' | 'apply';

export class SyncRunError extends Error {
  constructor(
    public readonly stage: RunStage,
    public readonly cause: unknown,
  ) {
    super(`sync ${stage} failed`);
    this.name = 'SyncRunError';
  }
}

async function pushAll(db: SumrakDB, client: SyncClient, deviceId: string): Promise<number> {
  let pushed = 0;
  for (let i = 0; i < 10_000; i++) {
    const batch = await collectPush(db, deviceId);
    if (batch.acks.length === 0) break;
    if (batch.changes.length > 0) {
      try {
        await client.push({ deviceId, schemaVersion: SYNC_SCHEMA_VERSION, changes: batch.changes });
      } catch (e) {
        throw new SyncRunError('push', e);
      }
      pushed += batch.changes.length;
    }
    await ackPush(db, batch.acks, deviceId);
  }
  return pushed;
}

/**
 * One full sync run against `client`: push the outbox, pull every page
 * (one transaction each, cursor written inside it), rebuild FSRS cards that
 * gained foreign reviews, then push what the merge itself changed. Throws a
 * `SyncRunError` carrying the failing stage; partial progress is durable
 * (acked pushes are gone from the outbox, applied pages advanced the cursor).
 */
export async function runSync(
  db: SumrakDB,
  client: SyncClient,
  deviceId: string,
  opts: { pageSize?: number; applyOwn?: boolean; now?: () => number } = {},
): Promise<RunStats> {
  const t0 = (opts.now ?? Date.now)();
  const stats: RunStats = {
    pushed: 0, pulled: 0, merged: 0, rebuiltCards: 0, parked: 0, pages: 0, ms: 0, conflicts: [],
  };
  stats.pushed += await pushAll(db, client, deviceId);

  const ctx = createCtx(db, deviceId, { applyOwn: opts.applyOwn });
  let cursor = (await readSetting<number>(db, 'sync.cursor')) ?? 0;
  for (let guard = 0; guard < 100_000; guard++) {
    let page;
    try {
      page = await client.pull(cursor, opts.pageSize ?? PULL_PAGE);
    } catch (e) {
      throw new SyncRunError('pull', e);
    }
    try {
      const r = await applyPage(ctx, page.changes, page.nextSince);
      stats.pulled += page.changes.length;
      stats.merged += r.merged;
      stats.conflicts.push(...r.conflicts);
    } catch (e) {
      throw new SyncRunError('apply', e);
    }
    stats.pages++;
    cursor = page.nextSince;
    // Hand the JS thread back between pages so a big pull never freezes the UI.
    await new Promise<void>((r) => setTimeout(r, 0));
    if (!page.hasMore) break;
  }

  try {
    stats.rebuiltCards = await rebuildDirtyCards(db);
  } catch (e) {
    throw new SyncRunError('apply', e);
  }
  stats.pushed += await pushAll(db, client, deviceId);
  stats.parked = await countParked(db);
  stats.ms = (opts.now ?? Date.now)() - t0;
  return stats;
}
