import { useQuery } from '@tanstack/react-query';

import { repos } from './index';
import type { BankFilter } from './repositories/bank';

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
  bankCount: ['bank-count'] as const,
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
