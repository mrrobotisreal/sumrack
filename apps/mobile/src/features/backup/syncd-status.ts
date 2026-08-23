import { create } from 'zustand';

import { track } from '@/services/analytics';

import { friendlyBackupMessage, toBackupError } from './errors';
import { SyncdClient } from './syncd-client';
import { getSyncdConfig, getSyncdToken } from './syncd-config';

/**
 * Ephemeral syncd reachability state (T21). The tailnet host being away is
 * a normal state of the world (VPN off, server down, traveling) — this
 * store lets the UI say "unreachable" plainly without any run failing or
 * blocking, and analytics record every flip.
 */

interface SyncdStatusState {
  /** null = never checked this process. */
  reachable: boolean | null;
  checkedAt: number | null;
  checking: boolean;
}

export const useSyncdStatus = create<SyncdStatusState>(() => ({
  reachable: null,
  checkedAt: null,
  checking: false,
}));

/** Record an observed reachability fact (from any syncd request's outcome). */
export function reportSyncdReachability(reachable: boolean): void {
  const prev = useSyncdStatus.getState().reachable;
  if (prev !== reachable) {
    track('syncd_reachability_changed', { reachable });
  }
  useSyncdStatus.setState({ reachable, checkedAt: Date.now(), checking: false });
}

export interface SyncdCheckResult {
  ok: boolean;
  /** Plain-language problem when not ok (unreachable, bad token, …). */
  error?: string;
  backupCount?: number;
}

/**
 * Active connection test (settings button + screen mounts): an authed
 * listing doubles as the health check — syncd deliberately has no
 * unauthenticated endpoint.
 */
export async function checkSyncdReachability(): Promise<SyncdCheckResult> {
  const config = await getSyncdConfig();
  const token = await getSyncdToken();
  if (!config || !token) {
    return { ok: false, error: 'Set the host and token first.' };
  }
  useSyncdStatus.setState({ checking: true });
  try {
    const backups = await new SyncdClient(config.host, token).listBackups();
    reportSyncdReachability(true);
    return { ok: true, backupCount: backups.length };
  } catch (err) {
    const e = toBackupError(err);
    // A 401/HTTP error means the server answered — the network path works.
    reportSyncdReachability(e.code !== 'syncd-unreachable');
    return { ok: false, error: friendlyBackupMessage(e) };
  }
}
