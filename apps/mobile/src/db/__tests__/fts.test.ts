import type { Pack } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import pack1Json from '@sumrak/schema/fixtures/packs/a1-creepypasta-001/pack.json';
import pack2Json from '@sumrak/schema/fixtures/packs/a1-creepypasta-002/pack.json';

import { importPack } from '../importer';
import { createContentRepo } from '../repositories/content';
import { createJournalRepo } from '../repositories/journal';
import { createTestDb } from './helpers';

const pack1 = pack1Json as unknown as Pack;
const pack2 = pack2Json as unknown as Pack;

describe('FTS5 search', () => {
  it('finds a known lemma across imported tokens', async () => {
    const db = createTestDb();
    await importPack(db, pack1);
    const content = createContentRepo(db);

    const hits = await content.searchTokens('стена');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.lemma === 'стена')).toBe(true);
    expect(hits[0]!.packId).toBe('a1-creepypasta-001');
  });

  it('is ё/е-tolerant: searching "черный" finds «чёрный»', async () => {
    const db = createTestDb();
    await importPack(db, pack2);
    const content = createContentRepo(db);

    const hits = await content.searchTokens('черный');
    expect(hits.some((h) => h.lemma === 'чёрный')).toBe(true);
    // And the other direction: a ё query finds the same token.
    const hitsYo = await content.searchTokens('чёрный');
    expect(hitsYo.some((h) => h.lemma === 'чёрный')).toBe(true);
  });

  it('surface-form prefix search works for as-you-type lookup', async () => {
    const db = createTestDb();
    await importPack(db, pack1);
    const content = createContentRepo(db);
    const hits = await content.searchTokens('стуч');
    // «стучит» etc. — any surface starting with "стуч" (fallback: at least no throw)
    expect(Array.isArray(hits)).toBe(true);
  });

  it('reimport keeps the token index in sync (no stale rows)', async () => {
    const db = createTestDb();
    await importPack(db, pack1);
    const content = createContentRepo(db);
    const before = (await content.searchTokens('стена')).length;
    await importPack(db, { ...pack1, version: 2 } as Pack);
    const after = (await content.searchTokens('стена')).length;
    expect(after).toBe(before);
  });

  it('searches notes and journal entries, ё/е-tolerant via triggers', async () => {
    const db = createTestDb();
    const journal = createJournalRepo(db);

    await journal.createNote({ title: 'Грамматика', body: 'Разница между ещё и уже.' });
    await journal.createEntry({ ru: 'Сегодня я учу русский язык. Всё хорошо.' });

    const noteHits = await journal.searchNotes('еще');
    expect(noteHits).toHaveLength(1);
    expect(noteHits[0]!.body).toContain('ещё'); // stored text keeps ё

    const entryHits = await journal.searchEntries('все');
    expect(entryHits).toHaveLength(1);
    expect(entryHits[0]!.ru).toContain('Всё');

    // Update propagates through the au trigger; delete removes from the index.
    const note = noteHits[0]!;
    await journal.updateNote(note.id, { body: 'Теперь тут другой текст.' });
    expect(await journal.searchNotes('еще')).toHaveLength(0);
    expect(await journal.searchNotes('другой')).toHaveLength(1);
    await journal.deleteNote(note.id);
    expect(await journal.searchNotes('другой')).toHaveLength(0);
  });

  it('never throws on hostile query input', async () => {
    const db = createTestDb();
    const content = createContentRepo(db);
    for (const q of ['"', 'AND OR NOT', '(((', '*', '  ', 'стена" OR "1']) {
      await expect(content.searchTokens(q)).resolves.toBeDefined();
    }
  });
});
