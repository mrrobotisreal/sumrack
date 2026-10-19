import { describe, expect, it } from 'vitest';

import { authErrorCopy, errorCode, validateCredentials } from '../auth-errors';
import { shouldShowAuth } from '../gate';

describe('T102 auth error copy', () => {
  it('maps Firebase codes to Russian + English, with the field to highlight', () => {
    expect(authErrorCopy({ code: 'auth/email-already-in-use' })).toMatchObject({
      field: 'email',
    });
    expect(authErrorCopy({ code: 'auth/invalid-credential' }).ru).toBe(
      'Неверный email или пароль.',
    );
    expect(authErrorCopy({ code: 'auth/network-request-failed' }).en).toMatch(/connection/);
  });

  it('google-signin numeric DEVELOPER_ERROR (10) explains the SHA-1 setup', () => {
    expect(authErrorCopy({ code: 10 }).en).toMatch(/SHA-1/);
    expect(authErrorCopy({ code: 'DEVELOPER_ERROR' }).en).toMatch(/SHA-1/);
  });

  it('unknown / code-less errors get the generic fallback', () => {
    expect(authErrorCopy(new Error('x')).ru).toMatch(/Попробуйте ещё раз/);
    expect(authErrorCopy({ code: 'auth/whatever' }).ru).toMatch(/Попробуйте ещё раз/);
    expect(errorCode(null)).toBeNull();
  });

  it('local validation: email shape, ≥ 8 chars + confirm on sign-up, non-empty on sign-in', () => {
    expect(validateCredentials('sign_in', 'nope', 'x', '')).toBe('local/email-format');
    expect(validateCredentials('sign_in', 'a@b.co', '', '')).toBe('local/password-short');
    expect(validateCredentials('sign_in', ' a@b.co ', 'short', '')).toBeNull();
    expect(validateCredentials('sign_up', 'a@b.co', 'short', 'short')).toBe('local/password-short');
    expect(validateCredentials('sign_up', 'a@b.co', 'longenough', 'different')).toBe(
      'local/password-mismatch',
    );
    expect(validateCredentials('sign_up', 'a@b.co', 'longenough', 'longenough')).toBeNull();
    expect(authErrorCopy({ code: 'local/password-mismatch' }).field).toBe('confirm');
  });
});

describe('T102 auth gate', () => {
  it('shows auth only when signed out, not skipped, and not already there', () => {
    expect(shouldShowAuth({ status: 'signed_out', skipped: false, onAuthRoute: false })).toBe(true);
    expect(shouldShowAuth({ status: 'signed_out', skipped: true, onAuthRoute: false })).toBe(false);
    expect(shouldShowAuth({ status: 'signed_out', skipped: false, onAuthRoute: true })).toBe(false);
    expect(shouldShowAuth({ status: 'signed_in', skipped: false, onAuthRoute: false })).toBe(false);
    // Never redirect before Firebase has restored a persisted session.
    expect(shouldShowAuth({ status: 'initializing', skipped: false, onAuthRoute: false })).toBe(
      false,
    );
  });
});
