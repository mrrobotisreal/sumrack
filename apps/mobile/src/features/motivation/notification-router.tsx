import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import * as React from 'react';

import { track } from '@/services/analytics';

import { screenFromResponse } from './notifications';

/**
 * Notification deep-linking (T19): tapping a reminder routes to Today,
 * tapping new-content routes to the Library. Handles both the warm-app
 * listener and the cold-start "last response" (the tap that launched us).
 * Payloads are Zod-gated in screenFromResponse — malformed data no-ops.
 */
export function NotificationRouter() {
  const router = useRouter();
  const handledRef = React.useRef<string | null>(null);

  const handle = React.useCallback(
    (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handledRef.current === id) return;
      handledRef.current = id;
      const screen = screenFromResponse(response);
      if (!screen) return;
      track('notification_tapped', { screen, id });
      router.push(screen === 'library' ? '/(tabs)/library' : '/(tabs)');
    },
    [router],
  );

  React.useEffect(() => {
    // Cold start: the tap that launched the app.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handle(response);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [handle]);

  return null;
}
