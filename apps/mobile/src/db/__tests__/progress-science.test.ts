import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isVisibleLeech, leechStat, LEECH_AGAIN_MIN } from '@/features/dashboard/science/leeches';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import { STABILITY_MATURE_MIN } from '../repositories/dashboard';
import { createTestDb } from './helpers';

/**
 * T38: core coverage (∩ T18 definitions, ё/е fold), the gap list, the
 * forecast source, the heatmap source and the leech candidate query +
 * dismissal round-trip.
 */

const refPack = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../packages/schema/fixtures/packs/core-lemmas-fixture/pack.json'),
    'utf8',
  ),
);

const tok = (text: string, lemma: string, level = 'A1') => ({
  text,
  lemma,
  translation: 'x',
  pos: 'noun',
  level,
});

const storyPack = {
  id: 'a1-sci-test',
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
          ru: 'Дом ночь.',
          en: 'x',
          tokens: [tok('Дом', 'дом'), tok('ночь', 'ночь'), { text: '.', isPunct: true }],
        },
        {
          id: 'sn-2',
          ru: 'Стена тишина.',
          en: 'x',
          tokens: [
            tok('Стена', 'стена'),
            tok('тишина', 'тишина', 'A2'),
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
  await importPack(db, storyPack, { source: 'local-file' });
  return { db, repos };
}

async function setCore(
  repos: ReturnType<typeof createRepositories>,
  itemId: string,
  stability: number,
) {
  for (const c of await repos.reviews.listCardsForItem(itemId)) {
    if (c.direction === 'ru-en' || c.direction === 'en-ru') {
      await repos.reviews.saveCard({ ...c, stability, reps: 1, state: 2 });
    }
  }
}

describe('reference import (T38)', () => {
  it('imports every list entry into core_lemmas with the ё fold; reimport of a higher version replaces', async () => {
    const { db } = await setup();
    const res = await importPack(db, refPack);
    expect(res.counts.lemmas).toBe(15);
    const rows = await db.all<{ lemma: string; lemma_norm: string }>(
      sql`SELECT lemma, lemma_norm FROM core_lemmas WHERE lemma = 'ещё'`,
    );
    expect(rows).toEqual([{ lemma: 'ещё', lemma_norm: 'еще' }]);

    const v2 = structuredClone(refPack);
    v2.version = 2;
    v2.lemmaLists[1].lemmas.pop();
    expect((await importPack(db, v2)).action).toBe('updated');
    const n = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM core_lemmas`);
    expect(n[0]!.n).toBe(14);
  });
});

describe('core coverage (T38)', () => {
  it('no reference installed → no rows', async () => {
    const { repos } = await setup();
    expect(await repos.dashboard.getCoreCoverage()).toEqual([]);
  });

  it('encountered = read ∪ collected; collected; mastered — ∩ core, ё/е-tolerant', async () => {
    const { db, repos } = await setup();
    await importPack(db, refPack);
    await repos.reading.savePosition('a1-sci-test', 'st-1', 0); // sn-1 read: дом, ночь

    const still = await repos.bank.addWord({ lemma: 'еще', surface: 'еще', translation: 'still' });
    const wall = await repos.bank.addWord({
      lemma: 'стена',
      surface: 'стена',
      translation: 'wall',
    });
    await setCore(repos, still.item.id, STABILITY_MATURE_MIN);
    await setCore(repos, wall.item.id, 3);
    // a banked non-core word changes nothing
    await repos.bank.addWord({ lemma: 'призрак', surface: 'призрак', translation: 'ghost' });

    const cov = await repos.dashboard.getCoreCoverage();
    expect(cov).toEqual([
      { level: 'A1', total: 10, encountered: 4, collected: 2, mastered: 1 },
      { level: 'A2', total: 5, encountered: 0, collected: 0, mastered: 0 },
    ]);

    const gaps = await repos.dashboard.getCoreGaps('A1');
    expect(gaps.map((g) => g.lemma)).toEqual(['я', 'жить', 'один', 'что-то', 'чёрный', 'окно']);
    expect(gaps[0]).toEqual({ lemma: 'я', pos: 'pron', translation: 'I' });

    // reading further moves the meter: sn-2 brings тишина (A2)
    await repos.reading.savePosition('a1-sci-test', 'st-1', 1);
    const cov2 = await repos.dashboard.getCoreCoverage();
    expect(cov2.find((c) => c.level === 'A2')!.encountered).toBe(1);
    expect((await repos.dashboard.getCoreGaps('A2')).map((g) => g.lemma)).not.toContain('тишина');
  });
});

describe('forecast + heatmap sources (T38)', () => {
  it('forecast cards = every active-direction card; heatmap reads daily_activity since a date', async () => {
    const { db, repos } = await setup();
    const w = await repos.bank.addWord({ lemma: 'дом', surface: 'дом', translation: 'house' });
    const cards = await repos.dashboard.getForecastCards();
    expect(cards.length).toBe((await repos.reviews.listCardsForItem(w.item.id)).length);
    await db.run(
      sql`INSERT INTO daily_activity (date, reviews_done, reading_ms, stories_finished, xp, updated_at)
          VALUES ('2026-01-02', 5, 60000, 0, 8, 0), ('2025-01-01', 1, 0, 0, 1, 0)`,
    );
    expect(await repos.dashboard.getActivitySince('2026-01-01')).toEqual([
      { date: '2026-01-02', xp: 8, reviewsDone: 5, readingMs: 60000, storiesFinished: 0 },
    ]);
  });
});

describe('leech candidates (T38)', () => {
  it('≥4 Agains in the last 10 reviews; older Agains fall out of the window; dismissal round-trip', async () => {
    const { repos } = await setup();
    const w = await repos.bank.addWord({ lemma: 'дом', surface: 'дом', translation: 'house' });
    const card = (await repos.reviews.listCardsForItem(w.item.id)).find(
      (c) => c.direction === 'ru-en',
    )!;
    let t = 1_000_000;
    // 4 Agains then 6 Goods → still 4 in the last 10 → leech
    for (const r of [1, 1, 1, 1, 3, 3, 3, 3, 3, 3] as const) {
      await repos.reviews.gradeCard(card.id, r, { now: (t += 1000) });
    }
    let cands = await repos.dashboard.getLeechCandidates(LEECH_AGAIN_MIN);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({
      cardId: card.id,
      direction: 'ru-en',
      againCount: 4,
      windowSize: 10,
      dismissedAt: null,
    });

    // one more Good pushes the oldest Again out → 3 → not a leech
    await repos.reviews.gradeCard(card.id, 3, { now: (t += 1000) });
    expect(await repos.dashboard.getLeechCandidates(LEECH_AGAIN_MIN)).toEqual([]);

    // window now A A A G×7: each new Again pushes an old Again out, so three
    // fresh Agains still read 3/10 (G×7 A A A); the fourth reaches 4/10.
    for (let i = 0; i < 3; i++) await repos.reviews.gradeCard(card.id, 1, { now: (t += 1000) });
    expect(await repos.dashboard.getLeechCandidates(LEECH_AGAIN_MIN)).toEqual([]);
    await repos.reviews.gradeCard(card.id, 1, { now: (t += 1000) });
    cands = await repos.dashboard.getLeechCandidates(LEECH_AGAIN_MIN);
    expect(cands).toHaveLength(1);
    await repos.dashboard.dismissLeech(card.id, t + 500);
    cands = await repos.dashboard.getLeechCandidates(LEECH_AGAIN_MIN);
    const visible = (c: (typeof cands)[number]) =>
      isVisibleLeech(
        {
          againCount: c.againCount,
          windowSize: c.windowSize,
          lastReviewedAt: c.lastReviewedAt,
          lastAgainAt: c.lastAgainAt,
        },
        c.dismissedAt,
      );
    expect(cands.filter(visible)).toHaveLength(0);
    await repos.reviews.gradeCard(card.id, 1, { now: (t += 1000) });
    cands = await repos.dashboard.getLeechCandidates(LEECH_AGAIN_MIN);
    expect(cands.filter(visible)).toHaveLength(1);
    // the pure rule agrees with the SQL window
    const stat = leechStat([{ rating: 1, reviewedAt: 1 }]);
    expect(stat!.againCount).toBe(1);
  });
});
