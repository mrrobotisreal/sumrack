import * as React from 'react';

import SherpaSpeech from '../../../../modules/sherpa-speech';
import {
  INITIAL_ENDPOINT,
  endpointConfig,
  endpointManualStop,
  endpointStep,
  type EndpointConfig,
  type EndpointReason,
  type EndpointState,
} from '@/features/scenario/engine/endpointing';
import { stashExamWav, transcodeQueue } from '@/features/scenario/recordings/transcode-queue';
import { transcribeWav } from '@/features/pronunciation/asr-service';
import { isAssistInstalled, transcribeWithAssist } from '@/features/pronunciation/assist-service';
import {
  cancelAttemptRecording,
  startAttemptRecording,
  stopAttemptRecording,
} from '@/features/pronunciation/recorder';
import { trackTorfl } from '@/services/analytics';
import { logError } from '@/services/error-log';

import type { SpeakingTask } from '../grading/speaking';
import type { TorflLevel } from '../level-profile';
import type { SpeakingAnswer, SpeakingWordStamp } from '../model';

/**
 * The exam recorder (T73, TORFL §8.4) — the glue between the pure engine's
 * `START_REC` / `STOP_REC` effects and the native recorder: it opens the
 * mic, runs the M17 endpointer over the level events (the `patient`
 * preset with the task's cap; a task-3 answer is a FIXED window — no
 * endpointing, the engine's deadline stops it), stops on silence / cap /
 * «Закончить», moves the cache WAV into `recordings/exam/<attemptId>/`,
 * queues the Opus transcode, transcribes (Zipformer; + the Whisper assist
 * re-decode when installed) and hands the finished `SpeakingAnswer` back
 * through `onDone` (→ `REC_DONE`). A recording that captured nothing still
 * produces an answer with an empty transcript — the item was sat.
 *
 * One recording at a time; `cancel()` drops an in-flight recording without
 * an answer (quit / abandon).
 */

export type RecorderPhase = 'idle' | 'recording' | 'processing';

export interface RecorderStart {
  itemId: string;
  task: SpeakingTask;
  capMs: number;
  fixedWindow: boolean;
  /** Which recordings-root dir the file goes under (the attempt id). */
  attemptId: string;
  /** T75 (THE LEVEL RULE): the exam's level for `exam_recording_saved`; default A1. */
  level?: TorflLevel;
}

export interface ExamRecorder {
  phase: RecorderPhase;
  /** Normalized mic RMS 0..1 while recording. */
  level: number;
  endpoint: EndpointState;
  /** The item being recorded / processed (null when idle). */
  itemId: string | null;
  start: (s: RecorderStart) => Promise<void>;
  /** «Закончить» / the engine's STOP_REC: stop now; the answer follows through `onDone`. */
  stop: (reason?: EndpointReason) => void;
  cancel: () => Promise<void>;
}

export interface RecorderEvents {
  onDone: (itemId: string, answer: SpeakingAnswer) => void;
  /** A recording was saved to disk (`exam_recording_saved {task, ms, level}`). */
  onSaved?: (task: SpeakingTask, ms: number) => void;
}

const SENSITIVITY = 'patient';

function toStamps(words: { word: string; startMs: number; endMs: number }[]): SpeakingWordStamp[] {
  return words.map((w) => ({ w: w.word, s: Math.round(w.startMs), e: Math.round(w.endMs) }));
}

export function useExamRecorder(events: RecorderEvents): ExamRecorder {
  const [phase, setPhase] = React.useState<RecorderPhase>('idle');
  const [level, setLevel] = React.useState(0);
  const [endpoint, setEndpoint] = React.useState<EndpointState>(INITIAL_ENDPOINT);
  const [itemId, setItemId] = React.useState<string | null>(null);

  const eventsRef = React.useRef(events);
  React.useEffect(() => {
    eventsRef.current = events;
  });
  const phaseRef = React.useRef<RecorderPhase>('idle');
  const epRef = React.useRef<EndpointState>(INITIAL_ENDPOINT);
  const cfgRef = React.useRef<EndpointConfig | null>(null);
  const currentRef = React.useRef<RecorderStart | null>(null);
  const stoppingRef = React.useRef(false);
  const serialRef = React.useRef(0);

  const setPhaseBoth = React.useCallback((p: RecorderPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const finish = React.useCallback(
    async (reason: EndpointReason) => {
      const cur = currentRef.current;
      if (!cur || stoppingRef.current) return;
      stoppingRef.current = true;
      const serial = ++serialRef.current;
      setPhaseBoth('processing');
      const res = await stopAttemptRecording().catch(() => null);
      const wavUri = res
        ? res.path.startsWith('file://')
          ? res.path
          : `file://${res.path}`
        : null;
      const durationMs = res?.durationMs ?? 0;
      let transcript = '';
      let assistTranscript: string | undefined;
      let words: SpeakingWordStamp[] | undefined;
      let recordingPath: string | null = null;
      if (wavUri && durationMs > 0 && reason !== 'no-speech') {
        // Transcribe from the cache WAV FIRST (the move is instant; the decode is the slow part).
        try {
          const r = await transcribeWav(wavUri);
          transcript = r.text;
          words = toStamps(r.words);
        } catch (err) {
          logError('manual', err);
        }
        if (isAssistInstalled()) {
          try {
            assistTranscript = (await transcribeWithAssist(wavUri, 'ru')).text;
          } catch (err) {
            logError('manual', err);
          }
        }
        recordingPath = stashExamWav(cur.attemptId, cur.task, cur.itemId, wavUri);
        if (recordingPath) {
          eventsRef.current.onSaved?.(cur.task, durationMs);
          trackTorfl('exam_recording_saved', {
            task: cur.task,
            ms: durationMs,
            level: cur.level ?? 'A1',
          });
        }
      }
      if (serial !== serialRef.current) return; // cancelled meanwhile
      const answer: SpeakingAnswer = {
        kind:
          cur.task === 3
            ? 'speaking-monologue'
            : cur.task === 2
              ? 'speaking-situation'
              : 'speaking-reply',
        transcript,
        ...(assistTranscript !== undefined ? { assistTranscript } : {}),
        ...(words && words.length > 0 ? { words } : {}),
        recordingPath,
        durationMs,
      };
      currentRef.current = null;
      stoppingRef.current = false;
      setPhaseBoth('idle');
      setItemId(null);
      setLevel(0);
      eventsRef.current.onDone(cur.itemId, answer);
    },
    [setPhaseBoth],
  );

  const start = React.useCallback(
    async (s: RecorderStart) => {
      if (phaseRef.current !== 'idle') {
        await cancelAttemptRecording().catch(() => undefined);
      }
      currentRef.current = s;
      stoppingRef.current = false;
      epRef.current = INITIAL_ENDPOINT;
      setEndpoint(INITIAL_ENDPOINT);
      // A fixed window never endpoints: the engine's TICK deadline sends STOP_REC. The cap is
      // the task's (30 s / 40 s); no-speech still ends a silent reply after 6 s.
      cfgRef.current = s.fixedWindow
        ? null
        : endpointConfig(SENSITIVITY, { capMs: Math.max(1000, s.capMs) });
      setItemId(s.itemId);
      setPhaseBoth('recording');
      try {
        await startAttemptRecording();
      } catch (err) {
        logError('manual', err);
        currentRef.current = null;
        setPhaseBoth('idle');
        setItemId(null);
        // The mic failed to open: the item gets an empty answer so the exam moves on.
        eventsRef.current.onDone(s.itemId, {
          kind:
            s.task === 3
              ? 'speaking-monologue'
              : s.task === 2
                ? 'speaking-situation'
                : 'speaking-reply',
          transcript: '',
          recordingPath: null,
          durationMs: 0,
        });
      }
    },
    [setPhaseBoth],
  );

  const stop = React.useCallback(
    (reason: EndpointReason = 'manual') => {
      if (phaseRef.current !== 'recording') return;
      const decision = endpointManualStop(
        epRef.current,
        epRef.current.elapsedMs,
        reason === 'hold' ? 'hold' : 'manual',
      );
      epRef.current = decision.state;
      setEndpoint(decision.state);
      void finish(reason);
    },
    [finish],
  );

  const cancel = React.useCallback(async () => {
    serialRef.current += 1;
    currentRef.current = null;
    stoppingRef.current = false;
    if (phaseRef.current === 'recording') await cancelAttemptRecording().catch(() => undefined);
    epRef.current = INITIAL_ENDPOINT;
    setEndpoint(INITIAL_ENDPOINT);
    setPhaseBoth('idle');
    setItemId(null);
    setLevel(0);
  }, [setPhaseBoth]);

  // Level events → the endpointer (tap mode only; a fixed window just shows the meter).
  React.useEffect(() => {
    const sub = SherpaSpeech.addListener('onRecordingLevel', ({ level: l, elapsedMs }) => {
      setLevel(l);
      if (phaseRef.current !== 'recording') return;
      const cfg = cfgRef.current;
      if (!cfg) return;
      const decision = endpointStep(epRef.current, { level: l, elapsedMs }, cfg);
      epRef.current = decision.state;
      setEndpoint(decision.state);
      if (decision.stop) void finish(decision.stop.reason);
    });
    return () => sub.remove();
  }, [finish]);

  // Unmount: drop whatever is running (the engine's RESUME skips the item).
  React.useEffect(
    () => () => {
      serialRef.current += 1;
      if (phaseRef.current === 'recording') void cancelAttemptRecording().catch(() => undefined);
    },
    [],
  );

  return { phase, level, endpoint, itemId, start, stop, cancel };
}

/** Enqueue the Opus transcode of a saved exam recording (the executor calls it once the response row exists). */
export function enqueueExamTranscode(attemptId: string, responseId: string, wavName: string): void {
  transcodeQueue().enqueue({ runId: attemptId, attemptId: responseId, wavName, root: 'exam' });
}
