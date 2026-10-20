import { sql } from 'drizzle-orm';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories, type Repositories } from '@/db/repositories';
import type { SumrakDB } from '@/db/types';

import { writeSetting } from '../engine';
import { runSync, type RunStats } from '../run';
import type { SyncClient } from '../wire';

export interface Phone {
  name: string;
  deviceId: string;
  db: SumrakDB;
  repos: Repositories;
  client: SyncClient;
  sync: () => Promise<RunStats>;
}

export async function makePhone(
  name: string,
  deviceId: string,
  client: SyncClient,
): Promise<Phone> {
  const db = createTestDb();
  await writeSetting(db, 'sync.deviceId', deviceId);
  await db.run(sql`DELETE FROM sync_outbox`); // setup writes are device-local anyway
  const repos = createRepositories(db);
  return { name, deviceId, db, repos, client, sync: () => runSync(db, client, deviceId) };
}
