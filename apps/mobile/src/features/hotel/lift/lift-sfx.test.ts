import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLiftSfx } from './lift-sfx';

// vi.mock calls below are hoisted above the import.
/** ISS-005: the Lift's unmount must silence (pause) and free (release) every SFX player. */

const created: { source: unknown; log: string[]; playing: boolean }[] = [];

vi.mock('./lift-sfx-sources', () => ({
  LIFT_SFX_SOURCES: { close: 1, ride: 2, ding: 3, open: 4, flicker: 5, drop: 6, blocked: 7 },
}));
vi.mock('@/db', () => ({ repos: {} }));
vi.mock('@/services/error-log', () => ({ logError: vi.fn() }));
vi.mock('expo-audio', () => ({
  createAudioPlayer: (source: unknown) => {
    const rec = { source, log: [] as string[], playing: false };
    created.push(rec);
    return {
      loop: false,
      volume: 1,
      setPlaybackRate: () => {},
      seekTo: () => Promise.resolve(),
      play: () => {
        rec.playing = true;
        rec.log.push('play');
      },
      pause: () => {
        rec.playing = false;
        rec.log.push('pause');
      },
      remove: () => void rec.log.push('remove'),
      release: () => void rec.log.push('release'),
    };
  },
}));

beforeEach(() => {
  created.length = 0;
});

describe('lift sfx dispose (ISS-005)', () => {
  it('a looping ride hum still playing at unmount is paused, removed and released', () => {
    const sfx = createLiftSfx(true);
    sfx.startRide();
    sfx.play('ding');
    sfx.dispose();
    const ride = created.find((p) => p.source === 2)!;
    expect(ride.playing).toBe(false);
    expect(ride.log).toEqual(['play', 'pause', 'remove', 'release']);
    const ding = created.find((p) => p.source === 3)!;
    expect(ding.log.slice(-3)).toEqual(['pause', 'remove', 'release']);
  });

  it('a second dispose touches nothing', () => {
    const sfx = createLiftSfx(true);
    sfx.startRide();
    sfx.dispose();
    sfx.dispose();
    expect(created[0]!.log.filter((l) => l === 'release')).toHaveLength(1);
  });
});
