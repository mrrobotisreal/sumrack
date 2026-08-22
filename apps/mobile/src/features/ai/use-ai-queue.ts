import * as React from 'react';
import { AppState } from 'react-native';

import { onConnectivityRegained } from './connectivity';
import { pumpFeedbackQueue } from './journal-feedback';

/**
 * Queue worker triggers (mirrors T07's useAutoSync): pump queued journal-
 * feedback requests on app start, on return to foreground, and the moment
 * connectivity comes back — the acceptance path "queued offline →
 * auto-submits when online" runs through the connectivity listener here.
 * pumpFeedbackQueue joins concurrent runs and treats offline as a quiet
 * skip, so firing eagerly is always safe.
 */
export function useAiQueueWorker() {
  React.useEffect(() => {
    void pumpFeedbackQueue();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pumpFeedbackQueue();
    });
    const unsubscribeNet = onConnectivityRegained(() => void pumpFeedbackQueue());
    return () => {
      appState.remove();
      unsubscribeNet();
    };
  }, []);
}
