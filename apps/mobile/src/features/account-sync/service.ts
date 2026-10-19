import Constants from 'expo-constants';

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
