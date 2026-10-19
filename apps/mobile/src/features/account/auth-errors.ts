/**
 * Firebase Auth / Google Sign-In error code → the message the auth screen
 * shows (T102). Russian first, an English caption under it — the app's
 * bilingual convention. Pure, so the table is unit-tested.
 */
export interface AuthErrorCopy {
  ru: string;
  en: string;
  /** Which input the message belongs to (the screen highlights it). */
  field?: 'email' | 'password' | 'confirm';
}

const COPY: Record<string, AuthErrorCopy> = {
  'auth/invalid-email': {
    ru: 'Похоже, в адресе ошибка.',
    en: 'That email address looks wrong.',
    field: 'email',
  },
  'auth/missing-email': { ru: 'Введите email.', en: 'Enter your email.', field: 'email' },
  'auth/user-not-found': {
    ru: 'Аккаунт с таким email не найден.',
    en: 'No account with that email.',
    field: 'email',
  },
  'auth/wrong-password': {
    ru: 'Неверный пароль.',
    en: 'Wrong password.',
    field: 'password',
  },
  'auth/invalid-credential': {
    ru: 'Неверный email или пароль.',
    en: 'Wrong email or password.',
    field: 'password',
  },
  'auth/invalid-login-credentials': {
    ru: 'Неверный email или пароль.',
    en: 'Wrong email or password.',
    field: 'password',
  },
  'auth/email-already-in-use': {
    ru: 'Этот email уже зарегистрирован — войдите.',
    en: 'That email already has an account — sign in instead.',
    field: 'email',
  },
  'auth/weak-password': {
    ru: 'Слишком простой пароль — минимум 8 символов.',
    en: 'Password too weak — at least 8 characters.',
    field: 'password',
  },
  'auth/too-many-requests': {
    ru: 'Слишком много попыток. Подождите немного.',
    en: 'Too many attempts. Wait a little and try again.',
  },
  'auth/network-request-failed': {
    ru: 'Нет связи. Проверьте интернет.',
    en: 'No connection. Check your internet.',
  },
  'auth/user-disabled': { ru: 'Этот аккаунт отключён.', en: 'This account is disabled.' },
  'auth/operation-not-allowed': {
    ru: 'Этот способ входа выключен в Firebase.',
    en: 'This sign-in method is disabled in Firebase.',
  },
  'auth/account-exists-with-different-credential': {
    ru: 'Этот email уже связан с другим способом входа.',
    en: 'That email is linked to a different sign-in method.',
  },
  // @react-native-google-signin statusCodes
  IN_PROGRESS: { ru: 'Вход уже идёт…', en: 'Sign-in already in progress…' },
  PLAY_SERVICES_NOT_AVAILABLE: {
    ru: 'Нужны сервисы Google Play.',
    en: 'Google Play services are required.',
  },
  DEVELOPER_ERROR: {
    ru: 'Google-вход не настроен для этой сборки (SHA-1 в Firebase).',
    en: "Google sign-in isn't configured for this build (SHA-1 in Firebase).",
  },
  // Local validation (never sent to Firebase)
  'local/email-format': {
    ru: 'Похоже, в адресе ошибка.',
    en: 'That email address looks wrong.',
    field: 'email',
  },
  'local/password-short': {
    ru: 'Минимум 8 символов.',
    en: 'At least 8 characters.',
    field: 'password',
  },
  'local/password-mismatch': {
    ru: 'Пароли не совпадают.',
    en: "Passwords don't match.",
    field: 'confirm',
  },
};

const FALLBACK: AuthErrorCopy = {
  ru: 'Что-то пошло не так. Попробуйте ещё раз.',
  en: 'Something went wrong. Try again.',
};

/** Pull a code off a Firebase / google-signin / plain error, if it has one. */
export function errorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
  }
  return null;
}

export function authErrorCopy(err: unknown): AuthErrorCopy {
  const code = errorCode(err);
  // google-signin reports DEVELOPER_ERROR as the numeric "10" on Android.
  if (code === '10') return COPY.DEVELOPER_ERROR!;
  return (code && COPY[code]) || FALLBACK;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthMode = 'sign_in' | 'sign_up';

/** Client-side checks before any network call. Returns a local/* code or null. */
export function validateCredentials(
  mode: AuthMode,
  email: string,
  password: string,
  confirm: string,
): string | null {
  if (!EMAIL_RE.test(email.trim())) return 'local/email-format';
  if (mode === 'sign_up') {
    if (password.length < 8) return 'local/password-short';
    if (password !== confirm) return 'local/password-mismatch';
  } else if (password.length === 0) {
    return 'local/password-short';
  }
  return null;
}
