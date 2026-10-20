import { sql } from 'drizzle-orm';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';

import { db, repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { idToken } from '@/features/account/auth-service';
import { deviceName, ensureDeviceId, useAccount } from '@/features/account/store';
import { isOnline } from '@/features/ai/connectivity';
import { evaluateMotivation } from '@/features/motivation/service';
import { requestWidgetRefresh } from '@/features/motivation/widget-bus';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';

import { HttpSyncClient, isValidBaseUrl, normalizeBaseUrl } from './client';
import { readSetting, writeSetting } from './engine';
import { linkDevice, linkModeFor, type LinkMode } from './first-link';
import { createOrchestrator, type Trigger } from './orchestrator';
import { useSyncStore } from './store';
import type { WireMe } from './wire';

/**
 * On-device wiring of the sync orchestrator (T104): real db, Firebase token,
 * expo-network, React Query, widget and motivation refresh, analytics.
 */
function client(): HttpSyncClient {
  return new HttpSyncClient({
    baseUrl: useSyncStore.getState().serverUrl,
    token: (force) => idToken(force),
  });
}

const orchestrator = createOrchestrator({
  db,
  client,
  deviceId: ensureDeviceId,
  deviceInfo: () => ({
    name: deviceName(),
    model: deviceName(),
    appVersion: String(Constants.expoConfig?.version ?? ''),
  }),
  uid: () => useAccount.getState().user?.uid ?? null,
  online: isOnline,
  now: Date.now,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  onStatus: (patch) => useSyncStore.getState().set(patch),
  onRunStarted: (trigger) => track('sync_run_started', { trigger }),
  onRunCompleted: (s) => {
    track('sync_run_completed', {
      pushed: s.pushed,
      pulled: s.pulled,
      merged: s.merged,
      rebuiltCards: s.rebuiltCards,
      parked: s.parked,
      ms: s.ms,
      pages: s.pages,
    });
    // Sampled: the first 20 conflicts per run. Table + kind only, never row data.
    for (const c of s.conflicts.slice(0, 20)) track('sync_conflict', { tbl: c.tbl, kind: c.kind });
  },
  onRunFailed: (i) => track('sync_run_failed', i),
  afterApply: () => {
    void queryClient.invalidateQueries();
    requestWidgetRefresh();
    // Goal/streak/achievement re-evaluation against the merged totals.
    void evaluateMotivation().catch(() => undefined);
  },
});

export function syncNow(trigger: Trigger = 'manual') {
  return orchestrator.run(trigger);
}

export const refreshPendingCount = () => orchestrator.refreshPending();

/** Load device-local sync prefs into the status store (called when the host mounts). */
export async function hydrateSyncStore(): Promise<void> {
  const [lastSyncAt, linked, url] = await Promise.all([
    repos.settings.get<number>(SETTING_KEYS.syncLastSyncAt),
    repos.settings.get<boolean>(SETTING_KEYS.syncLinked),
    repos.settings.get<string>(SETTING_KEYS.syncServerUrl),
  ]);
  useSyncStore.getState().set({
    lastSyncAt: typeof lastSyncAt === 'number' ? lastSyncAt : null,
    linked: linked === true,
    serverUrl: normalizeBaseUrl(url),
  });
  await orchestrator.refreshPending();
}

/** Settings → «Сервер»: validate with GET /v1/me, then persist. Returns the server's view. */
export async function checkServer(candidate: string): Promise<WireMe> {
  const url = normalizeBaseUrl(candidate);
  if (!isValidBaseUrl(url)) throw new Error('Неверный адрес · not a valid http(s) URL');
  const me = await new HttpSyncClient({ baseUrl: url, token: (f) => idToken(f) }).me();
  return me;
}

export async function saveServerUrl(candidate: string): Promise<void> {
  const url = normalizeBaseUrl(candidate);
  await writeSetting(db, SETTING_KEYS.syncServerUrl, url);
  useSyncStore.getState().set({ serverUrl: url });
}

export async function isLinked(): Promise<boolean> {
  return (await readSetting<boolean>(db, SETTING_KEYS.syncLinked)) === true;
}

/**
 * T105 «Связать этот телефон»: the safety copy, then link + the first run.
 * The copy is a plain SQLite snapshot (`VACUUM INTO`) in the app's own
 * documents dir — no passphrase needed, restorable by adb — taken BEFORE a
 * single row leaves the phone. Then the outbox is seeded with every synced
 * row (first-link.ts) and a normal run pushes it and merges the account's
 * rows in. Returns the snapshot name and the seeded row count.
 */
export async function linkThisPhone(): Promise<{
  snapshot: string;
  seeded: number;
  mode: LinkMode;
}> {
  const uid = useAccount.getState().user?.uid;
  if (!uid) throw new Error('Сначала войдите · sign in first');
  const me = await client().me();
  const mode = linkModeFor(me);
  const t0 = Date.now();
  const snapshot = `sumrak-prelink-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const dir = new Directory(Paths.document, 'prelink');
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, snapshot).uri.replace(/^file:\/\//, '');
  await db.run(sql`VACUUM INTO ${target}`);
  const { seeded } = await linkDevice(db, uid, Date.now(), mode);
  useSyncStore.getState().set({ linked: true });
  track('sync_first_link', { mode, rows: seeded, ms: Date.now() - t0 });
  void syncNow('sign-in');
  return { snapshot, seeded, mode };
}
