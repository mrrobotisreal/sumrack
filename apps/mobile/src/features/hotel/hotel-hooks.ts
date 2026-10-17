import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourseItem, CourseUnit, LibraryQuote } from '@sumrak/schema';
import * as React from 'react';

import { repos } from '@/db';
import type { CourseFloorRow, ProgressRecord } from '@/db/repositories/course';
import type { SentenceWithTokens } from '@/db/repositories/content';
import { fileExists } from '@/features/torfl/drill/drill-item';
import { loadRefAudio, type ExamAudio } from '@/features/torfl/items/exam-audio';
import { SETTING_KEYS } from '@/db/repositories/settings';

import {
  drillBeforeAfter,
  firstUnitStart,
  floorState,
  parseLastFloor,
  reveal13,
} from './hotel-model';
import {
  cooldownLeft,
  debriefForSubtests,
  GATE_PACK_ID,
  missedByKind,
  nextHotelAction,
  type GradedResponse,
  type SubtestResult,
} from './gate-model';
import { findExamItem } from '@/features/torfl/model';
import { overallPct } from '@/features/torfl/hub-model';
import {
  lessonSentenceRefs,
  parseLessonPositions,
  type LessonPositions,
  type SentenceRefKey,
} from './lesson/lesson-model';

/** A floor by its pack id (the lesson's and the runner's source of truth). */
export function useCourseFloor(packId: string) {
  return useQuery({
    queryKey: ['hotel', 'floor', packId],
    queryFn: () => repos.course.getFloor(packId),
    enabled: packId.length > 0,
  });
}

/** Every course progress row (the runner and the lesson read their own). */
export function useCourseProgress() {
  return useQuery({
    queryKey: ['hotel', 'progress'],
    queryFn: () => repos.course.getProgress(),
  });
}

/** Resolved items of a set of ids, in order (missing items are dropped). */
export function useCourseItems(packId: string, ids: readonly string[]) {
  return useQuery({
    queryKey: ['hotel', 'items', packId, ids.join(',')],
    queryFn: () => repos.course.getItems(packId, ids),
    enabled: packId.length > 0 && ids.length > 0,
  });
}

export interface ResolvedLesson {
  /** `storyId/sentenceId` → the sentence and its narration span (null sentence = the story is gone). */
  sentences: Map<SentenceRefKey, { sentence: SentenceWithTokens | null; audio: ExamAudio | null }>;
  /** `packId/storyId` → the source pack/story title line («story, pack»). */
  sourceTitles: Map<string, string>;
}

/**
 * Every sentence a lesson shows (examples, trap rights, library quotes), with
 * its ▶ span. Missing stories resolve to a null sentence (a pack update can
 * remove a story; the card then shows what it can, never crashes).
 */
export function useLessonSentences(
  packId: string,
  unit: CourseUnit | null,
  quotes: readonly LibraryQuote[],
) {
  return useQuery({
    queryKey: ['hotel', 'lesson-sentences', packId, unit?.id ?? '', quotes.length],
    enabled: unit !== null,
    queryFn: async (): Promise<ResolvedLesson> => {
      const sentences: ResolvedLesson['sentences'] = new Map();
      const sourceTitles = new Map<string, string>();
      const refs = unit ? lessonSentenceRefs(unit) : [];
      const byStory = new Map<string, string[]>();
      for (const r of refs) {
        const list = byStory.get(r.storyId) ?? [];
        list.push(r.sentenceId);
        byStory.set(r.storyId, list);
      }
      for (const [storyId, ids] of byStory) {
        const detail = await repos.content.getStoryDetail(packId, storyId);
        for (const sentenceId of ids) {
          const key = `${storyId}/${sentenceId}` as SentenceRefKey;
          const sentence = detail?.sentences.find((s) => s.id === sentenceId) ?? null;
          const audio = detail
            ? await loadRefAudio(
                repos.content,
                packId,
                { storyId, sentenceIds: [sentenceId] },
                fileExists,
              )
            : null;
          sentences.set(key, { sentence, audio });
        }
      }
      for (const q of quotes) {
        const key = `${q.storyId}/${q.sentenceId}` as SentenceRefKey;
        if (sentences.has(key)) continue;
        const detail = await repos.content.getStoryDetail(q.packId, q.storyId);
        const sentence = detail?.sentences.find((s) => s.id === q.sentenceId) ?? null;
        const audio = detail
          ? await loadRefAudio(
              repos.content,
              q.packId,
              { storyId: q.storyId, sentenceIds: [q.sentenceId] },
              fileExists,
            )
          : null;
        sentences.set(key, { sentence, audio });
        const title = detail ? `${detail.story.titleRu}, ${detail.pack.titleRu}` : null;
        if (title) sourceTitles.set(`${q.packId}/${q.storyId}`, title);
      }
      return { sentences, sourceTitles };
    },
  });
}

/** The lesson position map (`hotel.lessonPos`). Reads are defensive; writes never throw into the UI. */
export function useLessonPositions() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['hotel', 'lessonPos'],
    queryFn: async (): Promise<LessonPositions> =>
      parseLessonPositions(await repos.settings.get<unknown>(SETTING_KEYS.hotelLessonPos)),
  });
  const save = React.useCallback(
    async (key: string, index: number) => {
      const current = qc.getQueryData<LessonPositions>(['hotel', 'lessonPos']) ?? {};
      const next = { ...current, [key]: index };
      qc.setQueryData(['hotel', 'lessonPos'], next);
      try {
        await repos.settings.set(SETTING_KEYS.hotelLessonPos, next);
      } catch {
        // A failed settings write only loses the resume point, never the lesson.
      }
    },
    [qc],
  );
  return { positions: query.data ?? {}, save, loaded: query.isSuccess };
}

export type { CourseFloorRow, ProgressRecord, CourseItem };

/** Every installed A1 hotel floor, as the lock rule reads it (course packs on the TORFL ladder). */
export function useHotelFloors() {
  return useQuery({
    queryKey: ['hotel', 'floors', 'A1'],
    queryFn: async () => repos.course.listFloors({ ladder: 'torfl', level: 'A1' }),
  });
}

/**
 * The hotel's live state (Today card, Путь tab, journal): the panel with the
 * lock rule applied, the gate, and the next action. Re-evaluates every 30 s so
 * cooldown countdowns tick from the rows (carried T90 decision 4).
 */
export function useHotelState() {
  const floors = useHotelFloors();
  const progress = useCourseProgress();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const gateInstalled = useQuery({
    queryKey: ['hotel', 'gate-installed'],
    queryFn: async () => (await repos.content.listPacks()).some((p) => p.id === GATE_PACK_ID),
  });
  const installed = (floors.data ?? []).map((f) => ({
    packId: f.packId,
    floor: f.floor,
    unitIds: f.course.units.map((u) => u.id),
    hasExam: f.course.floorExam !== undefined,
  }));
  const rows = progress.data ?? [];
  const states = floorState(installed, rows, now);
  const gateRow = rows.find((r) => r.packId === GATE_PACK_ID && r.unitId === null);
  const gatePassed = gateRow?.passedAt != null;
  const reveal13Now = reveal13(installed, rows, { mockInstalled: gateInstalled.data === true });
  const lastFloor = states.find((s) => !s.passed) ?? states[states.length - 1];
  const action = nextHotelAction(
    states.map((s) => {
      const f = floors.data?.find((x) => x.packId === s.packId);
      const cooldown = s.cooldownUntil !== null ? cooldownLeft(s.cooldownUntil, now) : null;
      return {
        packId: s.packId,
        floor: s.floor,
        unlocked: s.unlocked,
        passed: s.passed,
        examUnlocked: s.examUnlocked,
        examCooldownMinutes: cooldown?.minutesLeft ?? null,
        units: (f?.course.units ?? []).map((u) => {
          const us = s.units.find((x) => x.unitId === u.id);
          return {
            unitId: u.id,
            title: u.title.ru,
            passed: us?.passed ?? false,
            lessonOpened: rows.some(
              (r) => r.packId === s.packId && r.unitId === u.id && r.attempts > 0,
            ),
          };
        }),
      };
    }),
    { gatePassed, reveal13: reveal13Now },
  );

  return {
    states,
    action,
    gatePassed,
    reveal13: reveal13Now,
    lastFloor,
    now,
    loaded: floors.isSuccess && progress.isSuccess,
  };
}

/** `hotel.lastFloor` (T92 decision 4): the floor the lift was on, or null. Reads defensively. */
export function useLastFloor() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['hotel', 'lastFloor'],
    queryFn: async () =>
      parseLastFloor(await repos.settings.get<unknown>(SETTING_KEYS.hotelLastFloor)),
  });
  const save = React.useCallback(
    async (floor: number) => {
      qc.setQueryData(['hotel', 'lastFloor'], floor);
      try {
        await repos.settings.set(SETTING_KEYS.hotelLastFloor, floor);
      } catch {
        // A failed write only loses the resume floor; the lift still works.
      }
    },
    [qc],
  );
  return { lastFloor: query.data ?? null, loaded: query.isSuccess, save };
}

/**
 * The lesson-opened set (carried T92 decision 2): a unit whose lesson has a
 * saved card position was opened at least once. Keys are `packId:unitId`.
 */
export function useLessonOpened() {
  const positions = useLessonPositions();
  const opened = React.useMemo(() => {
    const set = new Set<string>();
    for (const key of Object.keys(positions.positions)) {
      const at = key.indexOf(':');
      if (at > 0) set.add(key.slice(at + 1));
    }
    return set;
  }, [positions.positions]);
  return opened;
}

/**
 * «Практика» rows for a floor (decision 2): one per `course.practice` ref whose
 * drill exam is installed (a missing pack hides the row), with its before/after
 * bests from `exam_attempts` scope `drill`, split at the floor's first unit attempt.
 */
export function usePracticeRows(
  floorPackId: string | null,
  practice: readonly { packId: string; examId: string }[],
) {
  return useQuery({
    queryKey: [
      'hotel',
      'practice',
      floorPackId ?? '',
      practice.map((p) => `${p.packId}/${p.examId}`).join(','),
    ],
    enabled: floorPackId !== null && practice.length > 0,
    queryFn: async () => {
      const [exams, attempts] = await Promise.all([
        repos.exams.listExams({ mode: 'drill' }),
        repos.course.listAttempts({ limit: 500 }),
      ]);
      const floorStart = firstUnitStart(attempts, floorPackId ?? '');
      const rows = [];
      for (const ref of practice) {
        const exam = exams.find((e) => e.packId === ref.packId && e.examId === ref.examId);
        if (!exam) continue;
        const drill = await repos.exams.listAttempts({
          scope: 'drill',
          packId: ref.packId,
          examId: ref.examId,
          limit: 500,
        });
        const { before, after } = drillBeforeAfter(
          drill.map((a) => ({
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            results: a.results,
          })),
          floorStart,
        );
        rows.push({ packId: ref.packId, examId: ref.examId, title: exam.titleRu, before, after });
      }
      return rows;
    },
  });
}

/**
 * The last finished Номер 13 attempt (T92d): its subtest results, the engine's
 * overall SPbU % (Σ points / Σ max, the same total the results screen shows),
 * and the debrief (the floors to revisit, per subtest under 66 %). Shared by the
 * room and the lift's debrief markers, so both read one source.
 */
export function useLastGateDetail() {
  const attempts = useQuery({
    queryKey: ['hotel', 'gate-attempts'],
    queryFn: () => repos.exams.listAttempts({ packId: GATE_PACK_ID, limit: 20 }),
  });
  const last = (attempts.data ?? []).find((a) => a.status === 'finished') ?? null;
  const detail = useQuery({
    queryKey: ['hotel', 'gate-detail', last?.id ?? ''],
    enabled: last !== null,
    queryFn: async () => {
      if (!last) return null;
      const exam = await repos.exams.getExam(GATE_PACK_ID, last.examId);
      const full = await repos.exams.getAttempt(last.id);
      if (!exam || !full) return null;
      const results: SubtestResult[] = exam.subtests.flatMap((s) => {
        const r = (last.results ?? {})[s.id];
        return r ? [{ kind: s.kind, percent: r.pct }] : [];
      });
      const responses: GradedResponse[] = [];
      for (const resp of full.responses) {
        if (resp.points === null) continue;
        const located = findExamItem(exam, resp.itemId, resp.subtestId);
        if (!located) continue;
        responses.push({
          itemId: resp.itemId,
          subtestKind: located.subtest.kind,
          topic: located.item.topic,
          points: resp.points,
          maxPoints: resp.maxPoints,
        });
      }
      return {
        results,
        overall: overallPct(last.results ?? null),
        responses,
        debrief: debriefForSubtests(results, missedByKind(responses)),
      };
    },
  });
  return { last, attempts, detail };
}
