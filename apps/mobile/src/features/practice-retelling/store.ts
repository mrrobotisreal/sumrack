import type { CompletedLearningSession } from '@/db/repositories/learning-sessions';
import {
  PRACTICE_MODE,
  PracticeEventSchema,
  parsePracticeEvents,
  type PracticeEvent,
} from './model';
export interface PracticeSessions {
  recordCompleted(input: CompletedLearningSession): Promise<void>;
  list(mode: string, limit?: number): Promise<{ detail: unknown }[]>;
}
export function createPracticeStore(sessions: PracticeSessions) {
  return {
    async list() {
      return parsePracticeEvents(await sessions.list(PRACTICE_MODE, 10000));
    },
    async append(event: PracticeEvent) {
      const parsed = PracticeEventSchema.parse(event);
      await sessions.recordCompleted({
        id: parsed.id,
        mode: PRACTICE_MODE,
        startedAt: parsed.at,
        endedAt: parsed.at,
        itemCount: 0,
        correctCount: 0,
        detail: parsed,
      });
    },
  };
}
export type PracticeStore = ReturnType<typeof createPracticeStore>;
