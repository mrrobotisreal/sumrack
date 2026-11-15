/**
 * ISS-005: the one way to get rid of an expo-audio player whose owner is going
 * away (screen unmount, service stop, controller dispose).
 *
 * On Android (expo-audio 57) `remove()` only drops the player from the
 * module's map: the ExoPlayer keeps playing and is now invisible to the
 * module's own focus/background/destroy handling. `release()` (the
 * SharedObject method) frees the native player on the next main-looper hop,
 * and any later call on it throws «Cannot use shared object that was already
 * released». So the order is:
 *
 *   pause → status-listener unsubscribe(s) → clear lock-screen controls (if
 *   this player owned them) → remove → release
 *
 * Every step is guarded so one failure cannot skip the rest, and a player
 * that was already disposed here is never touched again.
 */

/** The slice of expo-audio's `AudioPlayer` the teardown touches. */
export interface DisposablePlayer {
  pause(): void;
  remove(): void;
  /** SharedObject.release(): frees the native player now (not at GC). */
  release(): void;
  clearLockScreenControls?(): void;
}

export type DisposeStep = 'pause' | 'unsubscribe' | 'clearLockScreen' | 'remove' | 'release';

export interface DisposeOptions {
  /** Status-listener subscriptions to drop (empty slots are skipped). */
  subscriptions?: readonly ({ remove(): void } | null | undefined | void)[];
  /** The player currently owns the lock-screen / media-session controls. */
  lockScreenActive?: boolean;
  /** Each failed step is reported here; the teardown carries on regardless. */
  onError?: (step: DisposeStep, error: unknown) => void;
}

const disposed = new WeakSet<object>();

/** Returns true when this call tore the player down, false for null / already disposed. */
export function disposePlayer(
  player: DisposablePlayer | null | undefined,
  opts: DisposeOptions = {},
): boolean {
  if (!player || disposed.has(player)) return false;
  disposed.add(player);
  const step = (name: DisposeStep, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      opts.onError?.(name, error);
    }
  };
  step('pause', () => player.pause());
  for (const sub of opts.subscriptions ?? []) {
    if (sub) step('unsubscribe', () => sub.remove());
  }
  if (opts.lockScreenActive && player.clearLockScreenControls) {
    step('clearLockScreen', () => player.clearLockScreenControls!());
  }
  step('remove', () => player.remove());
  step('release', () => player.release());
  return true;
}
