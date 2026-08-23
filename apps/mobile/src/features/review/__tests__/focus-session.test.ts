import { describe, expect, it } from 'vitest';

import { importPack } from '@/db/importer';
import { createRepositories } from '@/db/repositories';
import { createTestDb } from '@/db/__tests__/helpers';
import { buildPronunciationSession } from '@/features/pronunciation/session';

import { buildDailySession, dailyItemBankItem } from '../daily/session';

/**
 * T18 "practice now" focused sessions: the launched session must actually
 * narrow to the requested bank items (acceptance: verified by content, not
 * label) and must serve them even when nothing is due.
 */

const pack = {
  id: 'a1-focus-test',
  version: 1,
  type: 'stories',
  title: { ru: 'Тест', en: 'Test' },
  level: 'A1',
  tags: [],
  stories: [
    {
      id: 'st-1',
      title: { ru: 'История', en: 'Story' },
      level: 'A1',
      audio: [],
      sentences: [
        {
          id: 'sn-1',
          ru: 'Кровать стоит тихо.',
          en: 'The bed stands quietly.',
          tokens: [
            { text: 'Кровать', lemma: 'кровать', translation: 'bed', pos: 'noun', level: 'A1' },
            { text: 'стоит', lemma: 'стоять', translation: 'stands', pos: 'verb', level: 'A1' },
            { text: 'тихо', lemma: 'тихо', translation: 'quietly', pos: 'adv', level: 'A1' },
            { text: '.', isPunct: true },
          ],
        },
      ],
    },
  ],
};

async function setup() {
  const db = createTestDb();
  const repos = createRepositories(db);
  await importPack(db, pack, { source: 'local-file' });
  const a = await repos.bank.addWord({ lemma: 'кровать', surface: 'кровать', translation: 'bed' });
  const b = await repos.bank.addWord({
    lemma: 'стоять',
    surface: 'стоит',
    translation: 'to stand',
  });
  const c = await repos.bank.addWord({ lemma: 'тихо', surface: 'тихо', translation: 'quietly' });
  // Push EVERY card into the future — nothing is due.
  const future = Date.now() + 30 * 86_400_000;
  for (const item of [a, b, c]) {
    for (const card of await repos.reviews.listCardsForItem(item.item.id)) {
      await repos.reviews.saveCard({ ...card, dueAt: future, reps: 1, state: 2, stability: 3 });
    }
  }
  return { repos, ids: { a: a.item.id, b: b.item.id, c: c.item.id } };
}

describe('focused daily session', () => {
  it('serves only the focus items, due-agnostic; unfocused build stays empty', async () => {
    const { repos, ids } = await setup();

    expect(await buildDailySession(repos, { length: 20 })).toEqual([]);

    const focused = await buildDailySession(repos, {
      length: 20,
      focusItemIds: [ids.a, ids.b],
    });
    expect(focused.length).toBeGreaterThan(0);
    const served = new Set(focused.map((i) => dailyItemBankItem(i).id));
    expect([...served].sort()).toEqual([ids.a, ids.b].sort());
    expect(served.has(ids.c)).toBe(false);
  });
});

describe('focused pronunciation session', () => {
  it('serves exactly the focus items production cards despite nothing due', async () => {
    const { repos, ids } = await setup();

    expect(await buildPronunciationSession(repos)).toEqual([]);

    const focused = await buildPronunciationSession(repos, { focusItemIds: [ids.c] });
    expect(focused).toHaveLength(1);
    expect(focused[0]!.item.id).toBe(ids.c);
    expect(focused[0]!.card.direction).toBe('production');
  });
});
