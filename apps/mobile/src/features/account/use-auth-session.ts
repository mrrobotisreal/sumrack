import { usePathname, useRouter } from 'expo-router';
import * as React from 'react';

import { track } from '@/services/analytics';

import { onAuthChanged, providerOf } from './auth-service';
import { shouldShowAuth } from './gate';
import { useAccount } from './store';

/**
 * Mounted once under the root Stack (T102): mirrors Firebase's auth state
 * into the store and applies the gate — signed out + not skipped → /auth.
 * `ready` waits for the splash so the redirect never fights the intro.
 */
export function AuthSession({ ready }: { ready: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, skipped } = useAccount();

  React.useEffect(
    () =>
      onAuthChanged((user) => {
        useAccount
          .getState()
          .setUser(user ? { uid: user.uid, email: user.email, provider: providerOf(user) } : null);
      }),
    [],
  );

  React.useEffect(() => {
    if (!ready) return;
    if (shouldShowAuth({ status, skipped, onAuthRoute: pathname.startsWith('/auth') })) {
      track('auth_screen_viewed', { mode: 'sign_in', from: 'gate' });
      router.replace('/auth');
    }
  }, [ready, status, skipped, pathname, router]);

  return null;
}
