import type { SumrakDB } from '@/db/types';

import { pendingCount, readSetting, writeSetting } from './engine';
import { relinkForAccount } from './first-link';
import { runSync, SyncRunError, type RunStats } from './run';
import type { SyncErrorInfo, SyncStatus } from './store';
import { SyncHttpError, type SyncClient, type WireDeviceRequest } from './wire';

/**
 * Orchestration (T104 J), free of native imports so it is unit-tested with a
 * fake clock/network: single-flight, preconditions (signed in + linked +
 * online), POST /v1/devices once per sign-in, error classification, and
 * exponential backoff on 5xx/network. A 401 (after the client's one forced
 * refresh) stops with `lastError` until the next explicit trigger. It NEVER
 * signs the person out: the Firebase session persists until «Выйти» in
 * Settings (Mitch, 2026-10-20) — the next run fetches a fresh token.
 */
export type Trigger = 'launch' | 'foreground' | 'connectivity' | 'outbox' | 'manual' | 'sign-in';

export interface OrchestratorDeps {
  db: SumrakDB;
  client: () => SyncClient & { registerDevice(req: WireDeviceRequest): Promise<unknown> };
  deviceId: () => Promise<string>;
  deviceInfo: () => WireDeviceRequest extends infer R ? Omit<R & object, 'deviceId'> : never;
  uid: () => string | null;
  online: () => Promise<boolean>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  onStatus: (patch: {
    status?: SyncStatus;
    lastSyncAt?: number | null;
    pending?: number;
    lastError?: SyncErrorInfo | null;
  }) => void;
  onRunStarted: (trigger: Trigger) => void;
  onRunCompleted: (stats: RunStats) => void;
  onRunFailed: (info: { stage: string; code: string; attempt: number }) => void;
  /** Called after any run that applied remote data (invalidate queries, widget, motivation). */
  afterApply: (stats: RunStats) => void;
}

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const backoffMs = (attempt: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));

export function classifyError(e: unknown): {
  stage: string;
  code: string;
  http: number;
  fatal: boolean;
  message: string;
} {
  const stage = e instanceof SyncRunError ? e.stage : 'token';
  const cause = e instanceof SyncRunError ? e.cause : e;
  const status =
    cause instanceof SyncHttpError
      ? cause.status
      : typeof (cause as { status?: unknown })?.status === 'number'
        ? (cause as { status: number }).status
        : -1;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (status === 401)
    return {
      stage,
      code: 'http_401',
      http: 401,
      fatal: true,
      message: 'Сервер не принял вход — повторим позже · server rejected the token, will retry',
    };
  if (status === 0) return { stage, code: 'network', http: 0, fatal: false, message };
  if (status >= 500) return { stage, code: `http_${status}`, http: status, fatal: false, message };
  if (status >= 400) return { stage, code: `http_${status}`, http: status, fatal: true, message };
  return { stage, code: 'error', http: status, fatal: false, message };
}

export function createOrchestrator(deps: OrchestratorDeps) {
  let inflight: Promise<RunStats | null> | null = null;
  let attempt = 0;
  let retryTimer: unknown = null;

  async function refreshPending() {
    deps.onStatus({ pending: await pendingCount(deps.db) });
  }

  async function ensureRegistered(uid: string, deviceId: string): Promise<void> {
    const done = await readSetting<string>(deps.db, 'sync.registeredUid');
    if (done === uid) return;
    await deps.client().registerDevice({ deviceId, ...deps.deviceInfo() } as WireDeviceRequest);
    await writeSetting(deps.db, 'sync.registeredUid', uid);
  }

  async function execute(trigger: Trigger): Promise<RunStats | null> {
    const uid = deps.uid();
    if (!uid) return null;
    if ((await readSetting<boolean>(deps.db, 'sync.linked')) !== true) {
      await refreshPending();
      return null;
    }
    if (!(await deps.online())) {
      deps.onStatus({ status: 'offline' });
      await refreshPending();
      return null;
    }
    if (retryTimer != null) {
      deps.clearTimer(retryTimer);
      retryTimer = null;
    }
    deps.onStatus({ status: 'syncing', lastError: null });
    deps.onRunStarted(trigger);
    try {
      const deviceId = await deps.deviceId();
      // Linked under a different account (sign-out + sign-in as someone
      // else): never keep syncing the old account's bookkeeping — reset it
      // and send this phone's whole history to the account now signed in.
      if ((await readSetting<string>(deps.db, 'sync.linkedUid')) !== uid) {
        await relinkForAccount(deps.db, uid, deps.now());
      }
      await ensureRegistered(uid, deviceId);
      const stats = await runSync(deps.db, deps.client(), deviceId);
      attempt = 0;
      const at = deps.now();
      await writeSetting(deps.db, 'sync.lastSyncAt', at);
      deps.onStatus({ status: 'idle', lastSyncAt: at, lastError: null });
      await refreshPending();
      deps.onRunCompleted(stats);
      if (stats.pulled > 0 || stats.rebuiltCards > 0) deps.afterApply(stats);
      return stats;
    } catch (e) {
      attempt++;
      const c = classifyError(e);
      deps.onRunFailed({ stage: c.stage, code: c.code, attempt });
      const offline = c.code === 'network';
      deps.onStatus({
        status: offline ? 'offline' : 'error',
        lastError: { stage: c.stage, code: c.code, message: c.message },
      });
      await refreshPending();
      if (!c.fatal) {
        retryTimer = deps.setTimer(() => {
          retryTimer = null;
          void run('outbox');
        }, backoffMs(attempt));
      }
      return null;
    }
  }

  /** Single-flight: a call while a run is in progress joins it. */
  function run(trigger: Trigger): Promise<RunStats | null> {
    if (inflight) return inflight;
    if (trigger === 'manual' || trigger === 'sign-in') attempt = 0;
    inflight = execute(trigger).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return { run, refreshPending, isRunning: () => inflight != null };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
