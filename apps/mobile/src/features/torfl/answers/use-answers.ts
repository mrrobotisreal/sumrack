import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { repos } from '@/db';
import { queryKeys } from '@/db/hooks';

import {
  groupAnswers,
  promptsForLevel,
  type AnswerEntry,
  type AnswerPrompt,
  type AnswerTopicGroup,
} from './answers-model';
import type { TorflLevel } from '../level-profile';

/**
 * «Мои ответы» data (T74, TORFL §9): the installed `torfl` prompts joined to
 * Mitch's journal entries for them, grouped by topic. The query key hangs
 * under `journal-entries` so the editor's existing invalidation (a new or
 * edited entry, feedback landing) refreshes the bank too.
 */
export const answersQueryKey = [...queryKeys.journalEntries, 'torfl-answers'] as const;

/** One level's bank (T75): the key carries the level; the prefix above still invalidates all. */
export function answersQueryKeyFor(level: TorflLevel) {
  return [...answersQueryKey, level] as const;
}

export interface AnswersData {
  groups: AnswerTopicGroup[];
  promptCount: number;
  entryCount: number;
}

async function loadAnswers(level: TorflLevel): Promise<AnswersData> {
  const rows = await repos.content.listJournalPromptsWithPackLevel();
  const prompts: AnswerPrompt[] = promptsForLevel(
    rows.map((r) => ({
      packId: r.prompt.packId,
      id: r.prompt.id,
      promptRu: r.prompt.promptRu,
      promptEn: r.prompt.promptEn,
      tags: r.prompt.tags ?? null,
      packLevel: r.packLevel,
    })),
    level,
  );
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

export function useAnswers(level: TorflLevel = 'A1') {
  return useQuery({ queryKey: answersQueryKeyFor(level), queryFn: () => loadAnswers(level) });
}

/** Refetch on every focus (an entry written in the journal editor comes back here). */
export function useRefreshAnswersOnFocus(): () => void {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: answersQueryKey });
  }, [queryClient]);
}
