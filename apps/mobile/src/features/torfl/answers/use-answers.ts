import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { repos } from '@/db';
import { queryKeys } from '@/db/hooks';

import {
  groupAnswers,
  isTorflPrompt,
  type AnswerEntry,
  type AnswerPrompt,
  type AnswerTopicGroup,
} from './answers-model';

/**
 * «Мои ответы» data (T74, TORFL §9): the installed `torfl` prompts joined to
 * Mitch's journal entries for them, grouped by topic. The query key hangs
 * under `journal-entries` so the editor's existing invalidation (a new or
 * edited entry, feedback landing) refreshes the bank too.
 */
export const answersQueryKey = [...queryKeys.journalEntries, 'torfl-answers'] as const;

export interface AnswersData {
  groups: AnswerTopicGroup[];
  promptCount: number;
  entryCount: number;
}

async function loadAnswers(): Promise<AnswersData> {
  const rows = await repos.content.listJournalPrompts();
  const prompts: AnswerPrompt[] = rows
    .map((r) => ({
      packId: r.packId,
      id: r.id,
      promptRu: r.promptRu,
      promptEn: r.promptEn,
      tags: r.tags ?? null,
    }))
    .filter(isTorflPrompt);
  const entries: AnswerEntry[] = await repos.journal.listEntriesForPrompts(
    prompts.map((p) => p.id),
  );
  const groups = groupAnswers(prompts, entries);
  return {
    groups,
    promptCount: prompts.length,
    entryCount: groups.reduce((n, g) => n + g.entryCount, 0),
  };
}

export function useAnswers() {
  return useQuery({ queryKey: answersQueryKey, queryFn: loadAnswers });
}

/** Refetch on every focus (an entry written in the journal editor comes back here). */
export function useRefreshAnswersOnFocus(): () => void {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: answersQueryKey });
  }, [queryClient]);
}
