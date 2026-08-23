import * as React from 'react';
import { AppState } from 'react-native';

import { replanReminders } from './notifications';

/**
 * Keeps scheduled reminders honest (T19): local notifications carry content
 * fixed at schedule time, so every return to the foreground recomputes the
 * plan (due counts and goal state may have changed — or the calendar day
 * rolled over). evaluateMotivation() also replans after every activity
 * change; this component covers the "app reopened after hours away" path.
 */
export function ReminderReplanner() {
  React.useEffect(() => {
    // Mount = app just became ready (cold start ends here too — AppState may
    // never emit 'active' for a launch that starts active).
    void replanReminders();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void replanReminders();
    });
    return () => sub.remove();
  }, []);
  return null;
}
