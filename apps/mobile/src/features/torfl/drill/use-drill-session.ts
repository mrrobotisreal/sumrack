import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Alert, BackHandler } from 'react-native';

import { invalidateExams } from '@/db/hooks';
import { repos } from '@/db';
import {
  onSessionEnded,
  recordExamDeckSession,
  recordExamDrillFinished,
} from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import type { ExamScoreArgs } from './types';
import {
  DECK_SESSION_MAX,
  drillEntriesFromExam,
  drillIdentity,
  entryForDeckCard,
  pickLightning,
  summarizeDrill,
  type DrillEntry,
  type DrillResult,
  type DrillSource,
  type DrillSummary,
} from './drill-model';
import { createDrillRecorder, type DrillRecorder } from './drill-recorder';
import type { TorflLevel } from '../level-profile';
import { LIGHTNING_PACE_SEC, averageSeconds } from '../pace';

export type DrillPhase = 'loading' | 'empty' | 'playing' | 'summary' | 'error';

export interface DrillParams {
  source: DrillSource;
  packId?: string;
  examId?: string;
  topic?: string;
  /** THE LEVEL RULE (T75): the deck / «Молния» level; absent = A1 (back-compat). */
  level?: TorflLevel;
}

export interface DrillOutcome {
  summary: DrillSummary;
  results: DrillResult[];
  skipped: { writing: number; speaking: number };
  xp: number;
  /** Lightning: average seconds per item vs the exam pace. */
  avgSec: number;
  source: DrillSource;
}

/**
 * The drill session state machine (T70): build the queue (set / deck /
 * lightning) → play item by item → record each answer through the drill
 * recorder (response + deck card) → summary + ONE `game_sessions` row
 * (`exam-drill`) + XP once + events. Quitting mid-way keeps every recorded
 * answer (attempt → abandoned) and still closes the game session.
 */
export function useDrillSession(params: DrillParams) {
  const { source, packId, examId, topic } = params;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [phase, setPhase] = React.useState<DrillPhase>('loading');
  const [entries, setEntries] = React.useState<DrillEntry[]>([]);
  const [index, setIndex] = React.useState(0);
  const [outcome, setOutcome] = React.useState<DrillOutcome | null>(null);
  const [skipped, setSkipped] = React.useState({ writing: 0, speaking: 0 });
  const [attempt, setAttempt] = React.useState(0);

  const recorderRef = React.useRef<DrillRecorder | null>(null);
  const resultsRef = React.useRef<DrillResult[]>([]);
  const gameSessionRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef(0);
  const dueAtStartRef = React.useRef(0);
  const finishedRef = React.useRef(false);
  const pendingRef = React.useRef<Promise<unknown>[]>([]);
  const skippedRef = React.useRef({ writing: 0, speaking: 0 });

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setPhase('loading');
      try {
        // Orphans of a session the OS killed mid-drill (drill attempts only — never a mock).
        await repos.exams.abandonActiveDrills();
        const queue = await buildQueue(params);
        if (cancelled) return;
        skippedRef.current = queue.skipped;
        setSkipped(queue.skipped);
        if (queue.entries.length === 0) {
          setPhase('empty');
          return;
        }
        recorderRef.current = createDrillRecorder(repos.exams);
        resultsRef.current = [];
        finishedRef.current = false;
        const identity = drillIdentity(source, queue.entries, { packId, examId, topic });
        const row = await repos.stats.startGameSession('exam-drill', {
          source,
          kind: identity.subtestKind,
        });
        if (cancelled) return;
        gameSessionRef.current = row.id;
        startedAtRef.current = Date.now();
        dueAtStartRef.current =
          source === 'deck'
            ? (await repos.exams.deckCounts(Date.now(), { level: params.level ?? 'A1' })).due
            : 0;
        setEntries(queue.entries);
        setIndex(0);
        setPhase('playing');
        track('exam_drill_started', { ...identity, items: queue.entries.length });
      } catch (err) {
        if (cancelled) return;
        logError('manual', err);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // params are route-derived and stable per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const wrapUp = React.useCallback(
    async (completed: boolean) => {
      const recorder = recorderRef.current;
      if (!recorder) return;
      await Promise.allSettled(pendingRef.current);
      if (completed) await recorder.finish();
      else await recorder.abandon();
      const sessionId = gameSessionRef.current;
      const results = resultsRef.current;
      if (sessionId) {
        await repos.stats.finishGameSession(sessionId, {
          itemCount: results.length,
          correctCount: results.filter((r) => r.outcome === 'full').length,
          detail: { source, completed },
        });
      }
      void onSessionEnded().catch((err) => console.warn('[drill] sweep failed', err));
      void invalidateExams();
      void queryClient.invalidateQueries({ queryKey: ['daily-activity'] });
      void queryClient.invalidateQueries({ queryKey: ['motivation'] });
    },
    [queryClient, source],
  );

  /** Record one answered item (the host awaits nothing; `next()` advances). */
  const answered = React.useCallback((entry: DrillEntry, args: ExamScoreArgs) => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    resultsRef.current.push({
      itemKey: entry.itemKey,
      itemId: entry.item.id,
      topic: entry.item.topic,
      subtestKind: entry.subtest.kind,
      outcome: args.score.outcome,
      ms: args.ms,
      label: entry.item.kind === 'choice' ? entry.item.stem : entry.item.prompt,
    });
    track('exam_drill_item_answered', {
      subtestKind: entry.subtest.kind,
      topic: entry.item.topic,
      correct: args.score.outcome === 'full',
      ms: Math.round(args.ms),
    });
    pendingRef.current.push(
      recorder.answer(entry, args.answer, args.score, args.ms).catch((err) => {
        logError('manual', err);
      }),
    );
  }, []);

  const next = React.useCallback(async () => {
    if (finishedRef.current) return;
    const nextIdx = index + 1;
    if (nextIdx < entries.length) {
      setIndex(nextIdx);
      return;
    }
    finishedRef.current = true;
    const results = [...resultsRef.current];
    const summary = summarizeDrill(results);
    const ms = Date.now() - startedAtRef.current;
    await wrapUp(true);
    let xp = 0;
    try {
      xp = source === 'deck' ? await recordExamDeckSession() : await recordExamDrillFinished();
    } catch (err) {
      console.warn('[drill] xp failed', err);
    }
    const identity = drillIdentity(source, entries, { packId, examId, topic });
    track('exam_drill_finished', {
      ...identity,
      answered: summary.answered,
      correct: summary.correct,
      ms,
    });
    if (source === 'deck') {
      track('exam_deck_reviewed', { due: dueAtStartRef.current, reviewed: summary.answered });
    }
    setOutcome({
      summary,
      results,
      skipped: skippedRef.current,
      xp,
      avgSec: averageSeconds(summary.totalMs, summary.answered),
      source,
    });
    setPhase('summary');
  }, [index, entries, source, packId, examId, topic, wrapUp]);

  const quit = React.useCallback(() => {
    if (phase !== 'playing') {
      router.back();
      return;
    }
    const n = resultsRef.current.length;
    Alert.alert('Закончить тренировку?', `Уже записано ответов: ${n} — они сохранятся.`, [
      { text: 'Продолжить', style: 'cancel' },
      {
        text: 'Закончить',
        style: 'destructive',
        onPress: () => {
          finishedRef.current = true;
          void wrapUp(false).finally(() => router.back());
        },
      },
    ]);
  }, [phase, router, wrapUp]);

  React.useEffect(() => {
    if (phase !== 'playing') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      quit();
      return true;
    });
    return () => sub.remove();
  }, [phase, quit]);

  return {
    phase,
    entries,
    index,
    entry: entries[index],
    outcome,
    skipped,
    answered,
    next,
    quit,
    retry: () => setAttempt((a) => a + 1),
    router,
  };
}

async function buildQueue(
  params: DrillParams,
): Promise<{ entries: DrillEntry[]; skipped: { writing: number; speaking: number } }> {
  const { source, packId, examId, topic } = params;
  const none = { writing: 0, speaking: 0 };
  if (source === 'set') {
    if (!packId || !examId) return { entries: [], skipped: none };
    const exam = await repos.exams.getExam(packId, examId);
    if (!exam) return { entries: [], skipped: none };
    const q = drillEntriesFromExam(exam, packId, { topic });
    return { entries: q.entries, skipped: q.skipped };
  }
  if (source === 'deck') {
    const cards = await repos.exams.dueItems({
      limit: DECK_SESSION_MAX * 2,
      level: params.level ?? 'A1',
    });
    const exams = new Map<string, Awaited<ReturnType<typeof repos.exams.getExam>>>();
    const out: DrillEntry[] = [];
    for (const card of cards) {
      const key = `${card.packId}/${card.examId}`;
      if (!exams.has(key)) exams.set(key, await repos.exams.getExam(card.packId, card.examId));
      const entry = entryForDeckCard(card, exams.get(key) ?? null);
      if (entry) out.push(entry);
      if (out.length >= DECK_SESSION_MAX) break;
    }
    return { entries: out, skipped: none };
  }
  // lightning: every lexgram item of every installed drill exam, weighted draw
  const level = params.level ?? 'A1';
  const drills = await repos.exams.listExams({ mode: 'drill', level });
  const candidates: DrillEntry[] = [];
  for (const s of drills) {
    if (!s.exam) continue;
    candidates.push(...drillEntriesFromExam(s.exam, s.packId).entries);
  }
  const stats = await repos.exams.topicStats({ subtestKind: 'lexgram', level });
  return { entries: pickLightning(candidates, stats), skipped: none };
}

export { LIGHTNING_PACE_SEC };
