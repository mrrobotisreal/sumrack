import { desc, eq, sql } from 'drizzle-orm';

import { newId } from '../ids';
import { toFtsQuery } from '../normalize';
import { journalEntries, notes, type FeedbackStatus } from '../schema';
import type { SumrakDB } from '../types';

export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;

/** Journal entries + markdown study notes, with FTS search over both. */
export function createJournalRepo(db: SumrakDB) {
  return {
    async createEntry(input: { ru: string; promptId?: string }): Promise<JournalEntryRow> {
      const now = Date.now();
      const row: typeof journalEntries.$inferInsert = {
        id: newId(),
        promptId: input.promptId ?? null,
        ru: input.ru,
        aiFeedback: null,
        feedbackStatus: 'none',
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(journalEntries).values(row);
      return row as JournalEntryRow;
    },

    async updateEntry(id: string, patch: { ru?: string; promptId?: string | null }) {
      await db
        .update(journalEntries)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(journalEntries.id, id));
    },

    async setFeedback(id: string, status: FeedbackStatus, aiFeedback?: string) {
      await db
        .update(journalEntries)
        .set({ feedbackStatus: status, aiFeedback: aiFeedback ?? null, updatedAt: Date.now() })
        .where(eq(journalEntries.id, id));
    },

    async getEntry(id: string): Promise<JournalEntryRow | null> {
      const rows = await db.select().from(journalEntries).where(eq(journalEntries.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listEntries(limit = 100): Promise<JournalEntryRow[]> {
      return db.select().from(journalEntries).orderBy(desc(journalEntries.createdAt)).limit(limit);
    },

    /** Entries awaiting AI feedback — the T16 queue is derived from this, oldest first. */
    async listEntriesByStatus(status: FeedbackStatus, limit = 50): Promise<JournalEntryRow[]> {
      return db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.feedbackStatus, status))
        .orderBy(journalEntries.updatedAt)
        .limit(limit);
    },

    async deleteEntry(id: string) {
      await db.delete(journalEntries).where(eq(journalEntries.id, id));
    },

    async searchEntries(query: string, limit = 50): Promise<JournalEntryRow[]> {
      const match = toFtsQuery(query);
      if (!match) return [];
      return db.all<JournalEntryRow>(sql`
        SELECT j.id, j.prompt_id AS promptId, j.ru, j.ai_feedback AS aiFeedback,
               j.feedback_status AS feedbackStatus, j.created_at AS createdAt,
               j.updated_at AS updatedAt
        FROM journal_fts f
        JOIN journal_entries j ON j.rowid = f.rowid
        WHERE journal_fts MATCH ${match}
        ORDER BY rank
        LIMIT ${limit}
      `);
    },

    async createNote(input: { title: string; body: string }): Promise<NoteRow> {
      const now = Date.now();
      const row: typeof notes.$inferInsert = {
        id: newId(),
        title: input.title,
        body: input.body,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(notes).values(row);
      return row as NoteRow;
    },

    async updateNote(id: string, patch: { title?: string; body?: string }) {
      await db
        .update(notes)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(notes.id, id));
    },

    async getNote(id: string): Promise<NoteRow | null> {
      const rows = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listNotes(limit = 200): Promise<NoteRow[]> {
      return db.select().from(notes).orderBy(desc(notes.updatedAt)).limit(limit);
    },

    async deleteNote(id: string) {
      await db.delete(notes).where(eq(notes.id, id));
    },

    async searchNotes(query: string, limit = 50): Promise<NoteRow[]> {
      const match = toFtsQuery(query);
      if (!match) return [];
      return db.all<NoteRow>(sql`
        SELECT n.id, n.title, n.body, n.created_at AS createdAt, n.updated_at AS updatedAt
        FROM notes_fts f
        JOIN notes n ON n.rowid = f.rowid
        WHERE notes_fts MATCH ${match}
        ORDER BY rank
        LIMIT ${limit}
      `);
    },
  };
}

export type JournalRepo = ReturnType<typeof createJournalRepo>;
