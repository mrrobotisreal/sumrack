import * as React from 'react';
import { AppState } from 'react-native';

import { onConnectivityRegained } from './connectivity';
import { pumpImportAnnotateQueue } from './import-annotate';
import { pumpFeedbackQueue } from './journal-feedback';

/**
 * Queue worker triggers (mirrors T07's useAutoSync): pump queued journal-
 * feedback and import-annotation requests on app start, on return to
 * foreground, and the moment connectivity comes back — the acceptance path
 * "queued offline → auto-submits when online" runs through the
 * connectivity listener here. Both pumps join concurrent runs and treat
 * offline as a quiet skip, so firing eagerly is always safe.
 */
export function useAiQueueWorker() {
  React.useEffect(() => {
    const pumpAll = () => {
      void pumpFeedbackQueue();
      void pumpImportAnnotateQueue();
    };
    pumpAll();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') pumpAll();
    });
    const unsubscribeNet = onConnectivityRegained(pumpAll);
    return () => {
      appState.remove();
      unsubscribeNet();
    };
  }, []);
}
