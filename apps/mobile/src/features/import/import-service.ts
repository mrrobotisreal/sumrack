import { parsePack } from '@sumrak/schema';

import { db, importPack, removePack, repos } from '@/db';
import { queryKeys } from '@/db/hooks';
import type { ImportRequestRow } from '@/db/repositories/imports';
import { syncQueryKeys } from '@/features/sync/hooks';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';

import {
  buildImportedPackId,
  buildStubPack,
  ImportIntakeSchema,
  normalizeIntakeText,
  planImportSplit,
  type ImportIntake,
} from './import-core';

/**
 * Wired Share-to-Сумрак flows (T28): intake → durable request rows, the
 * commit gate (T29 calls `commitRequestAsPack` with its AI annotation), the
 * dev-only stub path, and local-pack removal. Analytics carry counts and
 * char counts ONLY — never text content, titles, or the title-derived pack
 * ids (recorded T28 decision; unlike sync's remote pack ids, import ids
 * embed transliterated user content).
 */

export const importQueryKeys = {
  requests: ['import-requests'] as const,
  importedPacks: ['imported-packs'] as const,
};

async function invalidateImportQueries(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: importQueryKeys.requests }),
    queryClient.invalidateQueries({ queryKey: importQueryKeys.importedPacks }),
  ]);
}

async function invalidateContentQueries(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.packs }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stories }),
    queryClient.invalidateQueries({ queryKey: syncQueryKeys.installedPacks }),
  ]);
}

let requestSeq = 0;
function newRequestId(): string {
  requestSeq += 1;
  return `imp-${Date.now()}-${requestSeq}`;
}

/**
 * Intake commit: Zod-validate, NFC-normalize (untrusted input), split at
 * sentence boundaries when over the cap, persist one durable `'queued'`
 * request per part (V2 §4.1: queued offline like journal feedback — T29's
 * annotation worker consumes `'queued'` rows when online).
 */
export async function createImportRequests(input: ImportIntake): Promise<ImportRequestRow[]> {
  const intake = ImportIntakeSchema.parse(input);
  const text = normalizeIntakeText(intake.text);
  const title = intake.title.normalize('NFC').replace(/\s+/g, ' ').trim();
  const sourceLabel = intake.sourceLabel?.normalize('NFC').trim() || null;
  if (!text || !title) throw new Error('import needs non-empty text and title');

  const parts = planImportSplit(text);
  const rows: ImportRequestRow[] = [];
  for (const [i, part] of parts.entries()) {
    const row = await repos.imports.createRequest({
      id: newRequestId(),
      text: part,
      title: parts.length > 1 ? `${title} (${i + 1}/${parts.length})` : title,
      sourceLabel,
      status: 'queued',
    });
    rows.push(row);
    track('import_request_created', { chars: part.length, parts: parts.length });
  }
  if (parts.length > 1) {
    track('import_request_split', { parts: parts.length, chars: text.length });
  }
  await invalidateImportQueries();
  return rows;
}

/** Delete a not-yet-committed request (committed ones die with their pack). */
export async function removeImportRequest(id: string): Promise<void> {
  await repos.imports.deleteRequest(id);
  track('import_request_removed', {});
  await invalidateImportQueries();
}

/**
 * THE commit gate (V2 §4.3, shared with T29): validate the assembled pack
 * against `packages/schema`, store it by value in `imported_packs` (backup
 * home), then run the standard T03 importer with local provenance
 * (`origin:'local'` + `source:'local-import'` — the sync-immunity pair).
 * If the import fails the stored row is compensated away and the request
 * left untouched, so a retry is clean.
 */
export async function commitRequestAsPack(
  requestId: string,
  rawPack: unknown,
): Promise<{ packId: string }> {
  const request = await repos.imports.getRequest(requestId);
  if (!request) throw new Error(`import request not found: ${requestId}`);

  const pack = parsePack(rawPack); // throws SchemaValidationError on any violation
  await repos.imports.saveImportedPack({
    id: pack.id,
    title: request.title,
    sourceLabel: request.sourceLabel,
    packJson: JSON.stringify(rawPack),
  });
  try {
    const result = await importPack(db, rawPack, { source: 'local-import', origin: 'local' });
    track('import_committed', {
      sentences: result.counts.sentences,
      tokens: result.counts.tokens,
      chars: request.text.length,
    });
  } catch (err) {
    await repos.imports.deleteImportedPack(pack.id);
    throw err;
  }
  await repos.imports.updateRequest(requestId, {
    status: 'committed',
    packId: pack.id,
    error: null,
  });

  await Promise.all([invalidateImportQueries(), invalidateContentQueries()]);
  return { packId: pack.id };
}

/**
 * DEV-ONLY stub annotation (T28 scope item 6, replaced by T29): turns a
 * queued request into a minimal valid pack via the rule-based stub builder
 * and commits it through the standard gate. Reached only from the
 * Developer settings screen.
 */
export async function stubAnnotateAndCommit(requestId: string): Promise<{ packId: string }> {
  const request = await repos.imports.getRequest(requestId);
  if (!request) throw new Error(`import request not found: ${requestId}`);

  const [installed, importedRows] = await Promise.all([
    repos.content.listPacks(),
    repos.imports.listImportedPacks(),
  ]);
  const existing = [...installed.map((p) => p.id), ...importedRows.map((r) => r.id)];
  const packId = buildImportedPackId(request.title, existing, new Date());
  const raw = buildStubPack({ packId, title: request.title, text: request.text });
  return commitRequestAsPack(request.id, raw);
}

/**
 * Remove = full delete (recorded T28 decision): content rows (cascade),
 * sync_state row, the `imported_packs` value row, AND the committed
 * request. Nothing re-imports it afterwards — it is gone from backups too.
 */
export async function removeImportedPack(packId: string): Promise<void> {
  await removePack(db, packId);
  await repos.imports.deleteImportedPack(packId);
  await repos.imports.deleteRequestsForPack(packId);
  track('import_pack_removed', {});
  await Promise.all([invalidateImportQueries(), invalidateContentQueries()]);
}
