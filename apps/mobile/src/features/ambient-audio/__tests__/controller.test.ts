import { describe, expect, it, vi } from 'vitest';

import { createAmbientController } from '../controller';
import { parseAmbientPrefs } from '../preferences';

function fixture(prepare = () => Promise.resolve()) {
  const player = { volume: 1, loop: false, play: vi.fn(), pause: vi.fn(), remove: vi.fn() };
  const createPlayer = vi.fn(() => player);
  const error = vi.fn();
  const controller = createAmbientController(prepare, createPlayer, error);
  return { player, createPlayer, error, controller };
}

describe('ambient playback lifecycle', () => {
  it('loads lazily and reuses one looping player across pauses and volume changes', async () => {
    const { controller, createPlayer, player } = fixture();
    await controller.update(false, 0.08);
    expect(createPlayer).not.toHaveBeenCalled();
    await controller.update(true, 0.08);
    expect(player.loop).toBe(true);
    expect(player.volume).toBe(0.08);
    await controller.update(false, 0.08);
    expect(player.volume).toBe(0);
    expect(player.pause).toHaveBeenCalledOnce();
    await controller.update(true, 0.04);
    expect(createPlayer).toHaveBeenCalledOnce();
    expect(player.volume).toBe(0.04);
    controller.dispose();
    expect(player.remove).toHaveBeenCalledOnce();
  });

  it.each(['pause', 'dispose'])(
    'does not start after %s during pending native setup',
    async (action) => {
      let resolve!: () => void;
      const { controller, createPlayer } = fixture(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
      const pending = controller.update(true, 0.08);
      if (action === 'pause') await controller.update(false, 0.08);
      else controller.dispose();
      resolve();
      await pending;
      expect(createPlayer).not.toHaveBeenCalled();
    },
  );

  it('only applies the newest preference while setup is pending', async () => {
    let resolve!: () => void;
    const { controller, player } = fixture(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const first = controller.update(true, 0.08);
    const second = controller.update(true, 0.04);
    resolve();
    await Promise.all([first, second]);
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.volume).toBe(0.04);
  });

  it('treats zero volume as pause', async () => {
    const { controller, player } = fixture();
    await controller.update(true, 0.08);
    await controller.update(true, 0);
    expect(player.pause).toHaveBeenCalledOnce();
  });

  it('contains native errors and permits a later retry', async () => {
    const prepare = vi
      .fn()
      .mockRejectedValueOnce(new Error('audio unavailable'))
      .mockResolvedValue(undefined);
    const { controller, error, player } = fixture(prepare);
    await controller.update(true, 0.08);
    expect(error).toHaveBeenCalledOnce();
    expect(player.play).not.toHaveBeenCalled();
    await controller.update(true, 0.08);
    expect(player.play).toHaveBeenCalledOnce();
  });
});

describe('saved ambience preferences', () => {
  it('defaults to enabled and quiet, preserves false, and rejects corrupt values', () => {
    expect(parseAmbientPrefs(null)).toEqual({
      enabled: true,
      volume: 0.2,
      playDuringNarration: true,
    });
    expect(parseAmbientPrefs({ enabled: false, volume: 0.04 })).toEqual({
      enabled: false,
      volume: 0.04,
      playDuringNarration: true,
    });
    expect(parseAmbientPrefs({ enabled: 'false', volume: NaN })).toEqual({
      enabled: true,
      volume: 0.2,
      playDuringNarration: true,
    });
    expect(parseAmbientPrefs({ volume: Infinity }).volume).toBe(0.2);
    expect(parseAmbientPrefs({ volume: 10 }).volume).toBe(1);
    expect(parseAmbientPrefs({ volume: -1 }).volume).toBe(0);
  });
});
