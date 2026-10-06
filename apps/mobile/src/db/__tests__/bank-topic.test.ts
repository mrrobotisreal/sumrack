import type { Pack } from '@sumrak/schema';
import newsPackJson from '@sumrak/schema/fixtures/packs/a2-news-090/pack.json';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import { CONTENT_POS, createBankRepo } from '../repositories/bank';
import { bankItems, cards, encounters } from '../schema';
import { createTestDb } from './helpers';

/**
 * T69 «Добавить все слова в Словарь» (TORFL §5.4): `bankLemmasFromStory`
 * banks every content lemma of a story once, in one transaction.
 */

const PACK = newsPackJson as unknown as Pack;
const STORY = PACK.stories[0]!;

function contentLemmas(): { lemma: string; firstSentence: string; surface: string }[] {
  const seen = new Map<string, { lemma: string; firstSentence: string; surface: string }>();
  for (const s of STORY.sentences) {
    for (const t of s.tokens) {
      if (t.isPunct || !t.lemma || !t.pos || !CONTENT_POS.includes(t.pos)) continue;
      const key = t.lemma.normalize('NFC').toLowerCase().replaceAll('ё', 'е');
      if (!seen.has(key)) seen.set(key, { lemma: t.lemma, firstSentence: s.id, surface: t.text });
    }
  }
  return [...seen.values()];
}

describe('bankLemmasFromStory', () => {
  it('adds N new lemmas once — one encounter at the first sentence; a second run adds 0', async () => {
    const db = createTestDb();
    await importPack(db, PACK, { source: 'bundled' });
    const repos = createRepositories(db);
    const expected = contentLemmas();
    expect(expected.length).toBeGreaterThan(5);

    const first = await repos.bank.bankLemmasFromStory(PACK.id, STORY.id);
    expect(first).toEqual({ words: expected.length, added: expected.length, skipped: 0 });
    expect(await repos.bank.countItems('word')).toBe(expected.length);
    expect(await db.select().from(encounters)).toHaveLength(expected.length);

    for (const { lemma, firstSentence, surface } of expected.slice(0, 5)) {
      const item = (await repos.bank.findWordByLemma(lemma))!;
      expect(item.sourceStoryId).toBe(STORY.id);
      expect(item.sourceSentenceId).toBe(firstSentence);
      expect(item.surface).toBe(surface);
      const enc = await db.select().from(encounters).where(eq(encounters.bankItemId, item.id));
      expect(enc.map((e) => e.sentenceId)).toEqual([firstSentence]);
    }
    // the T06 invariant: every new item got its FSRS cards (inside the transaction)
    const cardItems = new Set((await db.select().from(cards)).map((c) => c.bankItemId));
    expect(cardItems.size).toBe(expected.length);

    const second = await repos.bank.bankLemmasFromStory(PACK.id, STORY.id);
    expect(second).toEqual({ words: expected.length, added: 0, skipped: expected.length });
    expect(await repos.bank.countItems('word')).toBe(expected.length);
    expect(await db.select().from(encounters)).toHaveLength(expected.length);
  });

  it('skips lemmas already banked (ё/е-tolerant) without adding encounters; only content POS', async () => {
    const db = createTestDb();
    await importPack(db, PACK, { source: 'bundled' });
    const bank = createBankRepo(db);
    const expected = contentLemmas();
    const pre = expected[0]!;
    await bank.addWord({ lemma: pre.lemma.toUpperCase(), surface: pre.surface, translation: 'x' });

    const res = await bank.bankLemmasFromStory(PACK.id, STORY.id);
    expect(res).toEqual({ words: expected.length, added: expected.length - 1, skipped: 1 });
    const preItem = (await bank.findWordByLemma(pre.lemma))!;
    expect((await bank.getItemWithEncounters(preItem.id))!.encounters).toHaveLength(1);

    const pos = new Set((await db.select().from(bankItems)).map((b) => b.pos));
    for (const p of pos) if (p !== null) expect(CONTENT_POS).toContain(p);
    // a name/prep/pron token never lands
    expect(await bank.findWordByLemma('в')).toBeNull();
  });

  it('rolls back every row when a write fails mid-way', async () => {
    const db = createTestDb();
    await importPack(db, PACK, { source: 'bundled' });
    let n = 0;
    const bank = createBankRepo(db, {
      withinBulkAdd: async () => {
        if (++n === 3) throw new Error('boom');
      },
    });
    await expect(bank.bankLemmasFromStory(PACK.id, STORY.id)).rejects.toThrow('boom');
    expect(await bank.countItems()).toBe(0);
    expect(await db.select().from(encounters)).toHaveLength(0);
  });

  it('unknown story → zero, no writes', async () => {
    const db = createTestDb();
    const bank = createBankRepo(db);
    expect(await bank.bankLemmasFromStory('nope', 'nope')).toEqual({
      words: 0,
      added: 0,
      skipped: 0,
    });
  });
});
