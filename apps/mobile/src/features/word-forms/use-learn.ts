import { useRouter } from 'expo-router';
import * as React from 'react';

import { useInvalidateLessons } from '@/db/hooks';
import type { BankItemRow } from '@/db/repositories/bank';
import type { WordProfileRecord } from '@/db/repositories/word-forms';
import { friendlyAiMessage } from '@/features/ai/errors';
import type { AiRunProfile } from '@/features/ai/run-profile';
import { track } from '@/services/analytics';

import { generateLesson } from './lesson-service';
import { profileKeyFor } from './profile-core';
import type { ProfileSection } from './profile-schema';

export type LearnState =
  | { phase: 'idle' }
  | { phase: 'loading'; run: AiRunProfile }
  | { phase: 'error'; message: string; run: AiRunProfile };

/**
 * The Learn / Learn again flow shared by the section footer and the lesson
 * screen (WORD_FORMS §7.3): `generateLesson` → invalidate every lessons
 * list + the tab count → push `/lessons/[id]` (`lesson_opened {from}`).
 * Failure keeps the run so Retry re-sends it — never an automatic retry.
 */
export function useLearn(from: 'section' | 'lesson') {
  const router = useRouter();
  const invalidate = useInvalidateLessons();
  const [state, setState] = React.useState<LearnState>({ phase: 'idle' });

  const learn = React.useCallback(
    (
      item: BankItemRow,
      profileRow: WordProfileRecord,
      section: ProfileSection,
      run: AiRunProfile,
    ) => {
      const key = profileKeyFor(item);
      if (!key) return;
      setState({ phase: 'loading', run });
      generateLesson(item, profileRow, section, run)
        .then((row) => {
          invalidate(key);
          setState({ phase: 'idle' });
          track('lesson_opened', { from });
          router.push({ pathname: '/lessons/[id]', params: { id: row.id } });
        })
        .catch((err) => {
          setState({ phase: 'error', message: friendlyAiMessage(err), run });
        });
    },
    [from, invalidate, router],
  );

  const dismiss = React.useCallback(() => setState({ phase: 'idle' }), []);

  return { state, learn, dismiss };
}
