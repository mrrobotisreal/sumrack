import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';

import { importPack } from '../importer';
import { createRepositories } from '../repositories';
import { createTestDb } from './helpers';

/**
 * T17: the path repository — derived unit vocabulary credit (the
 * out-of-order rule at the SQL level) and the non-derivable unit facts.
 */

/** A minimal valid course-unit pack: 1 story, 2 sentences, 4 distinct lemmas. */
const unitPack = {
  id: 'a1-unit-test',
  version: 1,
  type: 'course-unit',
  title: { ru: 'Тест', en: 'Test' },
  level: 'A1',
  tags: ['course-unit'],
  lesson: {
    id: 'unit-lesson',
    title: { ru: 'Урок', en: 'Lesson' },
    body: '## Урок\n\nГде? — в + prepositional.',
  },
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
          tokens: [
            { text: 'В', lemma: 'в', translation: 'in', pos: 'prep' },
            { text: 'подвале', lemma: 'подвал', translation: 'cellar', pos: 'noun' },
            { text: 'стоит', lemma: 'стоять', translation: 'stands', pos: 'verb' },
            { text: 'кровать', lemma: 'кровать', translation: 'bed', pos: 'noun' },
            { text: '.', isPunct: true },
          ],
        },
        {
          id: 'sn-2',
          ru: 'Кровать стоит тихо.',
          en: 'The bed stands quietly.',
          tokens: [
            { text: 'Кровать', lemma: 'кровать', translation: 'bed', pos: 'noun' },
            { text: 'стоит', lemma: 'стоять', translation: 'stands', pos: 'verb' },
            { text: 'тихо', lemma: 'тихо', translation: 'quietly', pos: 'adv' },
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
  await importPack(db, unitPack, { source: 'local-file' });
  return { db, repos };
}

describe('path repo — unit lemma stats (out-of-order credit)', () => {
  it('counts distinct unit lemmas; bank + reviews credit regardless of entry point', async () => {
    const { repos } = await setup();
    // 5 distinct lemmas: в, подвал, стоять, кровать, тихо.
    expect(await repos.path.getUnitLemmaStats('a1-unit-test')).toEqual({
      totalLemmas: 5,
      collected: 0,
      reviewed: 0,
    });

    // Bank two words "from the Library" (path never involved). ё/е-fold:
    // the е-spelled surface still matches the unit's lemma_norm shadow.
    const bed = await repos.bank.addWord({
      lemma: 'кровать',
      surface: 'кровать',
      translation: 'bed',
      sentenceId: 'sn-1',
      sourceStoryId: 'st-1',
    });
    await repos.bank.addWord({
      lemma: 'тихо',
      surface: 'тихо',
      translation: 'quietly',
      sentenceId: 'sn-2',
      sourceStoryId: 'st-1',
    });
    const afterBank = await repos.path.getUnitLemmaStats('a1-unit-test');
    expect(afterBank.collected).toBe(2);
    expect(afterBank.reviewed).toBe(0);

    // Review one of them via the ordinary review pipeline (T06).
    const cards = await repos.reviews.listCardsForItem(bed.item.id);
    await repos.reviews.gradeCard(cards[0]!.id, Rating.Good);
    const afterReview = await repos.path.getUnitLemmaStats('a1-unit-test');
    expect(afterReview.reviewed).toBe(1);
  });

  it('ignores lemmas that are not part of the unit', async () => {
    const { repos } = await setup();
    await repos.bank.addWord({ lemma: 'зеркало', surface: 'зеркало', translation: 'mirror' });
    const stats = await repos.path.getUnitLemmaStats('a1-unit-test');
    expect(stats.collected).toBe(0);
  });
});

describe('path repo — unit facts', () => {
  it('markLessonRead is idempotent and keeps the first timestamp', async () => {
    const { repos } = await setup();
    expect(await repos.path.markLessonRead('a1-unit-test')).toBe(true);
    const first = (await repos.path.getUnitProgress('a1-unit-test'))!.lessonReadAt;
    expect(await repos.path.markLessonRead('a1-unit-test')).toBe(false);
    expect((await repos.path.getUnitProgress('a1-unit-test'))!.lessonReadAt).toBe(first);
  });

  it('recordQuizResult keeps the best score and the first pass', async () => {
    const { repos } = await setup();
    await repos.path.recordQuizResult('a1-unit-test', 60, false);
    let row = (await repos.path.getUnitProgress('a1-unit-test'))!;
    expect(row.quizBestScorePercent).toBe(60);
    expect(row.quizPassedAt).toBeNull();

    await repos.path.recordQuizResult('a1-unit-test', 90, true);
    row = (await repos.path.getUnitProgress('a1-unit-test'))!;
    expect(row.quizBestScorePercent).toBe(90);
    const passedAt = row.quizPassedAt;
    expect(passedAt).not.toBeNull();

    // A later, worse, failing run demotes nothing.
    await repos.path.recordQuizResult('a1-unit-test', 40, false);
    row = (await repos.path.getUnitProgress('a1-unit-test'))!;
    expect(row.quizBestScorePercent).toBe(90);
    expect(row.quizPassedAt).toBe(passedAt);
  });

  it('markUnitCompleted stamps exactly once', async () => {
    const { repos } = await setup();
    expect(await repos.path.markUnitCompleted('a1-unit-test')).toBe(true);
    expect(await repos.path.markUnitCompleted('a1-unit-test')).toBe(false);
  });

  it('listPathPacks returns only course-unit/checkpoint packs in level order', async () => {
    const { db, repos } = await setup();
    await importPack(db, {
      id: 'a1-checkpoint-test',
      version: 1,
      type: 'checkpoint',
      title: { ru: 'КП', en: 'CP' },
      level: 'A1',
      tags: [],
      stories: [],
      exercises: [
        {
          id: 'e1',
          kind: 'multiple-choice',
          direction: 'ru-en',
          prompt: 'дом',
          choices: ['house', 'wall'],
          correctIndex: 0,
        },
      ],
    });
    const packs = await repos.path.listPathPacks();
    expect(packs.map((p) => p.id)).toEqual(['a1-checkpoint-test', 'a1-unit-test']);
    expect(packs.every((p) => p.type !== 'stories')).toBe(true);
  });
});
