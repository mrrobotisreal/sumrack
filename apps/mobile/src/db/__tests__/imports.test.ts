import { parsePack } from '@sumrak/schema';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { importPack, reimportLocalPacks, removePack } from '../importer';
import { createImportsRepo, gunzipPackJson, gzipPackJson } from '../repositories/imports';
import { createSyncStateRepo } from '../repositories/sync-state';
import { bankItems, packs, sentences, stories, tokens } from '../schema';
import { createTestDb } from './helpers';

/** T28 local-pack storage model at the DB layer (the wired service is
 * device-only; the on-device acceptance pass exercises it end-to-end). */

const STUB_INPUT = {
  packId: 'imported-20260825-vecher',
  title: 'Тёмный вечер',
  text: 'Это тёмный вечер. Кто-то стучит в дверь!',
};

/**
 * Minimal valid local pack for these lifecycle tests (T28's dev-only
 * `buildStubPack` was removed in T29 — the real path assembles packs from
 * annotation envelopes; this fixture only needs to satisfy `parsePack`).
 */
function buildStubPack(input: { packId: string; title: string; text: string }): unknown {
  const title = { ru: input.title, en: input.title };
  const sentence = (id: string, ru: string) => ({
    id,
    ru,
    en: '—',
    tokens: ru.split(' ').flatMap((chunk) => {
      const m = /^(.*?)([.!?…]*)$/u.exec(chunk)!;
      const word = m[1]!;
      const punct = m[2]!;
      return [
        ...(word ? [{ text: word, lemma: word }] : []),
        ...(punct ? [{ text: punct, isPunct: true }] : []),
      ];
    }),
  });
  return {
    id: input.packId,
    version: 1,
    type: 'stories',
    title,
    level: 'A1',
    tags: ['imported'],
    stories: [
      {
        id: 's1',
        title,
        level: 'A1',
        sentences: input.text
          .split(/(?<=[.!?…])\s+/u)
          .map((ru, i) => sentence(`s1-${String(i + 1).padStart(3, '0')}`, ru)),
        audio: [],
      },
    ],
  };
}

describe('imports repo', () => {
  it('request rows are durable with the T29 status walk fields in place', async () => {
    const db = createTestDb();
    const repo = createImportsRepo(db);
    await repo.createRequest({
      id: 'imp-1',
      text: 'Привет.',
      title: 'Привет',
      sourceLabel: 'Telegram',
      status: 'queued',
    });

    const queued = await repo.listRequests(['queued']);
    expect(queued.map((r) => r.id)).toEqual(['imp-1']);

    await repo.updateRequest('imp-1', { status: 'failed', error: 'offline' });
    const failed = await repo.getRequest('imp-1');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('offline');
    expect(failed?.updatedAt).toBeGreaterThanOrEqual(failed!.createdAt);

    await repo.updateRequest('imp-1', { status: 'committed', packId: 'imported-x', error: null });
    expect(await repo.listRequests(['queued'])).toEqual([]);
    await repo.deleteRequestsForPack('imported-x');
    expect(await repo.getRequest('imp-1')).toBeNull();
  });

  it('gzips pack JSON round-trip (base64 text — survives the JSON backup payload)', () => {
    const json = JSON.stringify(buildStubPack(STUB_INPUT));
    const gz = gzipPackJson(json);
    expect(gz).not.toContain('{'); // actually encoded
    expect(gunzipPackJson(gz)).toBe(json);
    expect(() => parsePack(JSON.parse(gunzipPackJson(gz)))).not.toThrow();
  });
});

describe('local-pack lifecycle (commit → reimport → remove)', () => {
  async function commitStub(db: ReturnType<typeof createTestDb>) {
    const repo = createImportsRepo(db);
    const raw = buildStubPack(STUB_INPUT);
    await repo.saveImportedPack({
      id: STUB_INPUT.packId,
      title: STUB_INPUT.title,
      sourceLabel: 'Telegram',
      packJson: JSON.stringify(raw),
    });
    await importPack(db, raw, { source: 'local-import', origin: 'local' });
    return repo;
  }

  it('installs with local provenance on both keys (packs.origin + sync_state source)', async () => {
    const db = createTestDb();
    await commitStub(db);

    const [packRow] = await db.select().from(packs).where(eq(packs.id, STUB_INPUT.packId));
    expect(packRow?.origin).toBe('local');
    const state = await createSyncStateRepo(db).getInstalled(STUB_INPUT.packId);
    expect(state?.source).toBe('local-import');

    // Content is first-class: sentences + tokens landed like any pack.
    const sentenceRows = await db
      .select()
      .from(sentences)
      .where(eq(sentences.packId, STUB_INPUT.packId));
    expect(sentenceRows).toHaveLength(2);
  });

  it('reimportLocalPacks restores wiped content from the imported_packs row, idempotently', async () => {
    const db = createTestDb();
    await commitStub(db);

    // Wipe content only (the restore situation: user tables land, content gone).
    await db.delete(packs).where(eq(packs.id, STUB_INPUT.packId));
    expect(await db.select().from(stories)).toHaveLength(0);

    const first = await reimportLocalPacks(db);
    expect(first).toEqual({ reimported: [STUB_INPUT.packId], failed: [] });
    const [packRow] = await db.select().from(packs).where(eq(packs.id, STUB_INPUT.packId));
    expect(packRow?.origin).toBe('local');
    expect(await createSyncStateRepo(db).getInstalled(STUB_INPUT.packId)).not.toBeNull();

    // Healthy state → no-op.
    const second = await reimportLocalPacks(db);
    expect(second).toEqual({ reimported: [], failed: [] });
  });

  it('a corrupt imported_packs row fails contained, without blocking others', async () => {
    const db = createTestDb();
    const repo = await commitStub(db);
    await db.delete(packs).where(eq(packs.id, STUB_INPUT.packId));
    await repo.saveImportedPack({
      id: 'imported-20260825-broken',
      title: 'Broken',
      packJson: '{"not": "a pack"}',
    });

    const result = await reimportLocalPacks(db);
    expect(result.reimported).toEqual([STUB_INPUT.packId]);
    expect(result.failed).toEqual(['imported-20260825-broken']);
  });

  it('remove = full delete (content cascade + value row + request), bank items untouched', async () => {
    const db = createTestDb();
    const repo = await commitStub(db);
    await repo.createRequest({
      id: 'imp-1',
      text: STUB_INPUT.text,
      title: STUB_INPUT.title,
      status: 'queued',
    });
    await repo.updateRequest('imp-1', { status: 'committed', packId: STUB_INPUT.packId });

    // A word highlighted from the imported story (survives removal by design).
    await db.insert(bankItems).values({
      id: 'bi-1',
      kind: 'word',
      lemma: 'вечер',
      lemmaNorm: 'вечер',
      surface: 'вечер',
      normalized: 'вечер',
      translation: '',
      needsEnrichment: true,
      sourceSentenceId: 's1-001',
      sourceStoryId: 's1',
      createdAt: 1,
    });

    // The remove-imported-pack sequence (mirrors import-service.removeImportedPack).
    await removePack(db, STUB_INPUT.packId);
    await repo.deleteImportedPack(STUB_INPUT.packId);
    await repo.deleteRequestsForPack(STUB_INPUT.packId);

    expect(await db.select().from(packs)).toHaveLength(0);
    expect(await db.select().from(stories)).toHaveLength(0);
    expect(await db.select().from(tokens)).toHaveLength(0);
    expect(await repo.listImportedPacks()).toEqual([]);
    expect(await repo.getRequest('imp-1')).toBeNull();
    expect(await createSyncStateRepo(db).getInstalled(STUB_INPUT.packId)).toBeNull();
    // …and nothing re-imports it: no value row → reimport is a no-op.
    expect(await reimportLocalPacks(db)).toEqual({ reimported: [], failed: [] });
    // User data untouched.
    expect(await db.select().from(bankItems)).toHaveLength(1);
  });
});
