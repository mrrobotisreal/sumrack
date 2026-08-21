import type { SumrakDB } from '../types';
import { createBankRepo } from './bank';
import { createContentRepo } from './content';
import { createJournalRepo } from './journal';
import { createReviewsRepo } from './reviews';
import { createSettingsRepo } from './settings';
import { createStatsRepo } from './stats';
import { createSyncStateRepo } from './sync-state';

/**
 * The repository layer — the ONLY place Drizzle/SQL is allowed (roadmap §3).
 * Components and services consume these (usually via React Query hooks in
 * src/db/hooks.ts); nothing outside src/db touches the database directly.
 */
export function createRepositories(db: SumrakDB) {
  return {
    content: createContentRepo(db),
    bank: createBankRepo(db),
    reviews: createReviewsRepo(db),
    journal: createJournalRepo(db),
    stats: createStatsRepo(db),
    settings: createSettingsRepo(db),
    syncState: createSyncStateRepo(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export * from './bank';
export * from './content';
export * from './journal';
export * from './reviews';
export * from './settings';
export * from './stats';
export * from './sync-state';
