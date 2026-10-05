import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as React from 'react';

import { classifyPack, type Classified } from '@/features/library/categories';
import type { ExamMode, ExamScope } from '@/features/torfl/model';
import type { ExamSubtestKind } from '@sumrak/schema';
import { queryClient } from '@/lib/query-client';
import { profileKeyFor } from '@/features/word-forms/profile-core';

import { repos } from './index';
import type { BankFilter, BankItemRow, BankSort, EncounterRow } from './repositories/bank';
import type { BookmarkRow } from './repositories/bookmarks';
import type { ResolvedSentence } from './repositories/content';
import type { ProfileKind } from './schema';
import { MIXED_SESSION_DIRECTIONS, UNIFIED_SESSION_DIRECTIONS } from './repositories/reviews';

/**
 * Thin React Query read-hooks over the repositories — the query surface
 * T04 (library/reader), T05 (word bank), and T06 (reviews) build on. No
 * business logic here; keys are centralized so writes can invalidate.
 */
export const queryKeys = {
  packs: ['packs'] as const,
  stories: ['stories'] as const,
  storyDetail: (packId: string, storyId: string) => ['story', packId, storyId] as const,
  bankItems: (filter?: BankFilter, sort?: BankSort) =>
    ['bank-items', filter ?? {}, sort ?? null] as const,
  bankItem: (id: string) => ['bank-item', id] as const,
  bankItemDetail: (id: string) => ['bank-item', id, 'detail'] as const,
  bankCount: ['bank-count'] as const,
  bankWordStatus: (lemmaNorm: string) => ['bank-word-status', lemmaNorm] as const,
  bankFilterOptions: ['bank-items', 'filter-options'] as const,
  dueCount: ['due-count'] as const,
  dueCountMixed: ['due-count', 'mixed'] as const,
  dueCountProduction: ['due-count', 'production'] as const,
  itemReviewState: (bankItemId: string) => ['review-state', bankItemId] as const,
  dailyActivity: ['daily-activity'] as const,
  tokenSearch: (q: string) => ['token-search', q] as const,
  storyProgressList: ['story-progress'] as const,
  storyProgress: (packId: string, storyId: string) => ['story-progress', packId, storyId] as const,
  journalEntries: ['journal-entries'] as const,
  journalEntry: (id: string) => ['journal-entry', id] as const,
  notes: ['notes'] as const,
  note: (id: string) => ['note', id] as const,
  journalSearch: (q: string) => ['journal-search', q] as const,
  globalSearch: (q: string) => ['global-search', q] as const,
  bankMasteryCounts: ['bank-items', 'mastery-counts'] as const,
  bookmarks: ['bookmarks'] as const,
  bookmarksForStory: (packId: string, storyId: string) =>
    ['bookmarks', 'story', packId, storyId] as const,
  bookmarkedStoryKeys: ['bookmarks', 'story-keys'] as const,
  dialogues: ['dialogues'] as const,
  dialogueGraph: (packId: string, dialogueId: string) =>
    ['dialogue-graph', packId, dialogueId] as const,
  dialogueRuns: (dialogueId?: string) => ['dialogue-runs', dialogueId ?? 'all'] as const,
  dialogueStamps: (packId: string, sentenceId: string) =>
    ['dialogue-stamps', packId, sentenceId] as const,
  // M17 scenarios (T58, SPEAKING_SCENARIOS §4.3). `['scenarios']` is the
  // invalidation root for content; runs/debriefs key off their ids.
  scenarios: ['scenarios'] as const,
  scenario: (packId: string, scenarioId: string) => ['scenarios', packId, scenarioId] as const,
  scenarioRuns: (scenarioId?: string) => ['scenario-runs', scenarioId ?? 'all'] as const,
  scenarioRunDebrief: (runId: string) => ['scenario-runs', 'debrief', runId] as const,
  scenarioStamps: (packId: string, sentenceId: string) =>
    ['scenario-stamps', packId, sentenceId] as const,
  // M18 «ТРКИ» (T68, TORFL §4.3). `['exams']` is the invalidation root for
  // content AND user rows (attempts/responses/deck) — `invalidateExams()`.
  exams: {
    all: ['exams'] as const,
    list: (packId?: string, mode?: ExamMode) =>
      ['exams', 'list', packId ?? 'all', mode ?? 'all'] as const,
    one: (packId: string, examId: string) => ['exams', 'one', packId, examId] as const,
    activeAttempt: ['exams', 'attempts', 'active'] as const,
    attempts: (scope?: ExamScope, limit?: number) =>
      ['exams', 'attempts', 'list', scope ?? 'all', limit ?? 50] as const,
    attempt: (attemptId: string) => ['exams', 'attempts', 'one', attemptId] as const,
    topicStats: (sinceMs?: number, subtestKind?: string) =>
      ['exams', 'topic-stats', sinceMs ?? 0, subtestKind ?? 'all'] as const,
    deckCounts: ['exams', 'deck-counts'] as const,
  },
  // M16 word profiles (T53, WORD_FORMS §5.4 key): keyed by the profile key,
  // not the bank item id — profiles outlive items and are shared by lemma.
  wordProfile: (lemmaNorm: string, kind: ProfileKind) => ['word-profile', lemmaNorm, kind] as const,
  wordProfileVersions: (lemmaNorm: string, kind: ProfileKind) =>
    ['word-profile', lemmaNorm, kind, 'versions'] as const,
  lessonCounts: (lemmaNorm: string, kind: ProfileKind) =>
    ['lesson-counts', lemmaNorm, kind] as const,
  // M16 grammar lessons (T54, WORD_FORMS §7.3): keyed by the profile key like
  // profiles — lessons outlive bank rows. `['lessons']` is the invalidation root.
  lessonsForSection: (lemmaNorm: string, kind: ProfileKind, sectionId: string) =>
    ['lessons', 'key', lemmaNorm, kind, sectionId] as const,
  lessonsForKey: (lemmaNorm: string, kind: ProfileKind) =>
    ['lessons', 'key', lemmaNorm, kind] as const,
  lessonsGlobal: (search: string) => ['lessons', 'global', search] as const,
  lesson: (id: string) => ['lessons', 'one', id] as const,
};

export function usePacks() {
  return useQuery({ queryKey: queryKeys.packs, queryFn: () => repos.content.listPacks() });
}

/**
 * `packId → Classified` for every installed pack (M14, LIBRARY_CATEGORIES
 * §5): derived from usePacks() through the one classification function —
 * no SQL change. Empty Map while packs load. Consumers: the Library chip
 * filter (T45), CategoryBadge in the reader/search/bookmarks (T46).
 */
export function usePackClassification(): Map<string, Classified> {
  const packs = usePacks().data;
  return React.useMemo(
    () => new Map((packs ?? []).map((p) => [p.id, classifyPack(p)] as const)),
    [packs],
  );
}

export function useStories() {
  return useQuery({ queryKey: queryKeys.stories, queryFn: () => repos.content.listStories() });
}

export function useStoryDetail(packId: string, storyId: string) {
  return useQuery({
    queryKey: queryKeys.storyDetail(packId, storyId),
    queryFn: () => repos.content.getStoryDetail(packId, storyId),
    enabled: !!packId && !!storyId,
  });
}

export function useBankItems(filter?: BankFilter, sort?: BankSort) {
  return useQuery({
    queryKey: queryKeys.bankItems(filter, sort),
    queryFn: () => repos.bank.listItems(filter, sort),
  });
}

export function useBankItem(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.bankItem(id ?? ''),
    queryFn: () => repos.bank.getItemWithEncounters(id!),
    enabled: !!id,
  });
}

export function useBankCount() {
  return useQuery({ queryKey: queryKeys.bankCount, queryFn: () => repos.bank.countItems() });
}

export function useBankFilterOptions() {
  return useQuery({
    queryKey: queryKeys.bankFilterOptions,
    queryFn: () => repos.bank.getFilterOptions(),
  });
}

export interface EncounterWithContext extends EncounterRow {
  /** Resolved source sentence + story; null for manual/journal encounters. */
  context: ResolvedSentence | null;
}

/**
 * Card-detail payload (design §7.2): the bank item plus every encounter with
 * its sentence context resolved from content tables. Content may have been
 * uninstalled since the encounter — context is null then, never an error.
 */
export function useBankItemDetail(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.bankItemDetail(id ?? ''),
    queryFn: async () => {
      const item = await repos.bank.getItemWithEncounters(id!);
      if (!item) return null;
      const sentenceIds = [
        ...new Set(item.encounters.map((e) => e.sentenceId).filter((s): s is string => !!s)),
      ];
      const resolved = new Map<string, ResolvedSentence | null>();
      await Promise.all(
        sentenceIds.map(async (sid) => {
          resolved.set(sid, await repos.content.resolveSentence(sid));
        }),
      );
      const encounters: EncounterWithContext[] = item.encounters.map((e) => ({
        ...e,
        context: e.sentenceId ? (resolved.get(e.sentenceId) ?? null) : null,
      }));
      return { ...item, encounters };
    },
    enabled: !!id,
  });
}

/**
 * Live due-card count for the daily session — the Today tab's headline
 * number. Filtered to UNIFIED_SESSION_DIRECTIONS so the count always
 * matches what Today's "Start session" (the T14 daily session) serves;
 * production stays split off behind the Speaking card (T12).
 */
export function useDueCardCount() {
  return useQuery({
    queryKey: queryKeys.dueCount,
    queryFn: () => repos.reviews.countDueCards({ directions: UNIFIED_SESSION_DIRECTIONS }),
  });
}

/** Due ru-en/en-ru cards only — what the standalone flashcard/MC session serves. */
export function useMixedDueCount() {
  return useQuery({
    queryKey: queryKeys.dueCountMixed,
    queryFn: () => repos.reviews.countDueCards({ directions: MIXED_SESSION_DIRECTIONS }),
  });
}

/** Due production cards — the Today pronunciation card's number (T12). */
export function useProductionDueCount() {
  return useQuery({
    queryKey: queryKeys.dueCountProduction,
    queryFn: () => repos.reviews.countDueCards({ directions: ['production'] }),
  });
}

/** Today's raw activity counters (reviews done, reading ms) — goal logic is T19. */
export function useDailyActivity() {
  return useQuery({
    queryKey: queryKeys.dailyActivity,
    queryFn: () => repos.stats.getDailyActivity(),
  });
}

/**
 * Per-direction FSRS cards + full review history for one bank item — the
 * card-detail "Reviews" section (replaces the T05 placeholder).
 */
export function useItemReviewState(bankItemId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.itemReviewState(bankItemId ?? ''),
    queryFn: async () => {
      const [cards, log] = await Promise.all([
        repos.reviews.listCardsForItem(bankItemId!),
        repos.reviews.listReviewLogForItem(bankItemId!),
      ]);
      return { cards, log };
    },
    enabled: !!bankItemId,
  });
}

export function useStoryProgressList() {
  return useQuery({
    queryKey: queryKeys.storyProgressList,
    queryFn: () => repos.reading.listProgress(),
  });
}

export function useStoryProgress(packId: string, storyId: string) {
  return useQuery({
    queryKey: queryKeys.storyProgress(packId, storyId),
    queryFn: () => repos.reading.getProgress(packId, storyId),
    enabled: !!packId && !!storyId,
  });
}

export function useTokenSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.tokenSearch(query),
    queryFn: () => repos.content.searchTokens(query),
    enabled: query.trim().length > 0,
  });
}

// --- Global search & bookmarks (T24) ---------------------------------------

/**
 * Global content search (V2 §7.1): token FTS grouped by sentence, plus the
 * existing journal/notes FTS — one query, three sections. Caller debounces
 * (useDeferredValue); repos cap result counts so long-tail queries stay flat.
 */
export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.globalSearch(query),
    queryFn: async () => {
      const [sentences, entries, notes] = await Promise.all([
        repos.content.searchSentences(query),
        repos.journal.searchEntries(query, 20),
        repos.journal.searchNotes(query, 20),
      ]);
      return { sentences, entries, notes };
    },
    enabled: query.trim().length > 0,
  });
}

/** Per-band bank counts for the mastery chips (shares lib/mastery with the dashboard). */
export function useBankMasteryCounts() {
  return useQuery({
    queryKey: queryKeys.bankMasteryCounts,
    queryFn: () => repos.bank.getMasteryCounts(),
  });
}

/** The reader's toggle states: this story's story-level + sentence bookmarks. */
export function useBookmarksForStory(packId: string, storyId: string) {
  return useQuery({
    queryKey: queryKeys.bookmarksForStory(packId, storyId),
    queryFn: () => repos.bookmarks.listForStory(packId, storyId),
    enabled: !!packId && !!storyId,
  });
}

export interface ResolvedBookmark extends BookmarkRow {
  /** null = the pack was removed since bookmarking (degrade, never crash). */
  storyTitleRu: string | null;
  packTitleRu: string | null;
  /** Resolved sentence text + scroll target; sentence bookmarks only. */
  sentenceRu: string | null;
  sentenceOrderIdx: number | null;
}

/**
 * The «Закладки» list payload: every bookmark with its content context
 * resolved — or nulls when the pack has been uninstalled (T05's null-safe
 * encounters pattern; the row renders a clear "content removed" state).
 */
export function useResolvedBookmarks() {
  return useQuery({
    queryKey: queryKeys.bookmarks,
    queryFn: async (): Promise<ResolvedBookmark[]> => {
      const [rows, stories, packs] = await Promise.all([
        repos.bookmarks.list(),
        repos.content.listStories(),
        repos.content.listPacks(),
      ]);
      const storyByKey = new Map(stories.map((s) => [`${s.packId}/${s.id}`, s]));
      const packById = new Map(packs.map((p) => [p.id, p]));
      return Promise.all(
        rows.map(async (row) => {
          const story = storyByKey.get(`${row.packId}/${row.storyId}`) ?? null;
          const resolved =
            row.kind === 'sentence' && row.sentenceId
              ? await repos.content.resolveSentence(row.sentenceId)
              : null;
          return {
            ...row,
            storyTitleRu: story?.titleRu ?? null,
            packTitleRu: packById.get(row.packId)?.titleRu ?? null,
            sentenceRu: resolved?.sentence.ru ?? null,
            sentenceOrderIdx: resolved?.sentence.orderIdx ?? null,
          };
        }),
      );
    },
  });
}

/** `packId/storyId` keys with a story bookmark — the Library row indicator. */
export function useBookmarkedStoryKeys() {
  return useQuery({
    queryKey: queryKeys.bookmarkedStoryKeys,
    queryFn: () => repos.bookmarks.storyKeySet(),
  });
}

// --- Journal & notes (T15) -------------------------------------------------

export function useJournalEntries() {
  return useQuery({
    queryKey: queryKeys.journalEntries,
    queryFn: () => repos.journal.listEntries(),
  });
}

export function useJournalEntry(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.journalEntry(id ?? ''),
    queryFn: () => repos.journal.getEntry(id!),
    enabled: !!id,
  });
}

export function useNotes() {
  return useQuery({ queryKey: queryKeys.notes, queryFn: () => repos.journal.listNotes() });
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.note(id ?? ''),
    queryFn: () => repos.journal.getNote(id!),
    enabled: !!id,
  });
}

/** FTS over journal entries + notes in one shot — the Журнал tab search (design §5). */
export function useJournalSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.journalSearch(query),
    queryFn: async () => {
      const [entries, notes] = await Promise.all([
        repos.journal.searchEntries(query),
        repos.journal.searchNotes(query),
      ]);
      return { entries, notes };
    },
    enabled: query.trim().length > 0,
  });
}

/** Installed dialogues with endings-collected counts (T26; T27's entry points). */
export function useDialogues() {
  return useQuery({
    queryKey: queryKeys.dialogues,
    queryFn: () => repos.dialogues.listDialogues(),
  });
}

/** The full node graph T27's player walks (sentences, audio, choices, endings). */
export function useDialogueGraph(packId: string | undefined, dialogueId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dialogueGraph(packId ?? '', dialogueId ?? ''),
    queryFn: () => repos.dialogues.getDialogueGraph(packId!, dialogueId!),
    enabled: !!packId && !!dialogueId,
  });
}

/** Past runs of one dialogue (or all), newest first (T26). */
export function useDialogueRuns(dialogueId?: string) {
  return useQuery({
    queryKey: queryKeys.dialogueRuns(dialogueId),
    queryFn: () => repos.dialogues.listRuns(dialogueId),
  });
}

/** Karaoke word stamps for one dialogue line (T27 per-line index). */
export function useDialogueStamps(packId: string | undefined, sentenceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dialogueStamps(packId ?? '', sentenceId ?? ''),
    queryFn: () => repos.dialogues.getStampsForSentence(packId!, sentenceId!),
    enabled: !!packId && !!sentenceId,
  });
}

// --- M17 scenarios (T58) ----------------------------------------------------

/** Installed scenarios grouped by family with run summaries (the hub's input, T62). */
export function useScenarios() {
  return useQuery({
    queryKey: queryKeys.scenarios,
    queryFn: () => repos.scenarios.listScenarios(),
  });
}

/** The full runtime object the engine walks (cast, scene, turns, glossary, lines + audio + mouth). */
export function useScenario(packId: string | undefined, scenarioId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scenario(packId ?? '', scenarioId ?? ''),
    queryFn: () => repos.scenarios.getScenario(packId!, scenarioId!),
    enabled: !!packId && !!scenarioId,
  });
}

/** Runs of one scenario (or all), newest first (T63 runs list). */
export function useScenarioRuns(scenarioId?: string, opts?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: [
      ...queryKeys.scenarioRuns(scenarioId),
      opts?.limit ?? 50,
      opts?.offset ?? 0,
    ] as const,
    queryFn: () => repos.scenarios.listRuns(scenarioId, opts),
  });
}

/** One run's turns × attempts with details parsed (the debrief, T63). */
export function useRunDebrief(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scenarioRunDebrief(runId ?? ''),
    queryFn: () => repos.scenarios.getRunDebrief(runId!),
    enabled: !!runId,
  });
}

/** Stamps for one scenario line (mouth sync / karaoke in the debrief). */
export function useScenarioStamps(packId: string | undefined, sentenceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scenarioStamps(packId ?? '', sentenceId ?? ''),
    queryFn: () => repos.scenarios.getStampsForSentence(packId!, sentenceId!),
    enabled: !!packId && !!sentenceId,
  });
}

// --- M18 «ТРКИ» exams (T68) -------------------------------------------------

/** Installed exams (optional pack / mode filter), JSON parsed — the hub's lists (T69). */
export function useExams(filter: { packId?: string; mode?: ExamMode } = {}) {
  return useQuery({
    queryKey: queryKeys.exams.list(filter.packId, filter.mode),
    queryFn: () => repos.exams.listExams(filter),
  });
}

/** One exam, Zod-parsed (null = missing / unreadable). */
export function useExam(packId: string | undefined, examId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.exams.one(packId ?? '', examId ?? ''),
    queryFn: () => repos.exams.getExam(packId!, examId!),
    enabled: !!packId && !!examId,
  });
}

/** The one active attempt (hub resume banner, T71). */
export function useActiveExamAttempt() {
  return useQuery({
    queryKey: queryKeys.exams.activeAttempt,
    queryFn: () => repos.exams.getActiveAttempt(),
  });
}

/** Attempt history, newest first. */
export function useExamAttempts(opts: { scope?: ExamScope; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.exams.attempts(opts.scope, opts.limit),
    queryFn: () => repos.exams.listAttempts(opts),
  });
}

/** One attempt + its responses (results / review screens). */
export function useExamAttempt(attemptId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.exams.attempt(attemptId ?? ''),
    queryFn: () => repos.exams.getAttempt(attemptId!),
    enabled: !!attemptId,
  });
}

/** Per-topic accuracy over objective responses (readiness / hub breakdown). */
export function useExamTopicStats(opts: { sinceMs?: number; subtestKind?: ExamSubtestKind } = {}) {
  return useQuery({
    queryKey: queryKeys.exams.topicStats(opts.sinceMs, opts.subtestKind),
    queryFn: () => repos.exams.topicStats(opts),
  });
}

/** Exam deck totals («Работа над ошибками · N»). */
export function useExamDeckCounts() {
  return useQuery({
    queryKey: queryKeys.exams.deckCounts,
    queryFn: () => repos.exams.deckCounts(),
  });
}

/** Invalidate every exam query (content + attempts + deck) after any exam write or import. */
export function invalidateExams(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.exams.all });
}

// --- M16 word profiles (T53) ------------------------------------------------

type ProfileKeyItem = Pick<BankItemRow, 'kind' | 'lemmaNorm' | 'normalized'>;

/**
 * The current profile of a bank item (null = none yet, or the payload is
 * unreadable). Disabled for lemma-less words — they have no key (§5.4), the
 * Forms tab shows «Add a lemma first» instead of querying.
 */
export function useCurrentProfile(item: ProfileKeyItem | null | undefined) {
  const key = item ? profileKeyFor(item) : null;
  return useQuery({
    queryKey: queryKeys.wordProfile(key?.lemmaNorm ?? '', key?.kind ?? 'word'),
    queryFn: () => repos.wordForms.getCurrentProfile(key!.lemmaNorm, key!.kind),
    enabled: key !== null,
  });
}

/** Every stored version for the item's key, newest first (the Versions sheet). */
export function useProfileVersions(item: ProfileKeyItem | null | undefined) {
  const key = item ? profileKeyFor(item) : null;
  return useQuery({
    queryKey: queryKeys.wordProfileVersions(key?.lemmaNorm ?? '', key?.kind ?? 'word'),
    queryFn: () => repos.wordForms.listProfileVersions(key!.lemmaNorm, key!.kind),
    enabled: key !== null,
  });
}

/** Lesson counts per section for the item's key (0 until T54 writes lessons). */
export function useLessonCounts(item: ProfileKeyItem | null | undefined) {
  const key = item ? profileKeyFor(item) : null;
  return useQuery({
    queryKey: queryKeys.lessonCounts(key?.lemmaNorm ?? '', key?.kind ?? 'word'),
    queryFn: () => repos.wordForms.countLessonsForKey(key!.lemmaNorm, key!.kind),
    enabled: key !== null,
  });
}

/**
 * How many bank items have no current profile — the batch entry row's N
 * (T55, WORD_FORMS §7.5). Keyed under `['profile-coverage']`, which every
 * profile write invalidates (`useInvalidateWordProfile`, the batch service).
 */
export function useItemsWithoutProfileCount() {
  return useQuery({
    queryKey: ['profile-coverage', 'count'] as const,
    queryFn: () => repos.wordForms.countItemsWithoutProfile(),
  });
}

/** Words the batch must skip (no lemma ⇒ no key) — the sheet's «{k} skipped — no lemma yet». */
export function useItemsWithoutLemmaCount() {
  return useQuery({
    queryKey: ['profile-coverage', 'no-lemma'] as const,
    queryFn: () => repos.wordForms.countItemsWithoutLemma(),
  });
}

/**
 * Invalidate everything the Forms tab reads for one key: the current
 * profile, its versions list, and the lesson counts —
 * after generate and promote, so the badge and the tables never disagree
 * (ticket technical note). Also the batch entry's «N words without forms»
 * count (T55) which changes whenever a profile appears.
 */
export function useInvalidateWordProfile() {
  const queryClient = useQueryClient();
  return React.useCallback(
    (key: { lemmaNorm: string; kind: ProfileKind }) => {
      void queryClient.invalidateQueries({
        queryKey: ['word-profile', key.lemmaNorm, key.kind],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.lessonCounts(key.lemmaNorm, key.kind),
      });
      void queryClient.invalidateQueries({ queryKey: ['profile-coverage'] });
    },
    [queryClient],
  );
}

// --- M16 grammar lessons (T54) ------------------------------------------------

/** Lessons about one word × one section, newest first (the «Lessons · N» sheet). */
export function useLessonsForSection(item: ProfileKeyItem | null | undefined, sectionId: string) {
  const key = item ? profileKeyFor(item) : null;
  return useQuery({
    queryKey: queryKeys.lessonsForSection(key?.lemmaNorm ?? '', key?.kind ?? 'word', sectionId),
    queryFn: () => repos.wordForms.listLessonsForSection(key!.lemmaNorm, key!.kind, sectionId),
    enabled: key !== null,
  });
}

/** Every lesson for the item's key, newest first (the item's Lessons tab groups by section). */
export function useLessonsForKey(item: ProfileKeyItem | null | undefined) {
  const key = item ? profileKeyFor(item) : null;
  return useQuery({
    queryKey: queryKeys.lessonsForKey(key?.lemmaNorm ?? '', key?.kind ?? 'word'),
    queryFn: () => repos.wordForms.listLessonsForKey(key!.lemmaNorm, key!.kind),
    enabled: key !== null,
  });
}

/** §7.3 pagination step of the global Lessons screen. */
export const LESSONS_PAGE_SIZE = 50;

/**
 * The global list (ё/е-tolerant `search`), newest first, paged by
 * `limit/offset` 50 through an infinite query — `fetchNextPage` is «Load
 * more»; a short page ends the list.
 */
export function useLessons(search: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.lessonsGlobal(search),
    queryFn: ({ pageParam }) =>
      repos.wordForms.listLessons({
        search,
        limit: LESSONS_PAGE_SIZE,
        offset: pageParam * LESSONS_PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < LESSONS_PAGE_SIZE ? undefined : pages.length,
    placeholderData: keepPreviousData,
  });
}

export function useLesson(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.lesson(id ?? ''),
    queryFn: () => repos.wordForms.getLesson(id!),
    enabled: !!id,
  });
}

/**
 * After a lesson is generated: every lessons list (section sheet, item tab,
 * global screen) and the T53 tab count for the key.
 */
export function useInvalidateLessons() {
  const queryClient = useQueryClient();
  return React.useCallback(
    (key: { lemmaNorm: string; kind: ProfileKind }) => {
      void queryClient.invalidateQueries({ queryKey: ['lessons'] });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.lessonCounts(key.lemmaNorm, key.kind),
      });
    },
    [queryClient],
  );
}
