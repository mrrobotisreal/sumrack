import { useQuery } from '@tanstack/react-query';

import { QUEST_QUERY_KEY, refreshQuest } from './quest-runtime';

/**
 * Today's quest for the ring + card (T34). The fetcher IS the evaluation
 * (idempotent: assigns once, persists progress, completes once), so a focus
 * refetch also catches state no write path announced (a dismissed leech, a
 * new local day).
 */
export function useDailyQuest() {
  return useQuery({ queryKey: QUEST_QUERY_KEY, queryFn: refreshQuest });
}
