import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecordingPermissionGate } from '../recording-permission';
import {
  createLabAudio,
  type AudioDependencies,
  type LabPlayer,
  type LabPlaybackStatus,
} from '../audio-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  let listener: ((status: LabPlaybackStatus) => void) | null = null;
  const subscription = {
    remove: vi.fn(() => {
      listener = null;
    }),
  };
  const player: LabPlayer = {
    currentTime: 0,
    seekTo: vi.fn(async () => {}),
    play: vi.fn(),
    pause: vi.fn(),
    remove: vi.fn(),
    setPlaybackRate: vi.fn(),
    addListener: vi.fn((_event, next) => {
      listener = next;
      return subscription;
    }),
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
  const emit = (status: Partial<LabPlaybackStatus>) =>
    listener?.({
      playing: false,
      isLoaded: true,
      isBuffering: false,
      currentTime: 0,
      didJustFinish: false,
      ...status,
    });
  return {
    player,
    deps,
    audio: createLabAudio(deps),
    emit,
    subscription,
    getListener: () => listener,
  };
}
const clip = { uri: 'file:///clip.opus', startMs: 0, endMs: 1200 };
afterEach(() => vi.useRealTimers());
describe('Android recording permission lifecycle', () => {
  it('does not open a permission activity when access is already granted', async () => {
    const request = vi.fn(async () => ({ granted: true }));
    const gate = createRecordingPermissionGate({
      read: async () => ({ granted: true }),
      request,
    });
    expect(await gate.ensure()).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('allows capture after the permission activity backgrounds and resumes the app', async () => {
    const { audio, deps } = setup();
    const gate = createRecordingPermissionGate({
      read: async () => ({ granted: false }),
      request: async () => {
        void gate.onAppStateChange('background', audio.stop);
        void gate.onAppStateChange('active', audio.stop);
        return { granted: true };
      },
    });
    deps.permission = gate.ensure;
    await audio.startRecording();
    expect(deps.recorder.start).toHaveBeenCalledOnce();
    expect(deps.changed).toHaveBeenLastCalledWith('recording', null);
    await gate.onAppStateChange('background', audio.stop);
    expect(deps.recorder.cancel).toHaveBeenCalledOnce();
    await audio.dispose();
  });

  it('keeps permission refusal actionable and still stops on later backgrounding', async () => {
    const { audio, deps } = setup();
    const stop = vi.fn(audio.stop);
    const gate = createRecordingPermissionGate({
      read: async () => ({ granted: false }),
      request: async () => ({ granted: false }),
    });
    deps.permission = gate.ensure;
    await audio.startRecording();
    expect(deps.recorder.start).not.toHaveBeenCalled();
    expect(deps.changed).toHaveBeenLastCalledWith('idle', expect.stringContaining('permission'));
    await gate.onAppStateChange('background', stop);
    expect(stop).toHaveBeenCalledOnce();
    await audio.dispose();
  });

  it('does not start capture if a permission result arrives while the app is still backgrounded', async () => {
    const { audio, deps } = setup();
    deps.isActive = () => false;
    await audio.startRecording();
    expect(deps.recorder.start).not.toHaveBeenCalled();
    expect(deps.changed).toHaveBeenLastCalledWith('idle', expect.stringContaining('Return'));
    await audio.dispose();
  });
});
describe('lab audio lifecycle', () => {
  it('releases player and focus at the observed boundary', async () => {
    vi.useFakeTimers();
    const { audio, deps, player, emit } = setup();
    const played = vi.fn();
    await audio.play(clip, 0.75, played);
    expect(played).not.toHaveBeenCalled();
    emit({ playing: true, currentTime: 0.1 });
    expect(played).toHaveBeenCalledOnce();
    player.currentTime = 1.2;
    vi.advanceTimersByTime(30);
    expect(player.remove).toHaveBeenCalledOnce();
    expect(deps.focus.release).toHaveBeenCalled();
    expect(deps.changed).toHaveBeenLastCalledWith('idle', null);
    await audio.dispose();
  });
  it('counts once only after native loaded playback advances, not the play command or buffering', async () => {
    const { audio, emit, deps } = setup();
    const onStarted = vi.fn();
    await audio.play(clip, 1, onStarted);
    emit({ isLoaded: false, isBuffering: true, playing: false });
    emit({ playing: true, currentTime: 0 });
    expect(onStarted).not.toHaveBeenCalled();
    expect(deps.changed).toHaveBeenLastCalledWith('loading', null);
    emit({ playing: true, currentTime: 0.1 });
    emit({ playing: true, currentTime: 0.2 });
    expect(onStarted).toHaveBeenCalledOnce();
    await audio.dispose();
  });
  it('native decoder error before progress does not count exposure and releases the subscription and focus', async () => {
    const { audio, emit, deps, player, subscription } = setup();
    const onStarted = vi.fn();
    await audio.play(clip, 1, onStarted);
    emit({ error: 'decoder failure' });
    expect(onStarted).not.toHaveBeenCalled();
    expect(player.remove).toHaveBeenCalledOnce();
    expect(subscription.remove).toHaveBeenCalledOnce();
    expect(deps.changed).toHaveBeenLastCalledWith(
      'idle',
      expect.stringContaining('could not play'),
    );
    await audio.dispose();
  });
  it('ignores queued native start/error events after cancellation', async () => {
    const { audio, getListener, deps } = setup();
    const onStarted = vi.fn();
    await audio.play(clip, 1, onStarted);
    const late = getListener();
    await audio.stop();
    late?.({
      isLoaded: true,
      isBuffering: false,
      playing: true,
      didJustFinish: false,
      currentTime: 0.2,
    });
    late?.({
      isLoaded: true,
      isBuffering: false,
      playing: false,
      didJustFinish: false,
      currentTime: 0,
      error: 'late',
    });
    expect(onStarted).not.toHaveBeenCalled();
    expect(deps.changed).toHaveBeenLastCalledWith('idle', null);
    await audio.dispose();
  });
  it('uses native file end for bounded clips, without an early JS slice stop', async () => {
    vi.useFakeTimers();
    const { audio, emit, player, deps, subscription } = setup();
    await audio.play({ ...clip, stopAtFileEnd: true }, 1);
    emit({ playing: true, currentTime: 0.2 });
    player.currentTime = 1.2;
    vi.advanceTimersByTime(1500);
    expect(player.pause).not.toHaveBeenCalled();
    emit({ playing: false, currentTime: 1.2, didJustFinish: true });
    expect(player.remove).toHaveBeenCalledOnce();
    expect(subscription.remove).toHaveBeenCalledOnce();
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
