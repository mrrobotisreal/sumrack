export interface AmbientPlayer {
  volume: number;
  loop: boolean;
  play(): void;
  pause(): void;
  remove(): void;
}

/** Owns one lazy player. A stale async setup must never start audible playback. */
export function createAmbientController(
  prepare: () => Promise<void>,
  createPlayer: () => AmbientPlayer,
  onError: (error: unknown) => void,
) {
  let player: AmbientPlayer | null = null;
  let revision = 0;
  let disposed = false;
  let preparation: Promise<void> | null = null;

  function pause() {
    if (!player) return;
    player.volume = 0;
    player.pause();
  }

  return {
    async update(active: boolean, volume: number) {
      const current = ++revision;
      if (disposed) return;
      try {
        if (!active || volume <= 0) {
          pause();
          return;
        }
        preparation ??= prepare();
        await preparation;
        if (disposed || revision !== current) return;
        player ??= createPlayer();
        player.loop = true;
        player.volume = volume;
        player.play();
      } catch (error) {
        preparation = null;
        try {
          pause();
        } catch {
          // Audio failure must not prevent studying.
        }
        onError(error);
      }
    },
    dispose() {
      disposed = true;
      revision++;
      try {
        pause();
        player?.remove();
      } catch (error) {
        onError(error);
      } finally {
        player = null;
      }
    },
  };
}
