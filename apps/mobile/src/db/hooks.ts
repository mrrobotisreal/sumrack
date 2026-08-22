import { useQuery } from '@tanstack/react-query';

import { repos } from './index';
import type { BankFilter, EncounterRow } from './repositories/bank';
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
