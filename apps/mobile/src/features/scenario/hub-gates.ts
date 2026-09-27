import * as React from 'react';
import { useFocusEffect } from 'expo-router';

import { getMicPermission, requestMicPermission } from '@/features/pronunciation/recorder';
import { useAsrStore } from '@/features/pronunciation/asr-store';
import { useAssistStore } from '@/features/pronunciation/assist-store';
import { track } from '@/services/analytics';

/**
 * The hub's gates (T62, SPEAKING_SCENARIOS §9.1 / §12): the ASR model must be
 * installed and the mic granted before any Start; both are checked HERE and
 * never mid-run (the run screen assumes `ensureLoaded`). Reactive: the ASR
 * store flips when Settings installs/deletes the model; the mic permission
 * is re-read on every focus (the user may return from system settings).
 */

export type HubGate = 'asr-missing' | 'mic-denied' | null;

export interface HubGates {
  gate: HubGate;
  /** 'undetermined' ⇒ Start is allowed; the system dialog comes up on the first Start. */
  mic: 'granted' | 'undetermined' | 'denied' | 'unknown';
  asrInstalled: boolean;
  assistInstalled: boolean;
  /** Ask the OS for the mic (returns the new state). */
  requestMic: () => Promise<'granted' | 'undetermined' | 'denied'>;
}

export function useHubGates(): HubGates {
  const asrInstalled = useAsrStore((s) => s.installedBytes != null);
  const assistInstalled = useAssistStore((s) => s.installedBytes != null);
  const [mic, setMic] = React.useState<HubGates['mic']>('unknown');

  useFocusEffect(
    React.useCallback(() => {
      let live = true;
      void getMicPermission()
        .then((p) => {
          if (live) setMic(p);
        })
        .catch(() => {
          if (live) setMic('unknown');
        });
      return () => {
        live = false;
      };
    }, []),
  );

  const gate: HubGate = !asrInstalled ? 'asr-missing' : mic === 'denied' ? 'mic-denied' : null;
  const lastTracked = React.useRef<HubGate>(null);
  React.useEffect(() => {
    if (gate && lastTracked.current !== gate) track('scenario_gate_shown', { gate });
    lastTracked.current = gate;
  }, [gate]);

  const requestMic = React.useCallback(async () => {
    const p = await requestMicPermission();
    setMic(p);
    return p;
  }, []);

  return { gate, mic, asrInstalled, assistInstalled, requestMic };
}
