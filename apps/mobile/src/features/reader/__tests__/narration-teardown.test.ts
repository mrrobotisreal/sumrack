import { describe, expect, it, vi } from 'vitest';

import { teardownNarration, type NarrationTeardownPlayer } from '../narration-teardown';

/** A SharedObject-like fake: any call after `release()` throws (ISS-005). */
function fakeNarrationPlayer(opts: { playing: boolean; currentTime?: number }) {
  const log: string[] = [];
  let released = false;
  let playing = opts.playing;
  const guard = (name: string) => {
    if (released) throw new Error(`${name} after release`);
  };
  const player = {
    log,
    get playing() {
      guard('playing');
      return playing;
    },
    get currentTime() {
      guard('currentTime');
      return opts.currentTime ?? 0;
    },
    get released() {
      return released;
    },
    pause: vi.fn(() => {
      guard('pause');
      log.push('pause');
      playing = false;
    }),
    clearLockScreenControls: vi.fn(() => {
      guard('clearLockScreen');
      log.push('clearLockScreen');
    }),
    remove: vi.fn(() => {
      guard('remove');
      log.push('remove');
    }),
    release: vi.fn(() => {
      guard('release');
      log.push('release');
      released = true;
    }),
  };
  return player satisfies NarrationTeardownPlayer;
}

describe('teardownNarration (ISS-005: leaving the reader while narration plays)', () => {
  it('pauses, unsubscribes, clears the lock screen, removes and releases — and reports the stop', () => {
    const player = fakeNarrationPlayer({ playing: true, currentTime: 12.3456 });
    const subscription = { remove: vi.fn(() => void player.log.push('unsubscribe')) };
    const onStopped = vi.fn();
    teardownNarration(player, { subscription, lockScreenActive: true, onStopped });
    expect(player.log).toEqual(['pause', 'unsubscribe', 'clearLockScreen', 'remove', 'release']);
    expect(player.released).toBe(true);
    expect(onStopped).toHaveBeenCalledExactlyOnceWith(12_346);
  });

  it('a paused narration is still released, but no stop is reported', () => {
    const player = fakeNarrationPlayer({ playing: false, currentTime: 3 });
    const onStopped = vi.fn();
    teardownNarration(player, { subscription: null, lockScreenActive: false, onStopped });
    expect(player.log).toEqual(['pause', 'remove', 'release']);
    expect(onStopped).not.toHaveBeenCalled();
  });

  it('no player (narration never started) is a no-op', () => {
    const onStopped = vi.fn();
    teardownNarration(null, { subscription: null, lockScreenActive: false, onStopped });
    expect(onStopped).not.toHaveBeenCalled();
  });

  it('a second teardown of the same (released) player touches nothing', () => {
    const player = fakeNarrationPlayer({ playing: true });
    const onStopped = vi.fn();
    teardownNarration(player, { subscription: null, lockScreenActive: true, onStopped });
    teardownNarration(player, { subscription: null, lockScreenActive: true, onStopped });
    expect(player.release).toHaveBeenCalledOnce();
    expect(onStopped).toHaveBeenCalledOnce();
  });
});
