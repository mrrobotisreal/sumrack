import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { newId } from '../ids';
import { bookmarks } from '../schema';
import type { SumrakDB } from '../types';

/**
 * Story/sentence bookmarks (T24, V2 §7.1). Content refs are unenforced
 * stable ids (user-table convention): a bookmark into a since-removed pack
 * stays in the list and resolves to a "content removed" state UI-side,
 * mirroring T05's null-safe encounter contexts.
 *
 * Rows out of this repo are Zod-parsed (ticket DoD: Zod at the new I/O
 * boundary) — the row shape is tiny and lists are short, so the runtime
 * check is effectively free and catches schema drift loudly.
 */

export const BookmarkRowSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['story', 'sentence']),
  packId: z.string(),
  storyId: z.string(),
  sentenceId: z.string().nullable(),
  createdAt: z.number().int(),
});

export type BookmarkRow = z.infer<typeof BookmarkRowSchema>;

export interface ToggleResult {
  /** true = the toggle created a bookmark; false = it removed one. */
  added: boolean;
}

export function createBookmarksRepo(db: SumrakDB) {
  function parseRows(rows: unknown[]): BookmarkRow[] {
    return rows.map((r) => BookmarkRowSchema.parse(r));
  }

  async function findStory(packId: string, storyId: string) {
    const rows = await db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.kind, 'story'),
          eq(bookmarks.packId, packId),
          eq(bookmarks.storyId, storyId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async function findSentence(packId: string, sentenceId: string) {
    const rows = await db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.kind, 'sentence'),
          eq(bookmarks.packId, packId),
          eq(bookmarks.sentenceId, sentenceId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    /** Newest first — the «Закладки» list order. */
    async list(): Promise<BookmarkRow[]> {
      const rows = await db.select().from(bookmarks).orderBy(desc(bookmarks.createdAt));
      return parseRows(rows);
    },

    /** Every bookmark touching one story — drives the reader's toggle states. */
    async listForStory(packId: string, storyId: string): Promise<BookmarkRow[]> {
      const rows = await db
        .select()
        .from(bookmarks)
        .where(and(eq(bookmarks.packId, packId), eq(bookmarks.storyId, storyId)));
      return parseRows(rows);
    },

    /** Story ids with a story-level bookmark, keyed `packId/storyId` (Library indicator). */
    async storyKeySet(): Promise<Set<string>> {
      const rows = await db
        .select({ packId: bookmarks.packId, storyId: bookmarks.storyId })
        .from(bookmarks)
        .where(eq(bookmarks.kind, 'story'));
      return new Set(rows.map((r) => `${r.packId}/${r.storyId}`));
    },

    async toggleStory(packId: string, storyId: string): Promise<ToggleResult> {
      const existing = await findStory(packId, storyId);
      if (existing) {
        await db.delete(bookmarks).where(eq(bookmarks.id, existing.id));
        return { added: false };
      }
      await db.insert(bookmarks).values({
        id: newId(),
        kind: 'story',
        packId,
        storyId,
        sentenceId: null,
        createdAt: Date.now(),
      });
      return { added: true };
    },

    async toggleSentence(
      packId: string,
      storyId: string,
      sentenceId: string,
    ): Promise<ToggleResult> {
      const existing = await findSentence(packId, sentenceId);
      if (existing) {
        await db.delete(bookmarks).where(eq(bookmarks.id, existing.id));
        return { added: false };
      }
      await db.insert(bookmarks).values({
        id: newId(),
        kind: 'sentence',
        packId,
        storyId,
        sentenceId,
        createdAt: Date.now(),
      });
      return { added: true };
    },

    async remove(id: string): Promise<void> {
      await db.delete(bookmarks).where(eq(bookmarks.id, id));
    },

    async count(): Promise<number> {
      const rows = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM bookmarks`);
      return rows[0]?.n ?? 0;
    },
  };
}

export type BookmarksRepo = ReturnType<typeof createBookmarksRepo>;
