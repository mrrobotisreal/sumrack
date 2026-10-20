import {
  createUserWithEmailAndPassword,
  getAuth,
  getIdToken,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from '@react-native-firebase/auth';
import { GoogleSignin, isCancelledResponse } from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';

/**
 * The one Firebase Auth seam (T102, ACCOUNTS_AND_SYNC §3). Screens and the
 * sync engine talk to this, never to the SDKs. Firebase persists the session
 * natively, so a signed-in phone stays signed in offline across launches.
 * Binding (Mitch, 2026-10-20): sign in once, stay signed in for good — the
 * ONLY sign-out path is «Выйти» in Settings (account-settings-section).
 * Never call signOut() from sync, error handling, restore or anywhere else.
 */
export type AuthUser = User;
export type AuthProviderKind = 'password' | 'google';

let googleConfigured = false;
function configureGoogle() {
  if (googleConfigured) return;
  // Written at prebuild by plugins/with-google-web-client-id.js from the
  // (gitignored) google-services.json — never hardcoded here.
  const webClientId = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
  GoogleSignin.configure(webClientId ? { webClientId } : {});
  googleConfigured = true;
}

export function currentUser(): AuthUser | null {
  return getAuth().currentUser;
}

export function onAuthChanged(cb: (user: AuthUser | null) => void): () => void {
  return onAuthStateChanged(getAuth(), cb);
}

export async function signUpEmail(email: string, password: string): Promise<AuthUser> {
  const cred = await createUserWithEmailAndPassword(getAuth(), email.trim(), password);
  // Sent, never required (design §3).
  void sendEmailVerification(cred.user).catch(() => undefined);
  return cred.user;
}

export async function signInEmail(email: string, password: string): Promise<AuthUser> {
  return (await signInWithEmailAndPassword(getAuth(), email.trim(), password)).user;
}

/** Google via Credential Manager → Firebase credential. null = the person cancelled. */
export async function signInGoogle(): Promise<{ user: AuthUser; isNewUser: boolean } | null> {
  configureGoogle();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (isCancelledResponse(res)) return null;
  const idToken = res.data.idToken;
  if (!idToken) throw Object.assign(new Error('no idToken'), { code: 'DEVELOPER_ERROR' });
  const cred = await signInWithCredential(getAuth(), GoogleAuthProvider.credential(idToken));
  return { user: cred.user, isNewUser: cred.additionalUserInfo?.isNewUser ?? false };
}

export async function sendReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getAuth(), email.trim());
}

export async function signOut(): Promise<void> {
  try {
    configureGoogle();
    await GoogleSignin.signOut();
  } catch {
    // Not signed in with Google — nothing to clear.
  }
  await firebaseSignOut(getAuth());
}

/** A fresh-enough Firebase ID token for syncd (`Authorization: Bearer`). */
export async function idToken(forceRefresh = false): Promise<string | null> {
  const user = currentUser();
  return user ? getIdToken(user, forceRefresh) : null;
}

export function providerOf(user: AuthUser): AuthProviderKind {
  return user.providerData.some((p) => p.providerId === 'google.com') ? 'google' : 'password';
}
