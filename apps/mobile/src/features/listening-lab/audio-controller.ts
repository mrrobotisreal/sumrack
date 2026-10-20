import type { SegmentAudio } from './source';

export interface LabPlayer {
  currentTime: number;
  seekTo(seconds: number): Promise<void>;
  play(): void;
  pause(): void;
  remove(): void;
  setPlaybackRate(rate: number): void;
}
export type AudioPhase = 'idle' | 'loading' | 'playing' | 'recording' | 'processing';
export interface Take {
  path: string;
  durationMs: number;
}
export interface AudioDependencies {
  player(uri: string): LabPlayer;
  focus: { acquire(): Promise<void>; release(): void };
  silence(): Promise<void>;
  permission(): Promise<boolean>;
  recorder: { start(): Promise<void>; stop(): Promise<Take>; cancel(): Promise<void> };
  deleteTake(path: string): void;
  changed(phase: AudioPhase, error: string | null): void;
}

/** A cancellable native seam. Late permission/focus/seek/start results never restart audio. */
export function createLabAudio(deps: AudioDependencies) {
  let epoch = 0,
    disposed = false,
    player: LabPlayer | null = null,
    recording = false;
  let queue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  let cap: ReturnType<typeof setTimeout> | null = null;
  let take: Take | null = null;
  const changed = (phase: AudioPhase, error: string | null = null) => {
    if (!disposed) deps.changed(phase, error);
  };
  const playbackCleanup = () => {
    if (timer) clearInterval(timer);
    if (cap) clearTimeout(cap);
    timer = null;
    cap = null;
    try {
      player?.pause();
    } catch {
      /* A failed player may already be unloaded. */
    }
    try {
      player?.remove();
    } catch {
      /* Removal is best effort after an engine error. */
    }
    player = null;
    deps.focus.release();
  };
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  };
  const cancelRecording = async () => {
    if (!recording) return;
    try {
      await deps.recorder.cancel();
    } finally {
      recording = false;
    }
  };
  const stop = async () => {
    ++epoch;
    playbackCleanup();
    await enqueue(async () => {
      await cancelRecording();
    });
    changed('idle');
  };
  const fail = async (message: string) => {
    playbackCleanup();
    try {
      await cancelRecording();
    } catch {
      /* Keep the original actionable error. */
    }
    changed('idle', message);
  };
  return {
    async play(source: SegmentAudio, rate: number, onStarted?: () => void) {
      if (disposed) return;
      const mine = ++epoch;
      playbackCleanup();
      changed('loading');
      await enqueue(async () => {
        try {
          await cancelRecording();
          if (mine !== epoch || disposed) return;
          await deps.silence();
          await deps.focus.acquire();
          if (mine !== epoch || disposed) {
            deps.focus.release();
            return;
          }
          const p = deps.player(source.uri);
          player = p;
          p.setPlaybackRate(rate);
          await p.seekTo(source.startMs / 1000);
          if (mine !== epoch || disposed) return;
          p.play();
          changed('playing');
          onStarted?.();
          const started = Date.now();
          timer = setInterval(() => {
            if (mine !== epoch || disposed) return;
            if (p.currentTime * 1000 >= source.endMs - 25) {
              playbackCleanup();
              changed('idle');
            } else if (Date.now() - started > (source.endMs - source.startMs) / rate + 10_000) {
              playbackCleanup();
              changed('idle', 'Audio did not finish. Check the downloaded narration and retry.');
            }
          }, 30);
        } catch {
          if (mine === epoch) await fail('Audio could not play. Retry or check the pack download.');
        }
      });
    },
    async startRecording() {
      if (disposed) return;
      const mine = ++epoch;
      playbackCleanup();
      changed('loading');
      await enqueue(async () => {
        try {
          await cancelRecording();
          if (mine !== epoch || disposed) return;
          if (!(await deps.permission())) {
            if (mine === epoch)
              changed(
                'idle',
                'Microphone permission was not granted. You can keep typing or enable it in system settings.',
              );
            return;
          }
          if (mine !== epoch || disposed) return;
          await deps.silence();
          await deps.focus.acquire();
          if (mine !== epoch || disposed) {
            deps.focus.release();
            return;
          }
          // Mark pending capture so cancellation also cleans up a partially failed start.
          recording = true;
          await deps.recorder.start();
          if (mine !== epoch || disposed) {
            await cancelRecording();
            deps.focus.release();
            return;
          }
          changed('recording');
          cap = setTimeout(() => {
            void stop()
              .then(() => changed('idle', 'Recording stopped at 60 seconds. Try a shorter take.'))
              .catch(() => changed('idle', 'Recording was interrupted. Try again.'));
          }, 60_000);
        } catch {
          if (mine === epoch)
            await fail('Recording could not start. Your typed work is still here.');
        }
      });
    },
    async finishRecording(): Promise<Take | null> {
      const mine = epoch;
      return enqueue(async () => {
        if (!recording || mine !== epoch || disposed) return null;
        changed('processing');
        try {
          const next = await deps.recorder.stop();
          recording = false;
          playbackCleanup();
          if (mine !== epoch || disposed) {
            deps.deleteTake(next.path);
            return null;
          }
          if (take) deps.deleteTake(take.path);
          take = next;
          changed('idle');
          return next;
        } catch {
          await fail('Recording was interrupted. Your typed work is still here.');
          return null;
        }
      });
    },
    stop,
    async clearTake() {
      await stop();
      if (take) deps.deleteTake(take.path);
      take = null;
    },
    async dispose() {
      disposed = true;
      await stop();
      if (take) deps.deleteTake(take.path);
      take = null;
    },
  };
}
