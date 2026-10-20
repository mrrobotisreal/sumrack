import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabAudio, type AudioDependencies, type LabPlayer } from '../audio-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  const player: LabPlayer = {
    currentTime: 0,
    seekTo: vi.fn(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
    remove: vi.fn(),
    setPlaybackRate: vi.fn(),
  };
  const deps: AudioDependencies = {
    player: vi.fn(() => player),
    focus: { acquire: vi.fn(async () => {}), release: vi.fn() },
    silence: vi.fn(async () => {}),
    permission: vi.fn(async () => true),
    recorder: {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => ({ path: 'file:///take.wav', durationMs: 500 })),
      cancel: vi.fn(async () => {}),
    },
    deleteTake: vi.fn(),
    changed: vi.fn(),
  };
  return { player, deps, audio: createLabAudio(deps) };
}
const clip = { uri: 'file:///clip.opus', startMs: 0, endMs: 1200 };
afterEach(() => vi.useRealTimers());
describe('lab audio lifecycle', () => {
  it('releases player and focus at the observed boundary', async () => {
    vi.useFakeTimers();
    const { audio, deps, player } = setup();
    const played = vi.fn();
    await audio.play(clip, 0.75, played);
    expect(played).toHaveBeenCalledOnce();
    player.currentTime = 1.2;
    vi.advanceTimersByTime(30);
    expect(player.remove).toHaveBeenCalledOnce();
    expect(deps.focus.release).toHaveBeenCalled();
    expect(deps.changed).toHaveBeenLastCalledWith('idle', null);
    await audio.dispose();
  });
  it('a stop during focus acquire cannot restart playback', async () => {
    const { audio, deps, player } = setup();
    const pending = deferred<void>();
    deps.focus.acquire = () => pending.promise;
    const playing = audio.play(clip, 1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const stopped = audio.stop();
    pending.resolve();
    await playing;
    await stopped;
    expect(player.play).not.toHaveBeenCalled();
    await audio.dispose();
  });
  it('a denied microphone never starts a recording and releases focus', async () => {
    const { audio, deps } = setup();
    deps.permission = async () => false;
    await audio.startRecording();
    expect(deps.recorder.start).not.toHaveBeenCalled();
    expect(deps.changed).toHaveBeenLastCalledWith('idle', expect.stringContaining('permission'));
    expect(deps.focus.release).toHaveBeenCalled();
    await audio.dispose();
  });
  it('exit while a recording starts cancels the late capture', async () => {
    const { audio, deps } = setup();
    const pending = deferred<void>();
    deps.recorder.start = vi.fn(() => pending.promise);
    const started = audio.startRecording();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const disposed = audio.dispose();
    pending.resolve();
    await started;
    await disposed;
    expect(deps.recorder.cancel).toHaveBeenCalledOnce();
    expect(deps.focus.release).toHaveBeenCalled();
  });
  it('native failures cancel capture and expose a recoverable error', async () => {
    const { audio, deps } = setup();
    deps.recorder.start = async () => {
      throw new Error('native');
    };
    await audio.startRecording();
    expect(deps.recorder.cancel).toHaveBeenCalledOnce();
    expect(deps.changed).toHaveBeenLastCalledWith(
      'idle',
      expect.stringContaining('could not start'),
    );
    await audio.dispose();
  });
  it('keeps only the latest transient take and deletes it on exit', async () => {
    const { audio, deps } = setup();
    await audio.startRecording();
    expect(await audio.finishRecording()).toEqual({ path: 'file:///take.wav', durationMs: 500 });
    await audio.startRecording();
    await audio.finishRecording();
    expect(deps.deleteTake).toHaveBeenCalledTimes(1);
    await audio.dispose();
    expect(deps.deleteTake).toHaveBeenCalledTimes(2);
  });
  it('blur deletes the take but leaves the controller reusable on focus return', async () => {
    const { audio, deps, player } = setup();
    await audio.startRecording();
    await audio.finishRecording();
    await audio.clearTake();
    expect(deps.deleteTake).toHaveBeenCalledOnce();
    await audio.play(clip, 1);
    expect(player.play).toHaveBeenCalledOnce();
    await audio.dispose();
    expect(deps.deleteTake).toHaveBeenCalledOnce();
  });
  it('bounds stalled playback and releases focus after seek error', async () => {
    vi.useFakeTimers();
    const { audio, deps, player } = setup();
    await audio.play(clip, 1);
    vi.advanceTimersByTime(12_000);
    expect(deps.changed).toHaveBeenLastCalledWith(
      'idle',
      expect.stringContaining('did not finish'),
    );
    player.seekTo = async () => {
      throw new Error('seek');
    };
    await audio.play(clip, 1);
    expect(deps.changed).toHaveBeenLastCalledWith(
      'idle',
      expect.stringContaining('could not play'),
    );
    await audio.dispose();
  });
});
