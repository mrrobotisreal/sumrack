import * as React from 'react';
import { AppState } from 'react-native';

import { db } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { localDateKey } from '@/db/repositories/stats';

import { probeActivitySince } from './activity-probe';
import { getBackupPrefs, getLastBackup, isBackupConfigured } from './config';
import { runBackup } from './service';

/**
 * Automatic backup triggers (ticket item 5). Deviation from §9's literal
 * "nightly" (recorded): the app has no background scheduler beyond T19's
 * notifications, so "nightly-when-online" is implemented as **at most one
 * automatic backup per local day, fired on app launch/foreground** — plus a
 * **significant-session** trigger when the app goes to background after
 * enough activity (see activity-probe.ts for the documented heuristic).
 * Every path funnels through runBackup, which quietly skips when
 * unconfigured/offline/disabled and joins concurrent runs — so this hook
 * fires unconditionally and never blocks anything (§3.1).
 */

/** Session-auto backups at most every 30 minutes. */
const SESSION_MIN_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Attempt throttle (device-found, first live session): while uploads FAIL
 * (e.g. PAT lacks write access, repo down), `lastBackup.github` never
 * advances, so without this every foreground/background would re-export and
 * re-fail. One automatic ATTEMPT per 10 minutes per process, success or not.
 */
const ATTEMPT_MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastAutoAttemptAt = 0;

function claimAutoAttempt(): boolean {
  const now = Date.now();
  if (now - lastAutoAttemptAt < ATTEMPT_MIN_INTERVAL_MS) return false;
  lastAutoAttemptAt = now;
  return true;
}

async function maybeDailyBackup(): Promise<void> {
  if (!(await isBackupConfigured())) return;
  if (!(await getBackupPrefs()).autoEnabled) return;
  const last = await getLastBackup(SETTING_KEYS.lastBackupGithub);
  if (last && localDateKey(new Date(last.at)) === localDateKey()) return; // already fresh today
  if (!claimAutoAttempt()) return;
  await runBackup({ trigger: 'daily-auto' });
}

async function maybeSessionBackup(): Promise<void> {
  if (!(await isBackupConfigured())) return;
  if (!(await getBackupPrefs()).autoEnabled) return;
  const last = await getLastBackup(SETTING_KEYS.lastBackupGithub);
  const lastAt = last?.at ?? 0;
  if (Date.now() - lastAt < SESSION_MIN_INTERVAL_MS) return;
  const probe = await probeActivitySince(db, lastAt);
  if (!probe.significant) return;
  if (!claimAutoAttempt()) return;
  await runBackup({ trigger: 'session-auto' });
}

/** Mounted inside DbProvider (reads settings immediately). */
export function useAutoBackup() {
  React.useEffect(() => {
    void maybeDailyBackup().catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void maybeDailyBackup().catch(() => {});
      // Android grants a short grace window on backgrounding — enough for a
      // small upload; a miss is retried by the next daily trigger anyway.
      if (state === 'background') void maybeSessionBackup().catch(() => {});
    });
    return () => sub.remove();
  }, []);
}
