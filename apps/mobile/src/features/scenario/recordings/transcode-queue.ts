import { File } from 'expo-file-system';

import { repos } from '@/db';
import {
  encodeWavToOpus,
  isOpusUnsupported,
  OpusUnsupportedError,
} from '@/features/pronunciation/opus-encoder';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import { attemptFile, attemptFileName, ensureRunDir, withExt } from './paths';

/**
 * The background WAV → Ogg/Opus queue (T63, SPEAKING_SCENARIOS §10.1).
 *
 * Order of events per attempt: the T12 recorder's cache WAV is MOVED into
 * the run dir as `tNN-aM.wav` and the attempt row is written with that name
 * (transcode after persist, never before — the row must exist before any
 * slow work). Then the queue transcodes in the background: on success the
 * row's `audioFile` flips to `.ogg` and the WAV is deleted; on
 * `unsupported` the WAV stays (the debrief plays both extensions, the
 * bundle carries WAVs and warns once); any other failure keeps the WAV and
 * retries up to `MAX_RETRIES` times. One job at a time — the encoder is the
 * device's, not ours.
 *
 * `whenIdle()` lets the bundle service wait for a run's transcodes before
 * packing (bundles are immutable, so they must contain the final files).
 */

const MAX_RETRIES = 2;

export interface TranscodeJob {
  runId: string;
  attemptId: string;
  /** Relative WAV name inside the run dir. */
  wavName: string;
  tries: number;
}

interface QueueDeps {
  encode: (wavPath: string, outPath: string, opts: { inBytes: number }) => Promise<unknown>;
  isUnsupported: (err: unknown) => boolean;
  setAudioFile: (attemptId: string, name: string) => Promise<void>;
  fileExists: (uri: string) => boolean;
  fileSize: (uri: string) => number;
  deleteFile: (uri: string) => void;
  filePath: (runId: string, name: string) => string;
  onUnsupported?: () => void;
}

/** Dev-only matrix switch (§12 «encoder unsupported»): makes the default encoder reject like a device without Opus. */
let devForceUnsupported = false;
export function setDevForceEncoderUnsupported(on: boolean): void {
  if (__DEV__) devForceUnsupported = on;
}

const defaultDeps: QueueDeps = {
  encode: (wav, out, opts) => {
    if (__DEV__ && devForceUnsupported) {
      track('opus_encode_failed', { code: 'unsupported', simulated: true });
      return Promise.reject(new OpusUnsupportedError('simulated (dev switch)'));
    }
    return encodeWavToOpus(wav, out, opts);
  },
  isUnsupported: isOpusUnsupported,
  setAudioFile: (attemptId, name) => repos.scenarios.setAttemptAudioFile(attemptId, name),
  fileExists: (uri) => {
    try {
      return new File(uri).exists;
    } catch {
      return false;
    }
  },
  fileSize: (uri) => {
    try {
      return new File(uri).size ?? 0;
    } catch {
      return 0;
    }
  },
  deleteFile: (uri) => {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      /* best effort */
    }
  },
  filePath: (runId, name) => attemptFile(runId, name).uri,
};

export type TranscodeOutcome = 'encoded' | 'unsupported' | 'failed' | 'missing';

export function createTranscodeQueue(deps: QueueDeps = defaultDeps) {
  const pending: TranscodeJob[] = [];
  const perRun = new Map<string, number>();
  let running: Promise<void> | null = null;
  /** Set once the device said `unsupported`; further jobs skip the encoder entirely. */
  let unsupported = false;
  const waiters: { runId: string; resolve: () => void }[] = [];

  function bump(runId: string, delta: number) {
    const n = (perRun.get(runId) ?? 0) + delta;
    if (n <= 0) {
      perRun.delete(runId);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i]!.runId === runId) waiters.splice(i, 1)[0]!.resolve();
      }
    } else perRun.set(runId, n);
  }

  async function runOne(job: TranscodeJob): Promise<TranscodeOutcome> {
    const wavUri = deps.filePath(job.runId, job.wavName);
    if (!deps.fileExists(wavUri)) return 'missing';
    if (unsupported) return 'unsupported';
    const oggName = withExt(job.wavName, 'ogg');
    const oggUri = deps.filePath(job.runId, oggName);
    try {
      await deps.encode(wavUri, oggUri, { inBytes: deps.fileSize(wavUri) });
      await deps.setAudioFile(job.attemptId, oggName);
      deps.deleteFile(wavUri);
      return 'encoded';
    } catch (err) {
      deps.deleteFile(oggUri);
      if (deps.isUnsupported(err)) {
        unsupported = true;
        deps.onUnsupported?.();
        return 'unsupported';
      }
      if (job.tries + 1 <= MAX_RETRIES) {
        pending.push({ ...job, tries: job.tries + 1 });
        bump(job.runId, 1);
        return 'failed';
      }
      logError('manual', err);
      return 'failed';
    }
  }

  function pump(): Promise<void> {
    if (running) return running;
    running = (async () => {
      while (pending.length > 0) {
        const job = pending.shift()!;
        try {
          await runOne(job);
        } finally {
          bump(job.runId, -1);
        }
      }
    })().finally(() => {
      running = null;
      if (pending.length > 0) void pump();
    });
    return running;
  }

  return {
    /** Queue one WAV; returns immediately. */
    enqueue(job: Omit<TranscodeJob, 'tries'>): void {
      pending.push({ ...job, tries: 0 });
      bump(job.runId, 1);
      void pump();
    },
    /** Resolves once no job of `runId` is queued or running. */
    whenIdle(runId: string): Promise<void> {
      if (!perRun.has(runId)) return Promise.resolve();
      return new Promise((resolve) => waiters.push({ runId, resolve }));
    },
    pendingFor(runId: string): number {
      return perRun.get(runId) ?? 0;
    },
    /** True after the device reported no Opus encoder (WAVs are kept). */
    get encoderUnsupported(): boolean {
      return unsupported;
    },
    /** Test seam. */
    _drain: () => pump(),
  };
}

export type TranscodeQueue = ReturnType<typeof createTranscodeQueue>;

let shared: TranscodeQueue | null = null;
export function transcodeQueue(): TranscodeQueue {
  if (!shared) shared = createTranscodeQueue();
  return shared;
}
/** Dev only: drop the shared queue (its `unsupported` latch) after the simulated cell. */
export function resetTranscodeQueueForDev(): void {
  if (__DEV__) shared = null;
}

/**
 * Persist-time step for the run executor: move the recorder's cache WAV into
 * the run dir under its attempt name and return the relative name to store
 * (null when the WAV is gone — the attempt row then has no audio). Sync
 * `moveSync` keeps the executor's effect order (PERSIST_ATTEMPT is awaited).
 */
export function stashAttemptWav(
  runId: string,
  turnOrder: number,
  attemptNo: number,
  cacheWavUri: string,
): string | null {
  try {
    const src = new File(cacheWavUri);
    if (!src.exists) return null;
    ensureRunDir(runId);
    const name = attemptFileName(turnOrder, attemptNo, 'wav');
    const dest = attemptFile(runId, name);
    if (dest.exists) dest.delete();
    src.moveSync(dest);
    return name;
  } catch (err) {
    logError('manual', err);
    return null;
  }
}
