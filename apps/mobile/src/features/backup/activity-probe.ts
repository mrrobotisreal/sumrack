import { gt, gte, sql } from 'drizzle-orm';

import { bankItems, journalEntries, notes, reviewLog } from '@/db/schema';
import type { SumrakDB } from '@/db/types';

/**
 * "Significant session" heuristic for the post-session auto-backup trigger
 * (ticket item 5, implementer's call — documented here): since the last
 * successful backup there have been ≥20 reviews, OR any journal entry or
 * note was touched, OR any bank item was added. Cheap indexed queries only.
 */
export const SIGNIFICANT_REVIEWS = 20;

export interface ActivityProbe {
  reviews: number;
  journalTouched: boolean;
  notesTouched: boolean;
  bankAdded: boolean;
  significant: boolean;
}

export async function probeActivitySince(db: SumrakDB, sinceMs: number): Promise<ActivityProbe> {
  const [reviewRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(reviewLog)
    .where(gt(reviewLog.reviewedAt, sinceMs));
  const [journalRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(journalEntries)
    .where(gt(journalEntries.updatedAt, sinceMs));
  const [notesRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(notes)
    .where(gt(notes.updatedAt, sinceMs));
  const [bankRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(bankItems)
    .where(gte(bankItems.createdAt, sinceMs));

  const reviews = reviewRow?.n ?? 0;
  const journalTouched = (journalRow?.n ?? 0) > 0;
  const notesTouched = (notesRow?.n ?? 0) > 0;
  const bankAdded = (bankRow?.n ?? 0) > 0;
  return {
    reviews,
    journalTouched,
    notesTouched,
    bankAdded,
    significant: reviews >= SIGNIFICANT_REVIEWS || journalTouched || notesTouched || bankAdded,
  };
}
