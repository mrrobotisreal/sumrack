import { desc, eq, inArray } from 'drizzle-orm';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';

import { base64ToBytes, bytesToBase64 } from '@/lib/base64';

import { importedPacks, importRequests } from '../schema';
import type { ImportRequestStatus } from '../schema/user';
import type { SumrakDB } from '../types';

export type ImportRequestRow = typeof importRequests.$inferSelect;
export type ImportedPackRow = typeof importedPacks.$inferSelect;

/** Gzip+base64 a pack JSON string for the `imported_packs.packJsonGz` column. */
export function gzipPackJson(json: string): string {
  return bytesToBase64(gzipSync(strToU8(json)));
}

/** Inverse of {@link gzipPackJson}; throws on corrupt input (caller surfaces). */
export function gunzipPackJson(b64: string): string {
  return strFromU8(gunzipSync(base64ToBytes(b64)));
}

/**
 * Share-to-Сумрак storage (T28, design V2 §4.1/§4.3): durable import
 * requests (the T15/T16 queue pattern — a 'queued' row IS the pending
 * request) and committed local packs by value (gzipped pack JSON in a user
 * table so backup/restore round-trips them). All import DB access lives
 * here; the wired flows are in `features/import/`.
 */
export function createImportsRepo(db: SumrakDB) {
  return {
    // ——— import requests ———

    async createRequest(input: {
      id: string;
      text: string;
      title: string;
      sourceLabel?: string | null;
      status: ImportRequestStatus;
    }): Promise<ImportRequestRow> {
      const now = Date.now();
      const row = {
        id: input.id,
        text: input.text,
        title: input.title,
        sourceLabel: input.sourceLabel ?? null,
        status: input.status,
        annotationJson: null,
        error: null,
        packId: null,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(importRequests).values(row);
      return row;
    },

    async listRequests(statuses?: ImportRequestStatus[]): Promise<ImportRequestRow[]> {
      const base = db.select().from(importRequests);
      const rows =
        statuses && statuses.length > 0
          ? await base.where(inArray(importRequests.status, statuses))
          : await base;
      return rows.sort((a, b) => b.createdAt - a.createdAt);
    },

    async getRequest(id: string): Promise<ImportRequestRow | null> {
      const rows = await db.select().from(importRequests).where(eq(importRequests.id, id)).limit(1);
      return rows[0] ?? null;
    },

    /** Partial update; always stamps `updatedAt`. */
    async updateRequest(
      id: string,
      patch: Partial<
        Pick<
          ImportRequestRow,
          'status' | 'annotationJson' | 'error' | 'packId' | 'title' | 'sourceLabel'
        >
      >,
    ): Promise<void> {
      await db
        .update(importRequests)
        .set({ ...patch, updatedAt: Date.now() })
        .where(eq(importRequests.id, id));
    },

    async deleteRequest(id: string): Promise<void> {
      await db.delete(importRequests).where(eq(importRequests.id, id));
    },

    /** Remove-local-pack cleanup: drop request rows committed into `packId`. */
    async deleteRequestsForPack(packId: string): Promise<void> {
      await db.delete(importRequests).where(eq(importRequests.packId, packId));
    },

    // ——— imported packs (by value) ———

    async saveImportedPack(input: {
      id: string;
      title: string;
      sourceLabel?: string | null;
      packJson: string;
    }): Promise<void> {
      await db.insert(importedPacks).values({
        id: input.id,
        title: input.title,
        sourceLabel: input.sourceLabel ?? null,
        packJsonGz: gzipPackJson(input.packJson),
        createdAt: Date.now(),
      });
    },

    async listImportedPacks(): Promise<ImportedPackRow[]> {
      return db.select().from(importedPacks).orderBy(desc(importedPacks.createdAt));
    },

    async getImportedPack(id: string): Promise<ImportedPackRow | null> {
      const rows = await db.select().from(importedPacks).where(eq(importedPacks.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async deleteImportedPack(id: string): Promise<void> {
      await db.delete(importedPacks).where(eq(importedPacks.id, id));
    },
  };
}

export type ImportsRepo = ReturnType<typeof createImportsRepo>;
