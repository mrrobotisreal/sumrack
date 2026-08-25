import { emitMotivationEvent } from '@/services/motivation-bus';

import type { SumrakDB } from '../types';
import { createBankRepo } from './bank';
import { createBookmarksRepo } from './bookmarks';
import { createContentRepo } from './content';
import { createDashboardRepo } from './dashboard';
import { createDialoguesRepo } from './dialogues';
import { createJournalRepo } from './journal';
import { createPathRepo } from './path';
import { createReadingRepo } from './reading';
import { createReviewsRepo } from './reviews';
import { createSettingsRepo } from './settings';
import { createStatsRepo } from './stats';
import { createSyncStateRepo } from './sync-state';

/**
 * The repository layer — the ONLY place Drizzle/SQL is allowed (roadmap §3).
 * Components and services consume these (usually via React Query hooks in
 * src/db/hooks.ts); nothing outside src/db touches the database directly.
 *
 * Cross-repo invariant wired here (T06): every bank add — from any write
 * path — ensures the item's ACTIVE_DIRECTIONS FSRS cards exist. ensureCards
 * is idempotent, and running it on deduped adds too quietly heals items
 * that predate T06.
 */
export function createRepositories(db: SumrakDB) {
  const reviews = createReviewsRepo(db);
  return {
    content: createContentRepo(db),
    bank: createBankRepo(db, {
      afterAdd: async (item) => {
        await reviews.ensureCards(item.id);
        // T19: bank-size achievements listen on the bus (repos stay feature-free).
        emitMotivationEvent('bank-item-added');
      },
    }),
    reviews,
    bookmarks: createBookmarksRepo(db),
    dashboard: createDashboardRepo(db),
    dialogues: createDialoguesRepo(db),
    journal: createJournalRepo(db),
    path: createPathRepo(db),
    reading: createReadingRepo(db),
    stats: createStatsRepo(db),
    settings: createSettingsRepo(db),
    syncState: createSyncStateRepo(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export * from './bank';
export * from './bookmarks';
export * from './content';
export * from './dashboard';
export * from './dialogues';
export * from './journal';
export * from './path';
export * from './reading';
export * from './reviews';
export * from './settings';
export * from './stats';
export * from './sync-state';
