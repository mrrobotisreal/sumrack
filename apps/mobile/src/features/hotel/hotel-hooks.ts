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
