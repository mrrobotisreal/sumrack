import { useQuery } from '@tanstack/react-query';

import { repos } from './index';
import type { BankFilter, EncounterRow } from './repositories/bank';
import type { BookmarkRow } from './repositories/bookmarks';
import type { ResolvedSentence } from './repositories/content';
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
  bankItems: (filter?: BankFilter) => ['bank-items', filter ?? {}] as const,
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
};

export function usePacks() {
  return useQuery({ queryKey: queryKeys.packs, queryFn: () => repos.content.listPacks() });
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

export function useBankItems(filter?: BankFilter) {
  return useQuery({
    queryKey: queryKeys.bankItems(filter),
    queryFn: () => repos.bank.listItems(filter),
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
