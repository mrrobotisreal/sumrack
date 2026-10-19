/**
 * The auth gate rule (T102, ACCOUNTS_AND_SYNC §3) — pure so it is tested.
 * The gate never blocks local data: a signed-in session persists offline
 * (Firebase keeps it), and «Продолжить без аккаунта» opts out until the
 * person signs in from Settings.
 */
export type AuthStatus = 'initializing' | 'signed_in' | 'signed_out';

export function shouldShowAuth(opts: {
  status: AuthStatus;
  skipped: boolean;
  /** The current route is already an auth route. */
  onAuthRoute: boolean;
}): boolean {
  if (opts.status !== 'signed_out') return false;
  if (opts.skipped) return false;
  return !opts.onAuthRoute;
}
