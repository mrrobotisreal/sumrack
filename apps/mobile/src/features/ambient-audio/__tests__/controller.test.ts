import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AMBIENT_THEMES, type AmbientThemeId } from '../beds';
import {
  createAmbientController,
  CURSOR_SAVE_INTERVAL_MS,
  FADE_MS,
  FADE_STEPS,
  type AmbientPlayer,
  type AmbientStatus,
} from '../controller';
import type { AmbientCursor, AmbientCursors } from '../cursors';
import { parseAmbientPrefs } from '../preferences';

// The registry lives behind `require()`d Opus assets: stand in the ledger's
// index (1-based) per slug, exactly as `beds.test.ts` does, so `source` ids are
// 1 = creepy, 2/3 = GA1/GA2, 4/5 = motif 1/2, ... (see `beds.json`).
vi.mock('../sources', async () => {
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const file = nodePath.resolve(__dirname, '../../../../assets/audio/ambient/beds.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as { slug: string }[];
  return { AMBIENT_BED_SOURCES: Object.fromEntries(rows.map((r, i) => [r.slug, i + 1])) };
});

const THEMES = AMBIENT_THEMES;
const GA1_MS = AMBIENT_THEMES.news.beds[0]!.durationMs; // 67 207
const GA2_MS = AMBIENT_THEMES.news.beds[1]!.durationMs; // 124 327

interface FakePlayer extends AmbientPlayer {
  source: number;
  listeners: ((status: AmbientStatus) => void)[];
  /** Simulate a status tick. */
  emit(status: Partial<AmbientStatus>): void;
  playing: boolean;
  volumeLog: number[];
}

function fakePlayer(source: number, opts: { replaceThrows?: boolean } = {}): FakePlayer {
  const player: FakePlayer = {
    source,
    listeners: [],
    playing: false,
    volumeLog: [],
    loop: false,
    currentTime: 0,
    duration: 0,
    get volume() {
      return player.volumeLog[player.volumeLog.length - 1] ?? 1;
    },
    set volume(v: number) {
      player.volumeLog.push(v);
    },
    play: vi.fn(() => {
      player.playing = true;
    }),
    pause: vi.fn(() => {
      player.playing = false;
    }),
    remove: vi.fn(),
    replace: vi.fn((next: number) => {
      if (opts.replaceThrows) throw new Error('replace failed');
      player.source = next;
      player.currentTime = 0;
    }),
    seekTo: vi.fn(async (seconds: number) => {
      player.currentTime = seconds;
    }),
    addListener: vi.fn((_event, listener) => {
      player.listeners.push(listener);
      return {
        remove: () => {
          player.listeners = player.listeners.filter((l) => l !== listener);
        },
      };
    }),
    emit(status) {
      const full: AmbientStatus = {
        didJustFinish: false,
        playing: player.playing,
        currentTime: player.currentTime,
        ...status,
      };
      for (const l of [...player.listeners]) l(full);
    },
  };
  return player;
}

function fixture(
  options: {
    prepare?: () => Promise<void>;
    cursors?: AmbientCursors;
    replaceThrows?: boolean;
  } = {},
) {
  const cursors: AmbientCursors = { ...options.cursors };
  let player: FakePlayer | null = null;
  const createPlayer = vi.fn((source: number) => {
    player = fakePlayer(source, { replaceThrows: options.replaceThrows });
    return player;
  });
  const error = vi.fn();
  const saveCursor = vi.fn((theme: AmbientThemeId, cursor: AmbientCursor) => {
    cursors[theme] = cursor;
  });
  const onEvent = vi.fn();
  const controller = createAmbientController(
    options.prepare ?? (() => Promise.resolve()),
    createPlayer,
    error,
    {
      themes: THEMES,
      getCursor: (theme) => cursors[theme],
      saveCursor,
      onEvent,
      now: () => Date.now(),
    },
  );
  return {
    controller,
    createPlayer,
    error,
    saveCursor,
    onEvent,
    cursors,
    get player() {
      return player!;
    },
  };
}

/** Drain the fade timers (and any microtasks) so `update()` settles. */
async function settle() {
  await vi.advanceTimersByTimeAsync(FADE_MS + 50);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ambient playback lifecycle', () => {
  it('loads lazily, starts horror at bed 1 @ 0 looping, and reuses one player across pauses and volume changes', async () => {
    const f = fixture();
    await f.controller.update(false, 0.08, 'horror');
    expect(f.createPlayer).not.toHaveBeenCalled();
    const first = f.controller.update(true, 0.08, 'horror');
    await settle();
    await first;
    expect(f.createPlayer).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.player.loop).toBe(true);
    expect(f.player.seekTo).not.toHaveBeenCalled();
    expect(f.player.play).toHaveBeenCalledOnce();
    expect(f.player.volume).toBeCloseTo(0.08);
    expect(f.onEvent).toHaveBeenCalledExactlyOnceWith('ambient_theme_started', {
      theme: 'horror',
      bed: 'creepy-bg-music',
      resumedMs: 0,
    });
    await f.controller.update(false, 0.08, 'horror');
    expect(f.player.volume).toBe(0);
    expect(f.player.pause).toHaveBeenCalledOnce();
    // Same theme resume: instant, no fade, no new player, no new event.
    await f.controller.update(true, 0.04, 'horror');
    expect(f.createPlayer).toHaveBeenCalledOnce();
    expect(f.player.volume).toBe(0.04);
    expect(f.player.play).toHaveBeenCalledTimes(2);
    expect(f.onEvent).toHaveBeenCalledOnce();
    f.controller.dispose();
    expect(f.player.remove).toHaveBeenCalledOnce();
  });

  it.each(['pause', 'dispose'])(
    'does not start after %s during pending native setup',
    async (action) => {
      let resolve!: () => void;
      const f = fixture({
        prepare: () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      });
      const pending = f.controller.update(true, 0.08, 'horror');
      if (action === 'pause') await f.controller.update(false, 0.08, 'horror');
      else f.controller.dispose();
      resolve();
      await pending;
      expect(f.createPlayer).not.toHaveBeenCalled();
    },
  );

  it('only applies the newest preference while setup is pending', async () => {
    let resolve!: () => void;
    const f = fixture({
      prepare: () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    });
    const first = f.controller.update(true, 0.08, 'horror');
    const second = f.controller.update(true, 0.04, 'horror');
    resolve();
    await settle();
    await Promise.all([first, second]);
    expect(f.player.play).toHaveBeenCalledOnce();
    expect(f.player.volume).toBeCloseTo(0.04);
  });

  it('treats zero volume as pause', async () => {
    const f = fixture();
    const p = f.controller.update(true, 0.08, 'horror');
    await settle();
    await p;
    await f.controller.update(true, 0, 'horror');
    expect(f.player.pause).toHaveBeenCalledOnce();
  });

  it('contains native errors and permits a later retry', async () => {
    const prepare = vi
      .fn()
      .mockRejectedValueOnce(new Error('audio unavailable'))
      .mockResolvedValue(undefined);
    const f = fixture({ prepare });
    await f.controller.update(true, 0.08, 'horror');
    expect(f.error).toHaveBeenCalledOnce();
    expect(f.createPlayer).not.toHaveBeenCalled();
    const p = f.controller.update(true, 0.08, 'horror');
    await settle();
    await p;
    expect(f.player.play).toHaveBeenCalledOnce();
  });
});

describe('rotation & resume', () => {
  it('resumes a theme from its cursor (bed + position)', async () => {
    const f = fixture({
      cursors: { news: { bed: 'global-affairs-briefing-2', positionMs: 40_000 } },
    });
    const p = f.controller.update(true, 0.2, 'news');
    await settle();
    await p;
    expect(f.createPlayer).toHaveBeenCalledExactlyOnceWith(3);
    expect(f.player.seekTo).toHaveBeenCalledExactlyOnceWith(40);
    expect(f.player.loop).toBe(false);
    expect(f.onEvent).toHaveBeenCalledWith('ambient_theme_started', {
      theme: 'news',
      bed: 'global-affairs-briefing-2',
      resumedMs: 40_000,
    });
    expect(f.onEvent).not.toHaveBeenCalledWith('ambient_theme_switched', expect.anything());
  });

  it('skips to the next bed when the cursor sits inside the last five seconds', async () => {
    const f = fixture({
      cursors: { news: { bed: 'global-affairs-briefing-1', positionMs: GA1_MS - 4000 } },
    });
    const p = f.controller.update(true, 0.2, 'news');
    await settle();
    await p;
    expect(f.createPlayer).toHaveBeenCalledExactlyOnceWith(3);
    expect(f.player.seekTo).not.toHaveBeenCalled();
    expect(f.onEvent).toHaveBeenCalledWith('ambient_theme_started', {
      theme: 'news',
      bed: 'global-affairs-briefing-2',
      resumedMs: 0,
    });
  });

  it('advances on didJustFinish, wraps after the last bed, and ignores the ENDED re-emit', async () => {
    const f = fixture();
    const p = f.controller.update(true, 0.2, 'news');
    await settle();
    await p;
    f.player.currentTime = GA1_MS / 1000;
    f.player.emit({ didJustFinish: true, playing: false });
    expect(f.player.replace).toHaveBeenCalledExactlyOnceWith(3);
    expect(f.player.play).toHaveBeenCalledTimes(2);
    expect(f.onEvent).toHaveBeenCalledWith('ambient_bed_advanced', {
      theme: 'news',
      fromBed: 'global-affairs-briefing-1',
      toBed: 'global-affairs-briefing-2',
    });
    expect(f.saveCursor).toHaveBeenLastCalledWith('news', {
      bed: 'global-affairs-briefing-2',
      positionMs: 0,
    });
    // ExoPlayer may re-emit the finish before the new source reports playing.
    f.player.emit({ didJustFinish: true, playing: false });
    expect(f.player.replace).toHaveBeenCalledOnce();
    // Playing tick clears the guard; the next real finish wraps to bed 1.
    f.player.emit({ playing: true, currentTime: 5 });
    f.player.currentTime = GA2_MS / 1000;
    f.player.emit({ didJustFinish: true, playing: false });
    expect(f.player.replace).toHaveBeenCalledTimes(2);
    expect(f.player.replace).toHaveBeenLastCalledWith(2);
    expect(f.onEvent).toHaveBeenLastCalledWith('ambient_bed_advanced', {
      theme: 'news',
      fromBed: 'global-affairs-briefing-2',
      toBed: 'global-affairs-briefing-1',
    });
  });

  it('does not advance a single-bed theme (the player loops instead)', async () => {
    const f = fixture();
    const p = f.controller.update(true, 0.2, 'horror');
    await settle();
    await p;
    expect(f.player.loop).toBe(true);
    f.player.emit({ didJustFinish: true, playing: false });
    expect(f.player.replace).not.toHaveBeenCalled();
    expect(f.onEvent).not.toHaveBeenCalledWith('ambient_bed_advanced', expect.anything());
  });

  it('an advance while paused swaps the bed but does not start audio', async () => {
    const f = fixture();
    const p = f.controller.update(true, 0.2, 'news');
    await settle();
    await p;
    await f.controller.update(false, 0.2, 'news');
    f.player.emit({ didJustFinish: true, playing: false });
    expect(f.player.replace).toHaveBeenCalledOnce();
    expect(f.player.play).toHaveBeenCalledOnce();
  });

  it('switches theme on the same player: saves the old cursor, fades out, replaces, seeks, fades in', async () => {
    const f = fixture({
      cursors: { comedy: { bed: 'return-to-the-motif-2', positionMs: 12_000 } },
    });
    const p1 = f.controller.update(true, 0.2, 'horror');
    await settle();
    await p1;
    f.player.currentTime = 30;
    const startIdx = f.player.volumeLog.length;
    const p2 = f.controller.update(true, 0.2, 'comedy');
    await settle();
    await settle();
    await p2;
    expect(f.createPlayer).toHaveBeenCalledOnce();
    expect(f.saveCursor).toHaveBeenCalledWith('horror', {
      bed: 'creepy-bg-music',
      positionMs: 30_000,
    });
    expect(f.player.replace).toHaveBeenCalledExactlyOnceWith(5);
    expect(f.player.seekTo).toHaveBeenCalledExactlyOnceWith(12);
    expect(f.player.loop).toBe(false);
    const log = f.player.volumeLog.slice(startIdx);
    // Ten descending steps from 0.2 to 0, a hard 0 at the swap, then ten
    // ascending steps back to 0.2 — never above the pref volume.
    const zeroAt = log.indexOf(0);
    expect(zeroAt).toBe(FADE_STEPS - 1);
    for (let i = 1; i <= zeroAt; i++) expect(log[i]!).toBeLessThan(log[i - 1]!);
    expect(log[zeroAt + 1]).toBe(0);
    expect(log).toHaveLength(2 * FADE_STEPS + 1);
    expect(log[log.length - 1]).toBeCloseTo(0.2);
    for (let i = zeroAt + 2; i < log.length; i++) expect(log[i]!).toBeGreaterThan(log[i - 1]!);
    expect(Math.max(...log)).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(f.onEvent).toHaveBeenCalledWith('ambient_theme_switched', {
      fromTheme: 'horror',
      toTheme: 'comedy',
    });
    expect(f.onEvent).toHaveBeenCalledWith('ambient_theme_started', {
      theme: 'comedy',
      bed: 'return-to-the-motif-2',
      resumedMs: 12_000,
    });
  });

  it('a stale switch superseded mid-fade never replaces or plays', async () => {
    const f = fixture();
    const p1 = f.controller.update(true, 0.2, 'horror');
    await settle();
    await p1;
    const stale = f.controller.update(true, 0.2, 'news');
    await vi.advanceTimersByTimeAsync(FADE_MS / 2);
    await f.controller.update(false, 0.2, 'news');
    await settle();
    await stale;
    expect(f.player.replace).not.toHaveBeenCalled();
    expect(f.player.play).toHaveBeenCalledOnce();
    expect(f.onEvent).not.toHaveBeenCalledWith('ambient_theme_switched', expect.anything());
  });

  it('a newer switch mid-fade wins: the stale one stops, the new one plays', async () => {
    const f = fixture();
    const p1 = f.controller.update(true, 0.2, 'horror');
    await settle();
    await p1;
    const stale = f.controller.update(true, 0.2, 'news');
    await vi.advanceTimersByTimeAsync(FADE_MS / 2);
    const fresh = f.controller.update(true, 0.2, 'comedy');
    await settle();
    await settle();
    await Promise.all([stale, fresh]);
    expect(f.player.replace).toHaveBeenCalledExactlyOnceWith(4);
    expect(f.onEvent).toHaveBeenCalledWith('ambient_theme_switched', {
      fromTheme: 'horror',
      toTheme: 'comedy',
    });
  });

  it('persists the cursor on pause and dispose', async () => {
    const f = fixture();
    const p = f.controller.update(true, 0.2, 'news');
    await settle();
    await p;
    f.saveCursor.mockClear();
    f.player.currentTime = 21.4;
    await f.controller.update(false, 0.2, 'news');
    expect(f.saveCursor).toHaveBeenCalledExactlyOnceWith('news', {
      bed: 'global-affairs-briefing-1',
      positionMs: 21_400,
    });
    await f.controller.update(true, 0.2, 'news');
    f.player.currentTime = 33;
    f.controller.dispose();
    expect(f.saveCursor).toHaveBeenLastCalledWith('news', {
      bed: 'global-affairs-briefing-1',
      positionMs: 33_000,
    });
  });

  it('throttles playing-time snapshots to one per 15 s', async () => {
    const f = fixture();
    const p = f.controller.update(true, 0.2, 'news');
    await settle();
    await p;
    f.saveCursor.mockClear();
    for (let s = 1; s <= 14; s++) {
      vi.advanceTimersByTime(1000);
      f.player.currentTime = s;
      f.player.emit({ playing: true });
    }
    expect(f.saveCursor).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CURSOR_SAVE_INTERVAL_MS);
    f.player.currentTime = 30;
    f.player.emit({ playing: true });
    expect(f.saveCursor).toHaveBeenCalledExactlyOnceWith('news', {
      bed: 'global-affairs-briefing-1',
      positionMs: 30_000,
    });
    f.player.emit({ playing: true });
    expect(f.saveCursor).toHaveBeenCalledOnce();
  });

  it('a failing replace pauses quietly and reports, without throwing', async () => {
    const f = fixture({ replaceThrows: true });
    const p1 = f.controller.update(true, 0.2, 'horror');
    await settle();
    await p1;
    const p2 = f.controller.update(true, 0.2, 'news');
    await settle();
    await expect(p2).resolves.toBeUndefined();
    expect(f.error).toHaveBeenCalledOnce();
    expect(f.player.pause).toHaveBeenCalled();
    expect(f.player.volume).toBe(0);
    expect(f.onEvent).not.toHaveBeenCalledWith('ambient_theme_switched', expect.anything());
  });
});

describe('restart (T49 «Reset rotation»)', () => {
  it('swaps the loaded theme back to bed 1 @ 0 on the same player and keeps playing', async () => {
    const f = fixture({
      cursors: { news: { bed: 'global-affairs-briefing-2', positionMs: 40_000 } },
    });
    const p = f.controller.update(true, 0.2, 'news');
    await settle();
    await p;
    expect(f.player.source).toBe(3);
    delete f.cursors.news; // the store's resetCursor ran
    f.controller.restart('news');
    expect(f.player.replace).toHaveBeenLastCalledWith(2);
    expect(f.player.source).toBe(2);
    expect(f.player.playing).toBe(true);
    expect(f.createPlayer).toHaveBeenCalledTimes(1);
    expect(f.onEvent).not.toHaveBeenCalledWith('ambient_theme_switched', expect.anything());
  });

  it('does nothing for a theme that is not loaded, and does not start audio while paused', async () => {
    const f = fixture();
    const p = f.controller.update(true, 0.2, 'news');
    await settle();
    await p;
    f.controller.restart('comedy');
    expect(f.player.replace).not.toHaveBeenCalled();
    await f.controller.update(false, 0.2, 'news');
    f.controller.restart('news');
    expect(f.player.replace).toHaveBeenCalledTimes(1);
    expect(f.player.playing).toBe(false);
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
