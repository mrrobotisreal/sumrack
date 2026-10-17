import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListenSource } from '@/db/repositories/listen';
import { claim } from '@/features/audio/arbiter';

import {
  AUTOSAVE_MS,
  createListenPlayer,
  type ListenDeps,
  type ListenPlayerLike,
  type ListenStatus,
} from '../listen-player';
import { LISTEN_PREFS_DEFAULTS } from '../prefs';
import { EMPTY_PROGRESS, markFinished, markProgress, type ListenProgress } from '../progress';

function fakePlayer() {
  let t = 0;
  let playing = false;
  let listener: ((s: ListenStatus) => void) | null = null;
  const log: string[] = [];
  const p = {
    log,
    removed: false,
    get currentTime() {
      return t / 1000;
    },
    get playing() {
      return playing;
    },
    volume: 1,
    muted: false,
    play() {
      playing = true;
      log.push('play');
    },
    pause() {
      playing = false;
      log.push('pause');
    },
    async seekTo(s: number) {
      t = s * 1000;
      log.push(`seek:${Math.round(s * 1000)}`);
    },
    replace(src: { uri: string }) {
      log.push(`replace:${src.uri}`);
    },
    remove() {
      p.removed = true;
      log.push('remove');
    },
    setPlaybackRate(r: number) {
      log.push(`rate:${r}`);
    },
    setActiveForLockScreen: vi.fn(),
    updateLockScreenMetadata: vi.fn(),
    clearLockScreenControls: vi.fn(() => void log.push('clearLock')),
    addListener(_e: 'playbackStatusUpdate', l: (s: ListenStatus) => void) {
      listener = l;
      return { remove: () => void (listener = null) };
    },
    advance(ms: number, status: Partial<ListenStatus> = {}) {
      t += ms;
      listener?.({ playing, didJustFinish: false, error: null, duration: 100, ...status });
    },
    emit(status: Partial<ListenStatus>) {
      listener?.({ playing, didJustFinish: false, error: null, duration: 100, ...status });
    },
  };
  return p as typeof p & ListenPlayerLike;
}

function source(id: string, over: Partial<ListenSource> = {}): ListenSource {
  return {
    kind: 'full',
    packId: id,
    titleRu: `T-${id}`,
    titleEn: id,
    level: 'A1',
    voice: 'v',
    uri: `file:///${id}.opus`,
    durationMs: 100_000,
    coverUri: null,
    segments: [
      { storyId: 's1', trackId: 't1', titleRu: 'Раз', orderIdx: 0, startMs: 0, endMs: 40_000 },
      {
        storyId: 's2',
        trackId: 't2',
        titleRu: 'Два',
        orderIdx: 1,
        startMs: 41_200,
        endMs: 100_000,
      },
    ],
    ...over,
  };
}

function setup(initial: ListenProgress = EMPTY_PROGRESS) {
  const players: ReturnType<typeof fakePlayer>[] = [];
  let saved: ListenProgress = initial;
  const events: [string, Record<string, unknown>][] = [];
  const sources: Record<string, ListenSource> = { a: source('a'), b: source('b') };
  const deps: ListenDeps = {
    createPlayer: () => {
      const p = fakePlayer();
      players.push(p);
      return p;
    },
    setAudioMode: vi.fn(async () => {}),
    getSource: async (id) => sources[id] ?? null,
    loadProgress: async () => saved,
    saveProgress: async (p) => void (saved = p),
    loadPrefs: async () => LISTEN_PREFS_DEFAULTS,
    savePrefs: async () => {},
    getFallbackArtwork: async () => 'file:///icon.png',
    track: (e, p) => void events.push([e, p]),
    now: () => 1000,
  };
  const lp = createListenPlayer(deps);
  return { lp, players, deps, events, getSaved: () => saved };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('listen player', () => {
  it('resumes at a saved position > 5 s', async () => {
    const { lp, players } = setup(markProgress(EMPTY_PROGRESS, 'a', 30_000, 100_000, 1));
    await lp.open('a');
    expect(players[0]!.log).toContain('seek:30000');
    expect(lp.store.getState().positionMs).toBe(30_000);
    expect(lp.store.getState().partIndex).toBe(0);
  });

  it('does not resume under 5 s', async () => {
    const { lp, players } = setup(markProgress(EMPTY_PROGRESS, 'a', 4000, 100_000, 1));
    await lp.open('a');
    expect(players[0]!.log.some((l) => l.startsWith('seek:'))).toBe(false);
  });

  it('a finished pack opens at 0 and play clears finishedAt', async () => {
    const { lp, getSaved } = setup(markFinished(EMPTY_PROGRESS, 'a', 100_000, 1));
    await lp.open('a');
    expect(lp.store.getState().positionMs).toBe(0);
    expect(lp.store.getState().finished).toBe(true);
    lp.play();
    expect(lp.store.getState().finished).toBe(false);
    expect(getSaved().byPack.a!.finishedAt).toBeUndefined();
  });

  it('finish pauses, seeks to 0 and marks finished', async () => {
    const { lp, players, getSaved, events } = setup();
    await lp.open('a', { autoplay: true });
    const p = players[0]!;
    p.advance(99_000);
    p.emit({ didJustFinish: true, playing: false });
    expect(p.log.slice(-2)).toEqual(['pause', 'seek:0']);
    expect(lp.store.getState().finished).toBe(true);
    expect(lp.store.getState().playing).toBe(false);
    expect(getSaved().byPack.a!.finishedAt).toBe(1000);
    expect(events.some(([e]) => e === 'listen_finished')).toBe(true);
  });

  it('opening another pack saves the old position first and reuses the player', async () => {
    const { lp, players, getSaved, events } = setup();
    await lp.open('a', { autoplay: true });
    players[0]!.advance(20_000);
    await lp.open('b');
    expect(getSaved().byPack.a!.positionMs).toBe(20_000);
    expect(players).toHaveLength(1);
    expect(players[0]!.log).toContain('replace:file:///b.opus');
    expect(events.find(([e, p]) => e === 'listen_stopped' && p.reason === 'replaced')).toBeTruthy();
    expect(lp.store.getState().session?.source.packId).toBe('b');
  });

  it('stop clears the lock screen, removes the player and resets the session', async () => {
    const { lp, players } = setup();
    await lp.open('a', { autoplay: true });
    lp.stop();
    const p = players[0]!;
    expect(p.clearLockScreenControls).toHaveBeenCalled();
    expect(p.removed).toBe(true);
    expect(lp.store.getState().session).toBeNull();
  });

  it('only the eight rates are accepted', async () => {
    const { lp, players } = setup();
    await lp.open('a');
    lp.setRate(2.5);
    lp.setRate(3);
    expect(lp.store.getState().rate).toBe(1);
    lp.setRate(2);
    lp.setRate(0.25);
    expect(lp.store.getState().rate).toBe(0.25);
    expect(players[0]!.log.filter((l) => l.startsWith('rate:')).pop()).toBe('rate:0.25');
  });

  it('skips clamp, volume/mute apply, lock screen set on play', async () => {
    const { lp, players } = setup();
    await lp.open('a');
    lp.play();
    const p = players[0]!;
    expect(p.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ albumTitle: 'Сумрак', artworkUrl: 'file:///icon.png' }),
      { showSeekForward: true, showSeekBackward: true },
    );
    await lp.skip(-15_000);
    expect(lp.store.getState().positionMs).toBe(0);
    await lp.skip(30_000);
    expect(lp.store.getState().positionMs).toBe(30_000);
    lp.setVolume(0.4);
    lp.setMuted(true);
    expect(p.volume).toBe(0.4);
    expect(p.muted).toBe(true);
  });

  it('part change updates lock-screen metadata; part_reached fires once per part', async () => {
    const { lp, players, events } = setup();
    await lp.open('a', { autoplay: true });
    const p = players[0]!;
    p.advance(1000);
    p.advance(1000);
    p.advance(45_000);
    expect(lp.store.getState().partIndex).toBe(1);
    expect(p.updateLockScreenMetadata).toHaveBeenCalledTimes(1);
    p.advance(1000);
    expect(events.filter(([e]) => e === 'listen_part_reached')).toHaveLength(2);
  });

  it('autosaves every 10 s of playback and on pause', async () => {
    const { lp, players, getSaved } = setup();
    await lp.open('a', { autoplay: true });
    const p = players[0]!;
    p.advance(12_000);
    expect(getSaved().byPack.a).toBeUndefined();
    vi.advanceTimersByTime(AUTOSAVE_MS);
    expect(getSaved().byPack.a!.positionMs).toBe(12_000);
    p.advance(3000);
    lp.pause();
    expect(getSaved().byPack.a!.positionMs).toBe(15_000);
  });

  it('missing file / no uri -> error state; arbiter claim pauses listen', async () => {
    const { lp } = setup();
    await lp.open('a', { autoplay: true });
    expect(lp.store.getState().playing).toBe(true);
    claim('narration');
    expect(lp.store.getState().playing).toBe(false);
  });

  it('a pending download (no uri) is an error session', async () => {
    const { lp, deps } = setup();
    const orig = deps.getSource;
    deps.getSource = async (id) => ({ ...(await orig(id))!, uri: null });
    await lp.open('a');
    expect(lp.store.getState().session?.status).toBe('error');
  });
});
