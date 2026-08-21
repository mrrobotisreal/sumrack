import * as React from 'react';
import { AppState } from 'react-native';

import { runSync } from './sync-service';

/**
 * Throttled auto-check (ticket item 6): kick a sync when the app launches
 * and whenever it returns to the foreground. runSync itself enforces the
 * 15-minute throttle, joins concurrent runs, and treats offline or
 * not-configured as quiet skips — so this hook can fire unconditionally
 * and never blocks or surfaces anything on startup (offline-first §3.1).
 *
 * Mounted inside DbProvider (sync reads settings/sync_state immediately).
 */
export function useAutoSync() {
  React.useEffect(() => {
    void runSync({ trigger: 'auto' });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runSync({ trigger: 'auto' });
    });
    return () => sub.remove();
  }, []);
}
