import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ISS-005 music half: leaving the reader withdraws the part's score source
 * (focus-scoped `useScoreSource`) and the narration activity. The REAL host
 * effect (`AmbientAudioHost`) + the REAL controller + the real zustand stores
 * must then pause the score and keep it paused — including when a score
 * `update` is still in flight (awaiting its seek) at the moment of withdrawal.
 * Only React's effect runner and the native player are faked.
 */

interface FakeNativePlayer {
  source: unknown;
  playing: boolean;
  volume: number;
  loop: boolean;
  currentTime: number;
  duration: number;
  log: string[];
  play(): void;
  pause(): void;
  remove(): void;
  release(): void;
  replace(source: unknown): void;
  seekTo(seconds: number): Promise<void>;
  setPlaybackRate(rate: number): void;
  addListener(): { remove(): void };
}

const native: { players: FakeNativePlayer[]; holdSeeks: boolean; pendingSeeks: (() => void)[] } = {
  players: [],
  holdSeeks: false,
  pendingSeeks: [],
};
const effects: (() => void | (() => void))[] = [];

vi.mock('react', () => ({ useEffect: (fn: () => void | (() => void)) => void effects.push(fn) }));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('expo-router', () => ({ useFocusEffect: () => {} }));
vi.mock('@/db', () => ({ repos: { settings: { get: async () => null, set: async () => {} } } }));
vi.mock('@/services/error-log', () => ({ logError: vi.fn() }));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));
vi.mock('../sources', () => ({ AMBIENT_BED_SOURCES: {} }));
vi.mock('../beds', () => ({
  DEFAULT_AMBIENT_THEME: 'horror',
  AMBIENT_THEMES: {
    horror: { beds: [{ slug: 'creepy', source: 1, durationMs: 100_000 }] },
  },
  bedAfter: () => ({ slug: 'creepy', source: 1, durationMs: 100_000 }),
  findBed: () => undefined,
}));
vi.mock('expo-audio', () => ({
  setAudioModeAsync: async () => {},
  createAudioPlayer: (source: unknown) => {
    const p: FakeNativePlayer = {
      source,
      playing: false,
      volume: 1,
      loop: false,
      currentTime: 0,
      duration: 0,
      log: [],
      play() {
        p.playing = true;
        p.log.push('play');
      },
      pause() {
        p.playing = false;
        p.log.push('pause');
      },
      remove: () => void p.log.push('remove'),
      release: () => void p.log.push('release'),
      replace(next) {
        p.source = next;
      },
      seekTo(seconds) {
        p.currentTime = seconds;
        p.log.push(`seek:${seconds}`);
        if (!native.holdSeeks) return Promise.resolve();
        return new Promise<void>((resolve) => native.pendingSeeks.push(resolve));
      },
      setPlaybackRate: () => {},
      addListener: () => ({ remove: () => {} }),
    };
    native.players.push(p);
    return p;
  },
}));

const { AmbientAudioHost } = await import('../ambient-audio-host');
const { useAmbientScores } = await import('../score-source');
const { useAmbientActivity } = await import('../activity');
const { useAmbientPrefs } = await import('@/store/ambient-prefs');
const { DEFAULT_AMBIENT_PREFS } = await import('../preferences');

const SCORE_ID = Symbol('reader-score');
const NARRATION_ID = Symbol('reader-narration');

/** The reader mounted + narration playing: what `useScoreSource` / `useNarrationActivity` publish. */
function readerPlaying(positionMs = 8_000) {
  useAmbientActivity.setState({
    narrations: new Set([NARRATION_ID]),
    activities: new Map([[Symbol('reader-activity'), 'horror' as const]]),
  });
  useAmbientScores.setState({
    sources: new Map([
      [
        SCORE_ID,
        {
          key: 'p/ch1-part1/t1',
          uri: 'file:///p/audio/t1-score.opus',
          durationMs: 120_000,
          playing: true,
          rate: 1,
          seekRevision: 0,
          positionMs: () => positionMs,
          props: { packId: 'p', storyId: 'ch1-part1', mode: 'reader' as const },
        },
      ],
    ]),
  });
}

/** Back to the Library: the focus cleanups + the unmount withdraw everything. */
function back() {
  useAmbientScores.setState({ sources: new Map() });
  useAmbientActivity.setState({ narrations: new Set(), activities: new Map() });
}

let unmountHost: (() => void) | undefined;

function mountHost() {
  effects.length = 0;
  AmbientAudioHost({ ready: true });
  const cleanup = effects[0]!();
  unmountHost = typeof cleanup === 'function' ? cleanup : undefined;
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  native.players.length = 0;
  native.holdSeeks = false;
  native.pendingSeeks.length = 0;
  useAmbientPrefs.setState({ ...DEFAULT_AMBIENT_PREFS });
  useAmbientScores.setState({ sources: new Map() });
  useAmbientActivity.setState({
    activities: new Map(),
    blockers: new Set(),
    narrations: new Set(),
  });
  vi.useFakeTimers();
});
afterEach(() => {
  unmountHost?.();
  unmountHost = undefined;
  vi.useRealTimers();
});

describe('score withdrawn while playing (ISS-005, host + controller)', () => {
  it('Back pauses the playing score and nothing resumes it', async () => {
    mountHost();
    readerPlaying();
    await flush();
    const score = native.players[0]!;
    expect(score.source).toEqual({ uri: 'file:///p/audio/t1-score.opus' });
    expect(score.playing).toBe(true);

    back();
    await flush();
    expect(score.playing).toBe(false);
    expect(score.volume).toBe(0);

    // Drift-check ticks, status ticks and fades: nothing may restart it.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(score.playing).toBe(false);
    expect(score.log.at(-1)).toBe('pause');
    expect(native.players).toHaveLength(1);
  });

  it('Back while the score update is still awaiting its seek: the late seek never plays it', async () => {
    native.holdSeeks = true;
    mountHost();
    readerPlaying();
    await flush();
    const score = native.players[0]!;
    expect(native.pendingSeeks).toHaveLength(1);
    expect(score.log).not.toContain('play');

    back();
    await flush();
    // The in-flight update's seek lands only now — after the withdrawal.
    native.pendingSeeks.splice(0).forEach((resolve) => resolve());
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(score.log).not.toContain('play');
    expect(score.playing).toBe(false);
  });

  it('a score withdrawn while playing is released when the host goes away', async () => {
    mountHost();
    readerPlaying();
    await flush();
    const score = native.players[0]!;
    unmountHost!();
    unmountHost = undefined;
    expect(score.log.slice(-3)).toEqual(['pause', 'remove', 'release']);
  });
});
