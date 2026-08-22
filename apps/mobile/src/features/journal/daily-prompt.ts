import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { repos } from '@/db';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';

import {
  DEFAULT_LEVEL,
  localDayKey,
  PathPositionSchema,
  PromptRowSchema,
  selectDailyPrompt,
  type Cefr,
  type PromptRow,
} from './prompt-rotation';

export type { Cefr, PromptRow };

/**
 * Daily journal prompt surfacing (T15, design §7.4): level-appropriate,
 * rotating by day, skippable. Selection logic lives in `prompt-rotation.ts`
 * (pure + unit-tested); this file layers React Query and settings on top.
 */

async function loadPrompts(): Promise<PromptRow[]> {
  const rows = await repos.content.listJournalPrompts();
  return rows.flatMap((row) => {
    const parsed = PromptRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

async function loadUserLevel(): Promise<Cefr> {
  const stored = await repos.settings.get<unknown>(SETTING_KEYS.pathPosition);
  const parsed = PathPositionSchema.safeParse(stored);
  return parsed.success ? (parsed.data.level as Cefr) : DEFAULT_LEVEL;
}

/** The rotating, skippable prompt of the day. `skip` is ephemeral by design. */
export function useDailyPrompt() {
  const [skip, setSkip] = React.useState(0);

  const query = useQuery({
    queryKey: ['journal-prompts', 'daily'],
    queryFn: async () => ({ prompts: await loadPrompts(), level: await loadUserLevel() }),
  });

  const prompt = React.useMemo(() => {
    if (!query.data) return null;
    return selectDailyPrompt(query.data.prompts, query.data.level, localDayKey(), skip);
  }, [query.data, skip]);

  const skipPrompt = React.useCallback(() => {
    track('journal_prompt_skipped', { promptId: prompt?.id ?? '' });
    setSkip((n) => n + 1);
  }, [prompt]);

  return {
    prompt,
    skipPrompt,
    loading: query.isLoading,
    total: query.data?.prompts.length ?? 0,
  };
}

/** Resolve one prompt by id for entries that saved a promptId. */
export function usePromptById(promptId: string | null | undefined) {
  return useQuery({
    queryKey: ['journal-prompts', 'by-id', promptId ?? ''],
    queryFn: async () => {
      const prompts = await loadPrompts();
      return prompts.find((p) => p.id === promptId) ?? null;
    },
    enabled: !!promptId,
  });
}
