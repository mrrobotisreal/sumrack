import { sql } from 'drizzle-orm';
import * as React from 'react';
import { AppState } from 'react-native';

import { db } from '@/db';
import { useAccount } from '@/features/account/store';
import { onConnectivityRegained } from '@/features/ai/connectivity';

import { hydrateSyncStore, syncNow } from './service';

/** Debounce after the outbox grows while foregrounded (T104 J). */
export const OUTBOX_DEBOUNCE_MS = 20_000;
const POLL_MS = 5_000;

async function outboxHead(): Promise<number> {
  const rows = await db.all<{ m: number | null }>(sql`SELECT MAX(id) AS m FROM sync_outbox`);
  return rows[0]?.m ?? 0;
}

/**
 * Lifecycle host (mounted next to AuthSession): hydrates the sync store, then
 * fires a run on launch/sign-in, app foreground, connectivity regained, and
 * 20 s after the outbox grew while the app is in the foreground. Every call
 * goes through the single-flight orchestrator, so over-triggering is cheap.
 */
export function SyncHost() {
  const uid = useAccount((s) => s.user?.uid ?? null);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    void hydrateSyncStore().then(() => setHydrated(true));
  }, []);

  React.useEffect(() => {
    if (!hydrated || !uid) return;
    void syncNow('sign-in');
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncNow('foreground');
    });
    const offConn = onConnectivityRegained(() => void syncNow('connectivity'));

    let lastHead = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    const poll = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void outboxHead().then((head) => {
        if (!alive) return;
        if (lastHead === -1) {
          lastHead = head;
          return;
        }
        if (head > lastHead) {
          lastHead = head;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void syncNow('outbox'), OUTBOX_DEBOUNCE_MS);
        }
      });
    }, POLL_MS);

    return () => {
      alive = false;
      sub.remove();
      offConn();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [hydrated, uid]);

  return null;
}
