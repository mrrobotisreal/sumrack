import type { ItemScore } from '../scoring';

/** What an answered drill item reports to its host (the session hook / the daily segment). */
export interface ExamScoreArgs {
  answer: { index: number | null } | { text: string };
  score: ItemScore;
  ms: number;
}
