import { useQueryClient } from '@tanstack/react-query';
import type { Exam } from '@sumrak/schema';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { AppState } from 'react-native';

import { repos } from '@/db';
import { invalidateExams } from '@/db/hooks';
import type { ExamAttempt } from '@/db/repositories/exams';
import { recordExamFinished } from '@/features/motivation/service';
import { scheduleExamBundle } from '@/features/scenario/recordings/bundle-service';
import { pruneRecordings } from '@/features/scenario/recordings/prune';
import { trackTorfl } from '@/services/analytics';
import { logError } from '@/services/error-log';

import { hasApiKey } from '@/features/ai/config';

import { gradeWritingOffline, offlineItemScore } from '../grading/writing';
import {
  gradeSpeakingOffline,
  offlineSpeakingPoints,
  responseShare,
  speakingTaskOf,
} from '../grading/speaking';
import { pumpGradingQueue } from '../grading/queue';
import type { ExamAnswer, ExamGrading, SpeakingAnswer } from '../model';
import {
  enqueueExamTranscode,
  useExamRecorder,
  type ExamRecorder,
} from '../speaking/use-exam-recorder';
import { getTorflPrefs } from '../settings';
import { DEFAULT_TORFL_PREFS, type TorflPrefs } from '../settings-core';
import { fileExists } from '../drill/drill-item';
import {
  answeredCount,
  currentSubtest,
  hydrate,
  itemTotal,
  reduce,
  remainingMs,
  toPersisted,
  type ExamCtx,
  type ExamEffect,
  type ExamEvent,
  type ExamRunState,
} from './exam-machine';
import { preflightListening, type ListeningPreflight } from './assets';
import { scoreItem } from '../scoring';
import { torflLevelOf } from '../level-profile';
import { writingShare, writingTaskOf } from '../writing/writing-model';
import { finalizeAttempt } from './finalize';
import { devDurationOverrideSec } from './rules';

/** `saveState` is throttled to one write per this many ms (urgent writes bypass it). */
export const STATE_THROTTLE_MS = 5_000;
const TICK_MS = 1_000;

export type RunLoad =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' };

export interface ExamRun {
  load: RunLoad;
  exam: Exam | null;
  attempt: ExamAttempt | null;
  prefs: TorflPrefs;
  state: ExamRunState | null;
  /** Wall-clock now, refreshed every second (render only; deadlines are epochs). */
  now: number;
  remainingMs: number;
  send: (event: ExamEvent) => void;
  /** The listening preflight of the current listening subtest (null otherwise). */
  listening: ListeningPreflight | null;
  /** Audio keys that cannot play (mock refuses TTS). Non-empty ⇒ show «Скачай аудио по Wi-Fi». */
  audioMissing: string[];
  /** Set once the run has finished (results route target). */
  finishedAttemptId: string | null;
  /** True while the finish transaction runs. */
  finishing: boolean;
  /** T73: the speaking recorder (level / phase for the mic ring; the executor drives it). */
  recorder: ExamRecorder;
}

/**
 * The mock executor (T71, TORFL §8.1): loads the exam + the active attempt,
 * hydrates the pure engine, and PERFORMS its effects —
 *  - `PERSIST_RESPONSE` → `recordResponse` immediately on every answer (the
 *    responses table is the truth; a crash never loses an answer),
 *  - `PERSIST_STATE` → `saveState`, throttled ≤ 1 / 5 s unless `urgent`,
 *    and flushed when the app backgrounds,
 *  - `SCORE_SUBTEST` → T70 scoring (`scoreSubtest`) → the per-response
 *    `points` + the analytics row `exam_subtest_submitted`; a WRITING
 *    subtest (T72) gets the offline provisional grade per letter and goes
 *    `pending-ai` (a key exists → the grading queue pumps at once) or stays
 *    `provisional`,
 *  - `START_REC` / `STOP_REC` (T73) → the exam recorder hook (mic → endpoint
 *    → WAV under `recordings/exam/<attemptId>/` → Opus queue → Zipformer +
 *    Whisper transcripts) whose `onDone` sends `REC_DONE {answer}`; a
 *    SPEAKING `PERSIST_RESPONSE` also queues the transcode once the row
 *    exists, and a speaking `SCORE_SUBTEST` grades every recorded answer
 *    offline (judge / coverage / estimate) → `pending-ai` or `provisional`,
 *  - `FINISH` → `finalizeAttempt` (results, verdict, XP, deck entries after
 *    finish) → the results route,
 *  - `ABANDON` → `abandonAttempt`.
 * Also: a 1 s `TICK` (render clock + deadline + listening gap), AppState →
 * `APP_BACKGROUND` / `RESUME`, and `exam_resumed` when a stored run is reopened.
 *
 * Audio playback itself lives in `ListeningPlayer mode="exam"`, which reads
 * `state.audio` / `state.playCounts` — the `PLAY_AUDIO` effect here only logs
 * `exam_audio_played {playNo}` (so a play is counted once, when the engine
 * started it).
 */
export function useExamRun(attemptId: string, devDurationSecParam?: string): ExamRun {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [load, setLoad] = React.useState<RunLoad>({ status: 'loading' });
  const [exam, setExam] = React.useState<Exam | null>(null);
  const [attempt, setAttempt] = React.useState<ExamAttempt | null>(null);
  const [prefs, setPrefs] = React.useState<TorflPrefs>(DEFAULT_TORFL_PREFS);
  const [state, setState] = React.useState<ExamRunState | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [listening, setListening] = React.useState<ListeningPreflight | null>(null);
  const [finishedAttemptId, setFinishedAttemptId] = React.useState<string | null>(null);
  const [finishing, setFinishing] = React.useState(false);

  const stateRef = React.useRef<ExamRunState | null>(null);
  const ctxRef = React.useRef<ExamCtx | null>(null);
  const attemptRef = React.useRef<ExamAttempt | null>(null);
  const lastSaveRef = React.useRef(0);
  const dirtyRef = React.useRef(false);
  const queueRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const finishingRef = React.useRef(false);
  const startedAtBySubtestRef = React.useRef(new Map<string, number>());

  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  const overrideSec = devDurationOverrideSec(devDurationSecParam, dev);

  // T73: the recorder reports back through `REC_DONE`; `send` is defined below, so go through a ref.
  const sendRef = React.useRef<(event: ExamEvent) => void>(() => undefined);
  const recorder = useExamRecorder({
    onDone: (itemId, answer) =>
      sendRef.current({ type: 'REC_DONE', itemId, answer, now: Date.now() }),
  });
  const recorderRef = React.useRef(recorder);
  React.useEffect(() => {
    recorderRef.current = recorder;
  });

  /** Serialize DB side effects so responses, state and the finish never interleave. */
  const enqueue = React.useCallback((job: () => Promise<unknown>) => {
    queueRef.current = queueRef.current.then(job).catch((err) => logError('manual', err));
    return queueRef.current;
  }, []);

  const saveStateNow = React.useCallback(() => {
    const s = stateRef.current;
    const a = attemptRef.current;
    if (!s || !a || finishingRef.current) return;
    lastSaveRef.current = Date.now();
    dirtyRef.current = false;
    const snapshot = toPersisted(s);
    void enqueue(async () => {
      try {
        await repos.exams.saveState(a.id, snapshot);
      } catch (err) {
        // The attempt was finished/abandoned underneath us — nothing left to save.
        if (!String(err).includes('not active')) throw err;
      }
    });
  }, [enqueue]);

  const perform = React.useCallback(
    (effects: ExamEffect[]) => {
      const ctx = ctxRef.current;
      const a = attemptRef.current;
      if (!ctx || !a) return;
      // T75 (THE LEVEL RULE): every analytics event of this run carries the exam's level.
      const level = torflLevelOf(ctx.exam.level);
      for (const e of effects) {
        switch (e.type) {
          case 'PERSIST_RESPONSE': {
            const subtest = ctx.exam.subtests.find((s) => s.id === e.subtestId);
            const item = subtest?.parts.flatMap((p) => p.items).find((i) => i.id === e.itemId);
            if (!subtest || !item) break;
            const speakingKind = speakingTaskOf(item) !== null;
            void enqueue(async () => {
              const row = await repos.exams.recordResponse({
                attemptId: a.id,
                subtestId: e.subtestId,
                itemId: e.itemId,
                answer: e.answer,
                // Scored at SCORE_SUBTEST — never stored (and never shown) during the sitting.
                points: null,
                maxPoints:
                  item.kind === 'writing'
                    ? writingShare(subtest)
                    : speakingKind
                      ? responseShare(subtest, item)
                      : (subtest.pointsPerItem ?? item.points ?? 1),
                // T72/T73: a letter draft / a recorded answer is `provisional` until the subtest closes.
                gradingStatus: item.kind === 'writing' || speakingKind ? 'provisional' : 'scored',
                durationMs:
                  e.answer.kind === 'speaking-reply' ||
                  e.answer.kind === 'speaking-situation' ||
                  e.answer.kind === 'speaking-monologue'
                    ? e.answer.durationMs
                    : undefined,
              });
              // T73: the row exists → the WAV may transcode (the queue rewrites `recordingPath`).
              const rec =
                e.answer.kind === 'speaking-reply' ||
                e.answer.kind === 'speaking-situation' ||
                e.answer.kind === 'speaking-monologue'
                  ? e.answer.recordingPath
                  : null;
              if (rec && rec.endsWith('.wav')) enqueueExamTranscode(a.id, row.id, rec);
            });
            break;
          }
          case 'PERSIST_STATE': {
            if (e.urgent || Date.now() - lastSaveRef.current >= STATE_THROTTLE_MS) saveStateNow();
            else dirtyRef.current = true;
            break;
          }
          case 'SUBTEST_STARTED': {
            startedAtBySubtestRef.current.set(e.subtestId, Date.now());
            trackTorfl('exam_subtest_started', { subtestKind: e.kind, scope: a.scope, level });
            break;
          }
          case 'PLAY_AUDIO': {
            trackTorfl('exam_audio_played', { playNo: e.playNo, level });
            break;
          }
          case 'SCORE_SUBTEST': {
            const subtest = ctx.exam.subtests.find((s) => s.id === e.subtestId);
            const answers = stateRef.current?.answers ?? {};
            trackTorfl('exam_subtest_submitted', {
              subtestKind: e.kind,
              answered: e.answered,
              total: e.total,
              autoSubmitted: e.autoSubmitted,
              timeUsedSec: e.timeUsedSec,
              level,
            });
            if (!subtest) break;
            if (subtest.kind === 'speaking') {
              // T73: the offline provisional grade per recorded answer, then the AI queue when a key exists.
              void enqueue(async () => {
                const online = await hasApiKey();
                const detail = await repos.exams.getAttempt(a.id);
                const byItem = new Map((detail?.responses ?? []).map((r) => [r.itemId, r]));
                for (const part of subtest.parts) {
                  for (const item of part.items) {
                    const task = speakingTaskOf(item);
                    if (task === null) continue;
                    const given = answers[item.id];
                    const row = byItem.get(item.id);
                    const stored = row?.answer;
                    const answer: SpeakingAnswer | undefined =
                      given &&
                      (given.kind === 'speaking-reply' ||
                        given.kind === 'speaking-situation' ||
                        given.kind === 'speaking-monologue')
                        ? {
                            ...given,
                            recordingPath:
                              stored && stored.kind === given.kind
                                ? stored.recordingPath
                                : given.recordingPath,
                          }
                        : undefined;
                    // An unanswered item (skipped / the unchosen topic) gets no row: it is 0 of its share.
                    if (!answer) continue;
                    const grade = gradeSpeakingOffline(item, answer);
                    if (!grade) continue;
                    const share = responseShare(subtest, item);
                    const grading: ExamGrading = {
                      v: 1,
                      offline: { criteria: grade.criteria, details: { ...grade.details } },
                    };
                    const hasText =
                      answer.transcript.trim().length > 0 ||
                      (answer.assistTranscript ?? '').trim().length > 0;
                    await repos.exams.recordResponse({
                      attemptId: a.id,
                      subtestId: subtest.id,
                      itemId: item.id,
                      answer,
                      points: offlineSpeakingPoints(grade, share),
                      maxPoints: share,
                      // An empty answer is FINAL at 0 (nothing to send); a spoken one waits for the AI.
                      gradingStatus: !hasText ? 'scored' : online ? 'pending-ai' : 'provisional',
                      grading,
                      durationMs: answer.durationMs,
                    });
                    trackTorfl('exam_speaking_scored', {
                      task,
                      source: 'offline',
                      pct: grade.pct,
                      level,
                    });
                  }
                }
                if (online) void pumpGradingQueue();
              });
              break;
            }
            if (subtest.kind === 'writing') {
              // T72: the offline provisional grade per letter, then the AI queue when a key exists.
              void enqueue(async () => {
                const online = await hasApiKey();
                for (const part of subtest.parts) {
                  for (const item of part.items) {
                    if (item.kind !== 'writing') continue;
                    const given = answers[item.id];
                    const text = given?.kind === 'writing' ? given.text : '';
                    const grade = gradeWritingOffline(item, text);
                    const share = writingShare(subtest);
                    const score = offlineItemScore(grade, share);
                    const grading: ExamGrading = {
                      v: 1,
                      offline: { criteria: grade.criteria, details: { ...grade.details } },
                    };
                    await repos.exams.recordResponse({
                      attemptId: a.id,
                      subtestId: subtest.id,
                      itemId: item.id,
                      answer: { kind: 'writing', text },
                      points: score.points,
                      maxPoints: share,
                      gradingStatus:
                        online && text.trim().length > 0 ? 'pending-ai' : 'provisional',
                      grading,
                    });
                    trackTorfl('exam_writing_scored', {
                      source: 'offline',
                      pct: grade.pct,
                      sentences: grade.details.sentences,
                      questions: grade.details.questions,
                      pointsCovered: grade.details.pointsCovered,
                      ...writingTaskOf(ctx.exam, subtest.id, item.id),
                      level,
                    });
                  }
                }
                if (online) void pumpGradingQueue();
              });
              break;
            }
            // Write the per-response points now that the subtest is closed (review reads them).
            void enqueue(async () => {
              const detail = await repos.exams.getAttempt(a.id);
              const byItem = new Map((detail?.responses ?? []).map((r) => [r.itemId, r]));
              for (const part of subtest.parts) {
                for (const item of part.items) {
                  const r = byItem.get(item.id);
                  if (!r || !r.answer) continue;
                  const given = answers[item.id];
                  const score = scoreItem(
                    item,
                    given?.kind === 'typed'
                      ? { text: given.text }
                      : { index: given?.kind === 'choice' ? given.index : null },
                    subtest,
                  );
                  const earned = score?.points ?? 0;
                  await repos.exams.recordResponse({
                    attemptId: a.id,
                    subtestId: subtest.id,
                    itemId: item.id,
                    answer: r.answer,
                    points: earned,
                    maxPoints: r.maxPoints,
                    gradingStatus: 'scored',
                    durationMs: r.durationMs,
                  });
                }
              }
            });
            break;
          }
          case 'FINISH': {
            if (finishingRef.current) break;
            finishingRef.current = true;
            setFinishing(true);
            void enqueue(async () => {
              const s = stateRef.current;
              if (!s) return;
              // The FINAL engine state first (skipped / timeUsedSec / autoSubmitted feed the results screen).
              await repos.exams.saveState(a.id, toPersisted(s));
              const out = await finalizeAttempt(
                {
                  exams: repos.exams,
                  rewards: (input, opts) => recordExamFinished(input, opts),
                },
                {
                  attemptId: a.id,
                  packId: a.packId,
                  examId: a.examId,
                  scope: a.scope === 'full' ? 'full' : 'subtest',
                  exam: ctx.exam,
                  state: s,
                  answers: s.answers,
                },
              );
              const pct = (k: 'lexgram' | 'reading' | 'listening' | 'writing' | 'speaking') =>
                out.finish.pcts[k] ?? -1;
              trackTorfl('exam_finished', {
                scope: a.scope,
                verdict: out.verdict ?? 'none',
                lexgramPct: pct('lexgram'),
                readingPct: pct('reading'),
                listeningPct: pct('listening'),
                writingPct: pct('writing'),
                speakingPct: pct('speaking'),
                provisional: out.provisional,
                level,
              });
              void invalidateExams();
              void queryClient.invalidateQueries({ queryKey: ['daily-activity'] });
              void queryClient.invalidateQueries({ queryKey: ['motivation'] });
              // T74 (§8.5): the attempt's media bundle (after its transcodes) + the post-run
              // prune — both off the queue, neither blocks the results screen.
              if (Object.values(s.answers).some((ans) => ans.kind.startsWith('speaking-'))) {
                scheduleExamBundle(a.id);
              }
              void pruneRecordings('post-run');
              setFinishedAttemptId(a.id);
              setFinishing(false);
            });
            break;
          }
          case 'START_REC': {
            void recorderRef.current.start({
              itemId: e.itemId,
              task: e.task,
              capMs: e.capMs,
              fixedWindow: e.fixedWindow,
              attemptId: a.id,
              level,
            });
            break;
          }
          case 'STOP_REC': {
            // Stop whatever is recording; the hook's onDone → REC_DONE. Idle = no-op.
            recorderRef.current.stop('manual');
            break;
          }
          case 'ABANDON': {
            void recorderRef.current.cancel();
            void enqueue(async () => {
              const s = stateRef.current;
              const cur = s ? s.subtests[s.current] : undefined;
              const subtest = s ? currentSubtest(ctx, s) : undefined;
              trackTorfl('exam_abandoned', {
                scope: a.scope,
                subtestKind: cur?.kind ?? 'none',
                answered: subtest && s ? answeredCount(subtest, s.answers) : 0,
                level,
              });
              await repos.exams.abandonAttempt(a.id);
              void invalidateExams();
            });
            break;
          }
          default:
            break;
        }
      }
    },
    [enqueue, queryClient, saveStateNow],
  );

  const send = React.useCallback(
    (event: ExamEvent) => {
      const ctx = ctxRef.current;
      const s = stateRef.current;
      if (!ctx || !s) return;
      const t = reduce(ctx, s, event);
      if (t.state !== s) {
        stateRef.current = t.state;
        setState(t.state);
      }
      perform(t.effects);
    },
    [perform],
  );
  React.useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // --- load ------------------------------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const detail = await repos.exams.getAttempt(attemptId);
        if (cancelled) return;
        if (!detail || detail.status !== 'active' || !detail.state) {
          setLoad({ status: 'error', message: 'Попытка не найдена или уже завершена.' });
          return;
        }
        const loadedExam = await repos.exams.getExam(detail.packId, detail.examId);
        if (cancelled) return;
        if (!loadedExam) {
          setLoad({ status: 'error', message: 'Экзамен не найден — возможно, пакет удалён.' });
          return;
        }
        const loadedPrefs = await getTorflPrefs();
        const answers: Record<string, ExamAnswer> = {};
        for (const r of detail.responses) if (r.answer) answers[r.itemId] = r.answer;
        const ids = detail.subtestIds ?? loadedExam.subtests.map((s) => s.id);
        const hydrated = hydrate(loadedExam, detail.state, answers);
        const fullScope = detail.scope === 'full' && ids.length > 1;
        ctxRef.current = {
          exam: loadedExam,
          breakBetween: loadedPrefs.breakBetweenSubtests && fullScope,
          durationOverrideSec: overrideSec,
        };
        attemptRef.current = detail;
        stateRef.current = hydrated;
        setExam(loadedExam);
        setAttempt(detail);
        setPrefs(loadedPrefs);
        setState(hydrated);
        setLoad({ status: 'ready' });
        // A fresh attempt (phase 'intro') opens its first subtest's instruction screen.
        if (hydrated.phase === 'intro') {
          const t = reduce(ctxRef.current, hydrated, { type: 'START', now: Date.now() });
          stateRef.current = t.state;
          setState(t.state);
          perform(t.effects);
        }
        // A stored run that was already running when we opened it is a RESUME.
        if (hydrated.phase === 'running') {
          const cur = hydrated.subtests[hydrated.current];
          const at = Date.now();
          trackTorfl('exam_resumed', {
            scope: detail.scope,
            subtestKind: cur?.kind ?? 'none',
            remainingSec: Math.round(remainingMs(hydrated, at) / 1000),
            level: torflLevelOf(loadedExam.level),
          });
          const t = reduce(ctxRef.current, hydrated, { type: 'RESUME', now: at });
          stateRef.current = t.state;
          setState(t.state);
          perform(t.effects);
        }
      } catch (err) {
        logError('manual', err);
        if (!cancelled) setLoad({ status: 'error', message: 'Не удалось открыть экзамен.' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // load once per attempt id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // --- listening preflight (a mock never plays TTS) --------------------------------------------
  const subtest = exam && state ? currentSubtest({ exam, breakBetween: false }, state) : undefined;
  const subtestId = subtest?.id;
  React.useEffect(() => {
    if (!exam || !attempt || !subtest || subtest.kind !== 'listening') return;
    let cancelled = false;
    void preflightListening(repos.content, attempt.packId, subtest, fileExists)
      .then((pf) => {
        if (!cancelled) setListening(pf);
      })
      .catch((err) => {
        logError('manual', err);
        if (!cancelled) setListening({ byKey: new Map(), missing: ['*'] });
      });
    return () => {
      cancelled = true;
    };
    // keyed on the subtest identity, not the object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam, attempt, subtestId]);

  // --- the 1 s tick ----------------------------------------------------------------------------
  React.useEffect(() => {
    if (load.status !== 'ready') return;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      const s = stateRef.current;
      if (!s || s.phase !== 'running') return;
      send({ type: 'TICK', now: at });
      if (dirtyRef.current && at - lastSaveRef.current >= STATE_THROTTLE_MS) saveStateNow();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [load.status, send, saveStateNow]);

  // --- app state: background flush + resume --------------------------------------------------------
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const at = Date.now();
      if (next === 'background' || next === 'inactive') {
        send({ type: 'APP_BACKGROUND', now: at });
        if (dirtyRef.current) saveStateNow();
      } else if (next === 'active') {
        setNow(at);
        const s = stateRef.current;
        if (s && s.phase === 'running') {
          const cur = s.subtests[s.current];
          trackTorfl('exam_resumed', {
            scope: attemptRef.current?.scope ?? 'full',
            subtestKind: cur?.kind ?? 'none',
            remainingSec: Math.round(remainingMs(s, at) / 1000),
            level: torflLevelOf(ctxRef.current?.exam.level),
          });
        }
        send({ type: 'RESUME', now: at });
      }
    });
    return () => sub.remove();
  }, [send, saveStateNow]);

  // --- unmount: flush the state (the attempt stays resumable) -------------------------------------
  React.useEffect(
    () => () => {
      if (!finishingRef.current && dirtyRef.current) saveStateNow();
    },
    [saveStateNow],
  );

  // Navigate to the results once the finish transaction completed.
  React.useEffect(() => {
    if (finishedAttemptId) router.replace(`/exam/results/${finishedAttemptId}`);
  }, [finishedAttemptId, router]);

  const rem = state ? remainingMs(state, now) : 0;
  // A stale preflight (a previous listening subtest) is ignored outside listening.
  const activeListening = subtest?.kind === 'listening' ? listening : null;
  const audioMissing = activeListening?.missing ?? [];
  return {
    load,
    exam,
    attempt,
    prefs,
    state,
    now,
    remainingMs: rem,
    send,
    listening: activeListening,
    audioMissing,
    finishedAttemptId,
    finishing,
    recorder,
  };
}

export { itemTotal };
