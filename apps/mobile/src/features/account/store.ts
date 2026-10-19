import * as Device from 'expo-device';
import { create } from 'zustand';

import { repos } from '@/db';
import { newId } from '@/db/ids';
import { SETTING_KEYS } from '@/db/repositories/settings';

import type { AuthStatus } from './gate';

/**
 * Account state (T102). `status` starts 'initializing' until Firebase has
 * restored (or not) a persisted session; the gate never redirects before.
 * `skipped` mirrors the `auth.skipped` setting (local-only mode).
 */
export interface AccountUser {
  uid: string;
  email: string | null;
  provider: 'password' | 'google';
}

interface AccountState {
  status: AuthStatus;
  user: AccountUser | null;
  skipped: boolean;
  setUser: (user: AccountUser | null) => void;
  setSkipped: (skipped: boolean) => void;
}

export const useAccount = create<AccountState>((set) => ({
  status: 'initializing',
  user: null,
  skipped: false,
  setUser: (user) => set({ user, status: user ? 'signed_in' : 'signed_out' }),
  setSkipped: (skipped) => {
    set({ skipped });
    void repos.settings.set(SETTING_KEYS.authSkipped, skipped);
  },
}));

/** Load persisted account prefs after the DB is ready (DbProvider). */
export async function hydrateAccountFromDb(): Promise<void> {
  const skipped = await repos.settings.get<unknown>(SETTING_KEYS.authSkipped);
  useAccount.setState({ skipped: skipped === true });
  await ensureDeviceId();
}

/** This phone's stable sync id (device-local; generated once). */
export async function ensureDeviceId(): Promise<string> {
  const existing = await repos.settings.get<unknown>(SETTING_KEYS.syncDeviceId);
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const id = `dev-${newId()}`;
  await repos.settings.set(SETTING_KEYS.syncDeviceId, id);
  return id;
}

/** Default device label, e.g. "Galaxy S24 Ultra" (Settings shows it). */
export function deviceName(): string {
  return Device.modelName ?? Device.deviceName ?? 'Android';
}
