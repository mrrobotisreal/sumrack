import {
  disposePlayer,
  type DisposablePlayer,
  type DisposeStep,
} from '@/features/audio/dispose-player';

/** The narration player as the reader's unmount sees it. */
export interface NarrationTeardownPlayer extends DisposablePlayer {
  readonly playing: boolean;
  /** Seconds. */
  readonly currentTime: number;
}

/**
 * ISS-005: the reader's unmount. Before T10's teardown only `remove()`d the
 * player, so a playing narration kept sounding after Back (and a re-open
 * stacked a second copy). Reads the playing state + position first (nothing
 * may touch the player after release), then disposes it in the shared order.
 * `onStopped(positionMs)` fires only when a playing narration was cut off.
 */
export function teardownNarration(
  player: NarrationTeardownPlayer | null,
  opts: {
    subscription: { remove(): void } | null;
    lockScreenActive: boolean;
    onStopped: (positionMs: number) => void;
    onError?: (step: DisposeStep, error: unknown) => void;
  },
): void {
  if (!player) return;
  let wasPlaying = false;
  let positionMs = 0;
  try {
    wasPlaying = player.playing;
    positionMs = Math.max(0, Math.round(player.currentTime * 1000));
  } catch {
    // Already released (a second teardown): disposePlayer below is a no-op too.
  }
  const tornDown = disposePlayer(player, {
    subscriptions: [opts.subscription],
    lockScreenActive: opts.lockScreenActive,
    onError: opts.onError,
  });
  if (tornDown && wasPlaying) opts.onStopped(positionMs);
}
