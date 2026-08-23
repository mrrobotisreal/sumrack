import { describe, expect, it } from 'vitest';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import { STABILITY_MATURE_MIN, STABILITY_YOUNG_MIN } from '../repositories/dashboard';
import { createTestDb } from './helpers';

/**
 * T18: the dashboard aggregation repo. Definitions under test are the ones
 * recorded in the ticket notes: stability bands (<7 / 7–30 / ≥30 by MIN
 * core-card stability), encountered = read-sentences ∪ collected, topic
 * seen = read sentence carries it, topic practiced = a topic-sentence lemma
 * has review history.
 */

const pack = {
  id: 'a1-dash-test',
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
          ru: 'В подвале стоит кровать.',
          en: 'A bed stands in the cellar.',
          grammarTopics: ['prepositional-location', 'verbs-of-position'],
          tokens: [
            { text: 'В', lemma: 'в', translation: 'in', pos: 'prep', level: 'A1' },
            { text: 'подвале', lemma: 'подвал', translation: 'cellar', pos: 'noun', level: 'A2' },
            { text: 'стоит', lemma: 'стоять', translation: 'stands', pos: 'verb', level: 'A1' },
            { text: 'кровать', lemma: 'кровать', translation: 'bed', pos: 'noun', level: 'A1' },
            { text: '.', isPunct: true },
          ],
        },
        {
          id: 'sn-2',
          ru: 'Тёмная вода шумит.',
          en: 'Dark water makes noise.',
          grammarTopics: ['adjective-agreement'],
          tokens: [
            { text: 'Тёмная', lemma: 'тёмный', translation: 'dark', pos: 'adj', level: 'A2' },
            { text: 'вода', lemma: 'вода', translation: 'water', pos: 'noun', level: 'A1' },
            {
              text: 'шумит',
              lemma: 'шуметь',
              translation: 'makes noise',
              pos: 'verb',
              level: 'B1',
            },
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
  return { db, repos };
}

/** Force a card's stability/reps directly (bands are threshold tests). */
async function setCoreStability(
  repos: ReturnType<typeof createRepositories>,
  bankItemId: string,
  stability: number,
) {
  const cards = await repos.reviews.listCardsForItem(bankItemId);
  for (const card of cards) {
    if (card.direction !== 'ru-en' && card.direction !== 'en-ru') continue;
    await repos.reviews.saveCard({ ...card, stability, reps: 1, state: 2 });
  }
}

describe('dashboard repo — vocab by level', () => {
  it('nothing read, nothing collected → no rows', async () => {
    const { repos } = await setup();
    expect(await repos.dashboard.getVocabByLevel()).toEqual([]);
  });

  it('encountered counts only read sentences; collected/bands roll up by min core stability', async () => {
    const { repos } = await setup();
    // Read up to sentence 0 only → sn-1's 4 lemmas encountered, sn-2's not.
    await repos.reading.savePosition('a1-dash-test', 'st-1', 0);

    const bed = await repos.bank.addWord({
      lemma: 'кровать',
      surface: 'кровать',
      translation: 'bed',
    });
    const stand = await repos.bank.addWord({
      lemma: 'стоять',
      surface: 'стоит',
      translation: 'to stand',
    });

    // кровать young (min across directions = 10), стоять shaky (2).
    await setCoreStability(repos, bed.item.id, 10);
    await setCoreStability(repos, stand.item.id, 2);

    const rows = await repos.dashboard.getVocabByLevel();
    const a1 = rows.find((r) => r.level === 'A1')!;
    // sn-1 lemmas: в(A1), подвал(A2), стоять(A1), кровать(A1) → A1 encountered = 3.
    expect(a1).toEqual({
      level: 'A1',
      encountered: 3,
      collected: 2,
      learning: 1,
      young: 1,
      mature: 0,
    });
    const a2 = rows.find((r) => r.level === 'A2')!;
    expect(a2.encountered).toBe(1); // подвал only — sn-2 unread
    expect(a2.collected).toBe(0);
  });

  it('finished story counts every sentence; band thresholds are exact', async () => {
    const { repos } = await setup();
    await repos.reading.markFinished('a1-dash-test', 'st-1');

    const dark = await repos.bank.addWord({
      lemma: 'темный',
      surface: 'темная',
      translation: 'dark',
    });
    // ё/е tolerance: bank spelled without ё still matches content 'тёмный'.
    await setCoreStability(repos, dark.item.id, STABILITY_MATURE_MIN);

    const rows = await repos.dashboard.getVocabByLevel();
    const a2 = rows.find((r) => r.level === 'A2')!;
    expect(a2.encountered).toBe(2); // подвал + тёмный
    expect(a2.collected).toBe(1);
    expect(a2.mature).toBe(1);

    // Exactly at the young threshold → young, not learning.
    await setCoreStability(repos, dark.item.id, STABILITY_YOUNG_MIN);
    const rows2 = await repos.dashboard.getVocabByLevel();
    expect(rows2.find((r) => r.level === 'A2')!.young).toBe(1);
  });

  it('collected-but-unreviewed words count as collected with no band; manual adds count as encountered', async () => {
    const { repos } = await setup();
    // Nothing read; manual add of a word that is NOT in content, with a level.
    await repos.bank.addWord({
      lemma: 'призрак',
      surface: 'призрак',
      translation: 'ghost',
      level: 'B1',
    });
    const rows = await repos.dashboard.getVocabByLevel();
    const b1 = rows.find((r) => r.level === 'B1')!;
    expect(b1).toEqual({
      level: 'B1',
      encountered: 1,
      collected: 1,
      learning: 0,
      young: 0,
      mature: 0,
    });
  });

  it('bank-only lemma at a level shared with content lemmas merges into ONE row (alias-ambiguity regression)', async () => {
    const { repos } = await setup();
    await repos.reading.markFinished('a1-dash-test', 'st-1'); // A1 content lemmas encountered
    // Bank-only word (not in content) at the same level as content lemmas.
    await repos.bank.addWord({ lemma: 'сон', surface: 'сон', translation: 'dream', level: 'A1' });
    const rows = await repos.dashboard.getVocabByLevel();
    const a1Rows = rows.filter((r) => r.level === 'A1');
    expect(a1Rows).toHaveLength(1);
    expect(a1Rows[0]!.encountered).toBe(5); // в, стоять, кровать, вода + сон
    // and levels come back in CEFR order
    expect(rows.map((r) => r.level)).toEqual(['A1', 'A2', 'B1']);
  });
});

describe('dashboard repo — grammar coverage', () => {
  it('seen tracks read sentences; practiced tracks reviewed lemmas', async () => {
    const { repos } = await setup();
    await repos.reading.savePosition('a1-dash-test', 'st-1', 0); // sn-1 read

    const coverage0 = await repos.dashboard.getGrammarCoverage();
    const prepLoc = coverage0.find((t) => t.topic === 'prepositional-location')!;
    expect(prepLoc.level).toBe('A1');
    expect(prepLoc.sentenceCount).toBe(1);
    expect(prepLoc.readSentenceCount).toBe(1);
    expect(prepLoc.lemmasTotal).toBe(4);
    expect(prepLoc.lemmasReviewed).toBe(0);
    const adjAgr = coverage0.find((t) => t.topic === 'adjective-agreement')!;
    expect(adjAgr.readSentenceCount).toBe(0); // sn-2 not read

    // Review кровать → prepositional-location gains a reviewed lemma.
    const bed = await repos.bank.addWord({
      lemma: 'кровать',
      surface: 'кровать',
      translation: 'bed',
    });
    await setCoreStability(repos, bed.item.id, 1);
    const coverage1 = await repos.dashboard.getGrammarCoverage();
    expect(coverage1.find((t) => t.topic === 'prepositional-location')!.lemmasReviewed).toBe(1);
    expect(coverage1.find((t) => t.topic === 'verbs-of-position')!.lemmasReviewed).toBe(1);
    expect(coverage1.find((t) => t.topic === 'adjective-agreement')!.lemmasReviewed).toBe(0);
  });

  it('empty DB → empty coverage (no crash)', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    expect(await repos.dashboard.getGrammarCoverage()).toEqual([]);
  });
});

describe('dashboard repo — weakest lemmas + topic practice ids', () => {
  it('ranks by staleness-weighted stability, excludes mature, maps fields', async () => {
    const { repos } = await setup();
    const bed = await repos.bank.addWord({
      lemma: 'кровать',
      surface: 'кровать',
      translation: 'bed',
    });
    const stand = await repos.bank.addWord({
      lemma: 'стоять',
      surface: 'стоит',
      translation: 'to stand',
    });
    const dark = await repos.bank.addWord({
      lemma: 'тёмный',
      surface: 'тёмная',
      translation: 'dark',
    });
    await setCoreStability(repos, bed.item.id, 5);
    await setCoreStability(repos, stand.item.id, 1);
    await setCoreStability(repos, dark.item.id, STABILITY_MATURE_MIN + 5);

    const weak = await repos.dashboard.getWeakestLemmas();
    expect(weak.map((w) => w.lemma)).toEqual(['стоять', 'кровать']); // mature excluded
    expect(weak[0]!.minStability).toBe(1);
  });

  it('topic practice ids: only bank words whose lemma occurs in topic sentences', async () => {
    const { repos } = await setup();
    const bed = await repos.bank.addWord({
      lemma: 'кровать',
      surface: 'кровать',
      translation: 'bed',
    });
    await repos.bank.addWord({ lemma: 'тёмный', surface: 'тёмная', translation: 'dark' });
    const ids = await repos.dashboard.getTopicPracticeItemIds('A1', 'prepositional-location');
    expect(ids).toEqual([bed.item.id]); // тёмный is in adjective-agreement only
  });
});

describe('dashboard repo — activity, pronunciation trend, weak pronunciation', () => {
  it('totals + streak from daily_activity; recentDays zero-filled to 14', async () => {
    const { repos } = await setup();
    const now = new Date('2026-08-22T12:00:00');
    const day = (offset: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - offset);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    await repos.stats.bumpDailyActivity({ reviewsDone: 10, readingMs: 60_000 }, day(0));
    await repos.stats.bumpDailyActivity({ reviewsDone: 5, storiesFinished: 1 }, day(1));
    await repos.stats.bumpDailyActivity({ readingMs: 30_000 }, day(3)); // gap at day(2)

    const totals = await repos.dashboard.getActivityTotals(now);
    expect(totals.reviewsDone).toBe(15);
    expect(totals.readingMs).toBe(90_000);
    expect(totals.storiesFinished).toBe(1);
    expect(totals.activityStreak).toBe(2); // today + yesterday, gap breaks it
    expect(totals.recentDays).toHaveLength(14);
    expect(totals.recentDays[13]).toMatchObject({ reviewsDone: 10 });
    expect(totals.recentDays[11]).toMatchObject({ reviewsDone: 0, readingMs: 0 });
  });

  it('streak ending yesterday still counts (today not yet played)', async () => {
    const { repos } = await setup();
    const now = new Date('2026-08-22T09:00:00');
    await repos.stats.bumpDailyActivity({ reviewsDone: 1 }, '2026-08-21');
    await repos.stats.bumpDailyActivity({ reviewsDone: 1 }, '2026-08-20');
    expect((await repos.dashboard.getActivityTotals(now)).activityStreak).toBe(2);
  });

  it('pronunciation trend aggregates pron_item_graded analytics by day', async () => {
    const { repos } = await setup();
    await repos.stats.logEvent('pron_item_graded', {
      rating: 3,
      bestScore: 100,
      attempts: 1,
      source: 'word',
    });
    await repos.stats.logEvent('pron_item_graded', {
      rating: 2,
      bestScore: 60,
      attempts: 2,
      source: 'word',
    });
    await repos.stats.logEvent('tts_spoken', { chars: 5 }); // noise — must be ignored
    const trend = await repos.dashboard.getPronunciationTrend();
    expect(trend.overallAvg).toBe(80);
    expect(trend.days).toHaveLength(1);
    expect(trend.days[0]!.avgScore).toBe(80);
    expect(trend.days[0]!.attempts).toBe(2);
  });

  it('weak pronunciation merges recent per-item scores from game_sessions detail', async () => {
    const { repos } = await setup();
    const bed = await repos.bank.addWord({
      lemma: 'кровать',
      surface: 'кровать',
      translation: 'bed',
    });
    const cards = await repos.reviews.listCardsForItem(bed.item.id);
    const prod = cards.find((c) => c.direction === 'production')!;
    await repos.reviews.saveCard({ ...prod, reps: 1, stability: 2, state: 2 });

    const session = await repos.stats.startGameSession('pronunciation');
    await repos.stats.finishGameSession(session.id, {
      itemCount: 1,
      correctCount: 1,
      detail: { scores: [{ bankItemId: bed.item.id, score: 67 }] },
    });

    const weak = await repos.dashboard.getWeakestPronunciation();
    expect(weak).toHaveLength(1);
    expect(weak[0]!.bankItemId).toBe(bed.item.id);
    expect(weak[0]!.recentAvgScore).toBe(67);
  });

  it('empty DB → sane empty aggregates everywhere', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    expect((await repos.dashboard.getActivityTotals()).activityStreak).toBe(0);
    expect((await repos.dashboard.getPronunciationTrend()).overallAvg).toBeNull();
    expect(await repos.dashboard.getWeakestLemmas()).toEqual([]);
    expect(await repos.dashboard.getWeakestPronunciation()).toEqual([]);
  });
});
