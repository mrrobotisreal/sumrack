import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createRepositories } from '../repositories';
import { createBankRepo } from '../repositories/bank';
import { createTestDb } from './helpers';

/** T05: the Словарь browse surface — encounter counts and filter options. */
describe('bank repository — browse (T05)', () => {
  async function seed(bank = createBankRepo(createTestDb())) {
    await bank.addWord({
      lemma: 'чёрный',
      surface: 'чёрный',
      translation: 'black',
      pos: 'adj',
      level: 'A1',
      sentenceId: 's-1',
      sourceStoryId: 'story-a',
    });
    // Second encounter for the same lemma, е-spelled.
    await bank.addWord({
      lemma: 'черный',
      surface: 'черная',
      translation: 'black',
      sentenceId: 's-2',
      sourceStoryId: 'story-a',
    });
    await bank.addWord({
      lemma: 'стена',
      surface: 'стене',
      translation: 'wall',
      pos: 'noun',
      level: 'A2',
      sentenceId: 's-3',
      sourceStoryId: 'story-b',
    });
    await bank.addPhrase({ surface: 'всё в порядке', translation: 'all good' });
    return bank;
  }

  it('listItems carries an encounter count per item', async () => {
    const bank = await seed();
    const items = await bank.listItems();
    const black = items.find((i) => i.lemma === 'чёрный');
    const wall = items.find((i) => i.lemma === 'стена');
    expect(black?.encounterCount).toBe(2);
    expect(wall?.encounterCount).toBe(1);
  });

  it('search finds the same item from both ё and е spellings', async () => {
    const bank = await seed();
    const withYo = await bank.listItems({ search: 'чёрн' });
    const withoutYo = await bank.listItems({ search: 'черн' });
    expect(withYo).toHaveLength(1);
    expect(withoutYo).toHaveLength(1);
    expect(withYo[0]!.id).toBe(withoutYo[0]!.id);
  });

  it('filters compose: kind, level, pos, source story', async () => {
    const bank = await seed();
    expect(await bank.listItems({ kind: 'phrase' })).toHaveLength(1);
    expect((await bank.listItems({ level: 'A2' }))[0]!.lemma).toBe('стена');
    expect((await bank.listItems({ pos: 'adj' }))[0]!.lemma).toBe('чёрный');
    expect(await bank.listItems({ sourceStoryId: 'story-a' })).toHaveLength(1);
    expect(await bank.listItems({ kind: 'word', level: 'A1', pos: 'noun' })).toHaveLength(0);
  });

  it('getFilterOptions returns only values present, levels in CEFR order', async () => {
    const bank = await seed();
    const opts = await bank.getFilterOptions();
    expect(opts.pos).toEqual(['adj', 'noun']);
    expect(opts.levels).toEqual(['A1', 'A2']);
    expect(opts.sourceStoryIds.sort()).toEqual(['story-a', 'story-b']);
  });

  it('manual add (no source) yields an encounter with no sentence/journal ref', async () => {
    const bank = createBankRepo(createTestDb());
    const result = await bank.addWord({ lemma: 'привет', surface: 'привет', translation: 'hi' });
    expect(result.encounter.sentenceId).toBeNull();
    expect(result.encounter.journalEntryId).toBeNull();
    const items = await bank.listItems();
    expect(items[0]!.sourceStoryId).toBeNull();
  });
});

/**
 * T50: Словарь sorting + familiarity (WORD_FORMS §3.2). Grades are written
 * through the real gradeCard so `review_log.source` and card directions are
 * exactly what the device produces.
 */
describe('bank repository — sorting + familiarity (T50)', () => {
  type Src = 'flashcard' | 'mc' | 'cloze' | undefined;

  async function setup() {
    const db = createTestDb();
    const repos = createRepositories(db);
    let clock = 1_000_000;
    const tick = () => (clock += 1000);
    /** addWord at a strictly increasing created_at (ids stay unique). */
    const add = async (lemma: string, translation = lemma) => {
      const { item } = await repos.bank.addWord({ lemma, surface: lemma, translation });
      // created_at is Date.now() inside the repo; pin it so order-added is deterministic.
      await db.run(sql`UPDATE bank_items SET created_at = ${tick()} WHERE id = ${item.id}`);
      return item;
    };
    const grade = async (
      itemId: string,
      direction: 'ru-en' | 'en-ru' | 'listening' | 'production',
      rating: 1 | 2 | 3 | 4,
      source: Src,
    ) => {
      const card = (await repos.reviews.getCard(itemId, direction))!;
      await repos.reviews.gradeCard(card.id, rating, { now: tick(), source });
    };
    const list = (sort?: Parameters<typeof repos.bank.listItems>[1], filter = {}) =>
      repos.bank.listItems(filter, sort);
    return { repos, add, grade, list };
  }

  it('(a) MC-only grades do not count as practice', async () => {
    const { add, grade, list } = await setup();
    const a = await add('окно');
    await grade(a.id, 'ru-en', 3, 'mc');
    await grade(a.id, 'en-ru', 4, 'mc');
    const [row] = await list();
    expect(row!.practiceCount).toBe(0);
    expect(row!.familiarity).toBeNull();
    expect(row!.latestRating).toBeNull();
  });

  it('(b) NULL-source legacy rows count best-effort', async () => {
    const { add, grade, list } = await setup();
    const a = await add('стол');
    await grade(a.id, 'ru-en', 3, undefined);
    await grade(a.id, 'ru-en', 1, undefined);
    const [row] = await list();
    expect(row!.practiceCount).toBe(2);
    expect(row!.latestRating).toBe(1);
    // (2/3 + 0) / 2
    expect(row!.familiarity).toBeCloseTo(1 / 3, 6);
  });

  it('(c) listening/production cards never count, even as flashcards', async () => {
    const { repos, add, grade, list } = await setup();
    const a = await add('рука');
    // Listening/production cards are not active by default — create them explicitly.
    await repos.reviews.ensureCards(a.id, ['listening', 'production']);
    await grade(a.id, 'listening', 4, 'flashcard');
    await grade(a.id, 'production', 4, undefined);
    const [row] = await list();
    expect(row!.practiceCount).toBe(0);
    expect(row!.familiarity).toBeNull();
  });

  it('(d) familiarity averages only the last 10 qualifying grades', async () => {
    const { add, grade, list } = await setup();
    const a = await add('нога');
    // Oldest grade is Again (0); the ten that follow are all Easy (1).
    await grade(a.id, 'ru-en', 1, 'flashcard');
    for (let i = 0; i < 10; i++) await grade(a.id, i % 2 ? 'ru-en' : 'en-ru', 4, 'flashcard');
    const [row] = await list();
    expect(row!.practiceCount).toBe(11);
    expect(row!.familiarity).toBe(1);
    expect(row!.latestRating).toBe(4);
  });

  it('(e) every ORDER BY variant on a fixed fixture', async () => {
    const { add, grade, list } = await setup();
    // Added in this order: в, а, б, г — alphabetical order differs from added order.
    const v = await add('волк', 'wolf'); // practiced: Again, Again → 0
    await add('арбуз', 'melon'); // unpracticed
    const b = await add('берег', 'shore'); // practiced: Good, Easy → 5/6
    const g = await add('город', 'city'); // practiced: Hard → 1/3 (one grade)
    const e = await add('ель', 'spruce'); // unpracticed, MC-only
    await grade(v.id, 'ru-en', 1, 'flashcard');
    await grade(v.id, 'en-ru', 1, 'flashcard');
    await grade(b.id, 'ru-en', 3, 'flashcard');
    await grade(b.id, 'en-ru', 4, 'flashcard');
    await grade(g.id, 'ru-en', 2, 'flashcard');
    await grade(e.id, 'ru-en', 4, 'mc');

    const lemmas = async (sort: Parameters<typeof list>[0]) =>
      (await list(sort)).map((r) => r.lemma);

    expect(await lemmas(undefined)).toEqual(['волк', 'арбуз', 'берег', 'город', 'ель']);
    expect(await lemmas({ key: 'added-asc', familiarity: 'least' })).toEqual([
      'волк',
      'арбуз',
      'берег',
      'город',
      'ель',
    ]);
    expect(await lemmas({ key: 'added-desc', familiarity: 'least' })).toEqual([
      'ель',
      'город',
      'берег',
      'арбуз',
      'волк',
    ]);
    expect(await lemmas({ key: 'alpha-asc', familiarity: 'least' })).toEqual([
      'арбуз',
      'берег',
      'волк',
      'город',
      'ель',
    ]);
    expect(await lemmas({ key: 'alpha-desc', familiarity: 'least' })).toEqual([
      'ель',
      'город',
      'волк',
      'берег',
      'арбуз',
    ]);
    // unpracticed (added-asc) … then practiced least-familiar first (fixed).
    expect(await lemmas({ key: 'unpracticed-first', familiarity: 'least' })).toEqual([
      'арбуз',
      'ель',
      'волк',
      'город',
      'берег',
    ]);
    // The sub-sort is ignored for unpracticed-first.
    expect(await lemmas({ key: 'unpracticed-first', familiarity: 'most' })).toEqual([
      'арбуз',
      'ель',
      'волк',
      'город',
      'берег',
    ]);
    expect(await lemmas({ key: 'practiced-first', familiarity: 'least' })).toEqual([
      'волк',
      'город',
      'берег',
      'арбуз',
      'ель',
    ]);
    expect(await lemmas({ key: 'practiced-first', familiarity: 'most' })).toEqual([
      'берег',
      'город',
      'волк',
      'арбуз',
      'ель',
    ]);

    // The columns ride along on every row.
    const rows = await list({ key: 'practiced-first', familiarity: 'least' });
    const byLemma = Object.fromEntries(rows.map((r) => [r.lemma, r]));
    expect(byLemma['волк']).toMatchObject({ practiceCount: 2, familiarity: 0, latestRating: 1 });
    expect(byLemma['берег']!.familiarity).toBeCloseTo(5 / 6, 6);
    expect(byLemma['берег']).toMatchObject({ practiceCount: 2, latestRating: 4 });
    expect(byLemma['город']!.familiarity).toBeCloseTo(1 / 3, 6);
    expect(byLemma['арбуз']).toMatchObject({ practiceCount: 0, familiarity: null });
    expect(byLemma['ель']).toMatchObject({ practiceCount: 0, familiarity: null });

    // Sort applies under search + paging too.
    const searched = await list({ key: 'alpha-desc', familiarity: 'least' }, { search: 'р' });
    expect(searched.map((r) => r.lemma)).toEqual(['город', 'берег', 'арбуз']);
    const page2 = await list({ key: 'alpha-asc', familiarity: 'least' }, { limit: 2, offset: 2 });
    expect(page2.map((r) => r.lemma)).toEqual(['волк', 'город']);
  });

  it('(f) ё sorts with е: «ёж» sits between «еда» and «ель» in А→Я', async () => {
    const { add, list } = await setup();
    await add('ель');
    await add('ёж');
    await add('еда');
    await add('жук');
    const asc = (await list({ key: 'alpha-asc', familiarity: 'least' })).map((r) => r.lemma);
    expect(asc).toEqual(['еда', 'ёж', 'ель', 'жук']);
    const desc = (await list({ key: 'alpha-desc', familiarity: 'least' })).map((r) => r.lemma);
    expect(desc).toEqual(['жук', 'ель', 'ёж', 'еда']);
  });
});
