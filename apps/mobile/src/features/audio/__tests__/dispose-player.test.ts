import { describe, expect, it, vi } from 'vitest';

import { disposePlayer, type DisposablePlayer } from '../dispose-player';

/**
 * ISS-005: a fake expo-audio player that behaves like a SharedObject — every
 * call after `release()` throws, the way `UsingReleasedSharedObjectException`
 * does on Android.
 */
function fakePlayer(opts: { throwOn?: string[] } = {}) {
  const log: string[] = [];
  let released = false;
  let playing = true;
  const call = (name: string) => {
    if (released) throw new Error(`${name} after release`);
    log.push(name);
    if (opts.throwOn?.includes(name)) throw new Error(`${name} failed`);
  };
  const player = {
    log,
    get playing() {
      return playing;
    },
    get released() {
      return released;
    },
    pause: vi.fn(() => {
      call('pause');
      playing = false;
    }),
    clearLockScreenControls: vi.fn(() => call('clearLockScreen')),
    remove: vi.fn(() => call('remove')),
    release: vi.fn(() => {
      call('release');
      released = true;
    }),
  };
  return player satisfies DisposablePlayer;
}

function fakeSubscription(log: string[], name = 'unsubscribe') {
  return { remove: vi.fn(() => void log.push(name)) };
}

describe('disposePlayer (ISS-005)', () => {
  it('tears a playing player down in order: pause → unsubscribe → clear lock screen → remove → release', () => {
    const player = fakePlayer();
    const sub = fakeSubscription(player.log);
    expect(disposePlayer(player, { subscriptions: [sub], lockScreenActive: true })).toBe(true);
    expect(player.log).toEqual(['pause', 'unsubscribe', 'clearLockScreen', 'remove', 'release']);
    expect(player.playing).toBe(false);
    expect(player.released).toBe(true);
  });

  it('skips the lock-screen step when the player never owned the controls', () => {
    const player = fakePlayer();
    disposePlayer(player);
    expect(player.log).toEqual(['pause', 'remove', 'release']);
    expect(player.clearLockScreenControls).not.toHaveBeenCalled();
  });

  it('a failing step never skips the rest, and each failure is reported', () => {
    const player = fakePlayer({ throwOn: ['pause', 'clearLockScreen', 'remove'] });
    const sub = {
      remove: vi.fn(() => {
        throw new Error('sub failed');
      }),
    };
    const onError = vi.fn();
    disposePlayer(player, { subscriptions: [sub], lockScreenActive: true, onError });
    expect(player.log).toEqual(['pause', 'clearLockScreen', 'remove', 'release']);
    expect(sub.remove).toHaveBeenCalledOnce();
    expect(player.released).toBe(true);
    expect(onError.mock.calls.map(([step]) => step)).toEqual([
      'pause',
      'unsubscribe',
      'clearLockScreen',
      'remove',
    ]);
  });

  it('is idempotent: a second dispose touches nothing (a released player throws on any call)', () => {
    const player = fakePlayer();
    const onError = vi.fn();
    expect(disposePlayer(player, { onError })).toBe(true);
    expect(disposePlayer(player, { onError, lockScreenActive: true })).toBe(false);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.release).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('null / undefined players and empty subscription slots are no-ops', () => {
    expect(disposePlayer(null)).toBe(false);
    expect(disposePlayer(undefined)).toBe(false);
    const player = fakePlayer();
    disposePlayer(player, { subscriptions: [null, undefined] });
    expect(player.log).toEqual(['pause', 'remove', 'release']);
  });
});
