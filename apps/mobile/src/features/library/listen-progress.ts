import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import {
  isFinished,
  percentFor,
  sanitizeProgress,
  type ListenProgress,
} from '@/features/listen/progress';

export interface ListenPackProgress {
  percent: number;
  finished: boolean;
}

/**
 * packId → {percent 0–100, finished} from the T96 `listen.progress` row.
 * Packs never started have no entry. Never throws (malformed → empty).
 */
export function parseListenProgress(raw: unknown): Map<string, ListenPackProgress> {
  const progress: ListenProgress = sanitizeProgress(raw);
  const out = new Map<string, ListenPackProgress>();
  for (const packId of Object.keys(progress.byPack)) {
    const finished = isFinished(progress, packId);
    const percent = percentFor(progress, packId);
    if (finished || percent > 0) out.set(packId, { percent, finished });
  }
  return out;
}

/** Re-read on every Library focus: a listen session may have moved while away. */
export function useListenProgress(): Map<string, ListenPackProgress> {
  const q = useQuery({
    queryKey: ['listen', 'progress'],
    queryFn: async () =>
      parseListenProgress(await repos.settings.get<unknown>(SETTING_KEYS.listenProgress)),
  });
  const refetch = q.refetch;
  useFocusEffect(
    React.useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  return q.data ?? new Map();
}
