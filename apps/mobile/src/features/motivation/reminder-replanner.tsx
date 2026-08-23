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
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void replanReminders();
    });
    return () => sub.remove();
  }, []);
  return null;
}
