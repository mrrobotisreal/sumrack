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
  HOTEL_LEVELS,
  hotelProfileFor,
  parseHotelBuilding,
  type HotelLevel,
} from '@/features/torfl/hotel-profile';

import {
  drillBeforeAfter,
  duplicateFloors,
  firstUnitStart,
  floorState,
  parseLastFloors,
  reveal13,
  type FloorInput,
  type LastFloors,
} from './hotel-model';
import {
  cooldownLeft,
  debriefForSubtests,
  gatePassedOf,
  missedByKind,
  nextHotelAction,
  type GradedResponse,
  type SubtestResult,
} from './gate-model';
import { findExamItem } from '@/features/torfl/model';
import { overallPct } from '@/features/torfl/hub-model';
import {
  lessonOpenedSet,
  lessonSentenceRefs,
  parseLessonPositions,
  type LessonPositions,
  type SentenceRefKey,
} from './lesson/lesson-model';
import { writeSettingThrough } from './settings-write';

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

/** A listed floor row as the pure model reads it. */
export function floorInputOf(f: CourseFloorRow): FloorInput {
  return {
    packId: f.packId,
    floor: f.floor,
    unitIds: f.course.units.map((u) => u.id),
    hasExam: f.course.floorExam !== undefined,
    version: f.version,
  };
}

/**
 * Every installed hotel floor of ONE building (T116), as the lock rule reads it
 * (course packs on the TORFL ladder at that level). A floor two packs claim is
 * logged once per read (bug 6c); `panelFor` picks one deterministically.
 */
export function useHotelFloors(level: HotelLevel) {
  return useQuery({
    queryKey: ['hotel', 'floors', level],
    queryFn: async () => {
      const floors = await repos.course.listFloors({ ladder: 'torfl', level });
      for (const d of duplicateFloors(floors.map(floorInputOf))) {
        console.warn(
          `[hotel] ${level} floor ${d.floor} is claimed by ${d.packIds.join(', ')} — showing ${d.picked}`,
        );
      }
      return floors;
    },
  });
}

/** The buildings with ≥ 1 installed floor (H2: lit + selectable on the ladder row). */
export function useInstalledBuildings() {
  return useQuery({
    queryKey: ['hotel', 'buildings'],
    queryFn: async () => {
      const out: HotelLevel[] = [];
      for (const level of HOTEL_LEVELS) {
        if ((await repos.course.listFloors({ ladder: 'torfl', level })).length > 0) out.push(level);
      }
      return out;
    },
  });
}

/** `hotel.building` (T116, H2): the building the hotel shows; default the first building. */
export function useHotelBuilding() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['hotel', 'building'],
    queryFn: async () =>
      parseHotelBuilding(await repos.settings.get<unknown>(SETTING_KEYS.hotelBuilding)),
  });
  // ISS-006: race-safe — a read already in flight cannot flip the building back.
  const save = React.useCallback(
    (level: HotelLevel) =>
      writeSettingThrough<HotelLevel>(
        qc,
        ['hotel', 'building'],
        () => level,
        (value) => repos.settings.set(SETTING_KEYS.hotelBuilding, value),
      ),
    [qc],
  );
  return { level: query.data ?? HOTEL_LEVELS[0], loaded: query.isSuccess, save };
}

/** Recent attempts of one building's Номер 13 mock (shared by the state, the room and the lift). */
function useGateAttempts(level: HotelLevel) {
  const { gatePackId } = hotelProfileFor(level);
  return useQuery({
    queryKey: ['hotel', 'gate-attempts', level],
    queryFn: () => repos.exams.listAttempts({ packId: gatePackId, limit: 20 }),
  });
}

/**
 * The hotel's live state (Today card, Путь tab, journal): the panel with the
 * lock rule applied, the gate, and the next action — of ONE building (T116):
 * `level`, else the persisted `hotel.building` (H7: Today follows it).
 * Re-evaluates every 30 s so cooldown countdowns tick from the rows (carried
 * T90 decision 4).
 */
export function useHotelState(levelArg?: HotelLevel) {
  const building = useHotelBuilding();
  const level = levelArg ?? building.level;
  const profile = hotelProfileFor(level);
  const floors = useHotelFloors(level);
  const progress = useCourseProgress();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const gateInstalled = useQuery({
    queryKey: ['hotel', 'gate-installed', level],
    queryFn: async () => (await repos.content.listPacks()).some((p) => p.id === profile.gatePackId),
  });
  const gateAttempts = useGateAttempts(level);
  const installed = (floors.data ?? []).map(floorInputOf);
  const rows = progress.data ?? [];
  const states = floorState(installed, rows, now, level);
  // Bug 6b: the gate's latest finished verdict in exam_attempts, not a course_progress row.
  const gatePassed = gatePassedOf(gateAttempts.data ?? [], profile);
  const reveal13Now = reveal13(installed, rows, {
    mockInstalled: gateInstalled.data === true,
    level,
  });
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
        hasExam: s.hasExam,
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
    { gatePassed, reveal13: reveal13Now, level },
  );

  return {
    level,
    states,
    action,
    gatePassed,
    reveal13: reveal13Now,
    lastFloor,
    now,
    loaded: building.loaded && floors.isSuccess && progress.isSuccess,
  };
}

/**
 * `hotel.lastFloor` (T92 decision 4), per building since T116: the floor the
 * lift was on in `level`, or null. The legacy single number is A1's (healed on
 * read, no migration); a save writes the per-building object.
 */
export function useLastFloor(level: HotelLevel) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['hotel', 'lastFloor'],
    queryFn: async () =>
      parseLastFloors(await repos.settings.get<unknown>(SETTING_KEYS.hotelLastFloor)),
  });
  // ISS-006: race-safe (a stale re-read cannot undo the floor); a failed write only loses the resume floor.
  const save = React.useCallback(
    (floor: number, at: HotelLevel = level) =>
      writeSettingThrough<LastFloors>(
        qc,
        ['hotel', 'lastFloor'],
        (current) => ({ ...(current ?? {}), [at]: floor }),
        (value) => repos.settings.set(SETTING_KEYS.hotelLastFloor, value),
      ),
    [qc, level],
  );
  const floors = query.data ?? {};
  return { lastFloor: floors[level] ?? null, floors, loaded: query.isSuccess, save };
}

/**
 * The lesson-opened set (carried T92 decision 2): a unit whose lesson has a
 * saved card position was opened at least once. Keys are `packId:unitId`
 * (`lessonKey`) — never a bare unit id (T116 bug 6a).
 */
export function useLessonOpened() {
  const positions = useLessonPositions();
  return React.useMemo(() => lessonOpenedSet(positions.positions), [positions.positions]);
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
export function useLastGateDetail(level: HotelLevel) {
  const { gatePackId } = hotelProfileFor(level);
  const attempts = useGateAttempts(level);
  const last = (attempts.data ?? []).find((a) => a.status === 'finished') ?? null;
  const detail = useQuery({
    queryKey: ['hotel', 'gate-detail', level, last?.id ?? ''],
    enabled: last !== null,
    queryFn: async () => {
      if (!last) return null;
      const exam = await repos.exams.getExam(gatePackId, last.examId);
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
        debrief: debriefForSubtests(results, missedByKind(responses), level),
      };
    },
  });
  return { last, attempts, detail };
}
