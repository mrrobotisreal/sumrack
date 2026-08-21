import { useQuery } from '@tanstack/react-query';

import { repos } from './index';
import type { BankFilter, EncounterRow } from './repositories/bank';
import type { ResolvedSentence } from './repositories/content';

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
 * Due-card count stub for the Today screen. Real due logic (FSRS
 * scheduling, per-direction queues) is T06 — the query shape is what
 * matters here.
 */
export function useDueCardCount() {
  return useQuery({
    queryKey: queryKeys.dueCount,
    queryFn: () => repos.reviews.countDueCards(),
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
