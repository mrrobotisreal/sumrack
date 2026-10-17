import * as Network from 'expo-network';
import * as React from 'react';

/**
 * The small shared "am I online" utility the ticket asks for. T07's sync
 * orchestrator inlines its own expo-network check (it also needs the
 * Wi-Fi/cellular distinction); AI features share this one instead.
 *
 * Semantics match sync: only a definite `isInternetReachable === false`
 * counts as offline — unknown/probe-failed states are treated as online
 * and let the request itself decide (design §3.1: never block on a maybe).
 */
export async function isOnline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return !(state && state.isInternetReachable === false);
}

/**
 * Fire `callback` whenever connectivity (re)appears. Returns unsubscribe.
 * Used by the AI queue worker to auto-submit queued journal requests the
 * moment the device reconnects (acceptance: airplane-mode → online test).
 */
export function onConnectivityRegained(callback: () => void): () => void {
  let wasOffline = false;
  const sub = Network.addNetworkStateListener((state) => {
    const offline = state.isInternetReachable === false;
    if (wasOffline && !offline) callback();
    wasOffline = offline;
  });
  return () => sub.remove();
}

/**
 * Live online flag for UI that must look disabled offline (the hotel's «Объясни ещё», T90 D9).
 * Same semantics as `isOnline`; starts optimistic and follows network changes.
 */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    void isOnline().then((v) => alive && setOnline(v));
    const sub = Network.addNetworkStateListener((state) =>
      setOnline(state.isInternetReachable !== false),
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return online;
}
