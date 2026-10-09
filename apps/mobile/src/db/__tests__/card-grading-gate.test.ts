import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createTestDb } from './helpers';
import { createRepositories } from '../repositories';
import { Rating } from '../repositories/reviews';

/** T39: a suspended card is never rated. The two spoken-grading sites resolve via getGradableCard. */

const here = path.dirname(fileURLToPath(import.meta.url));
const appSrc = (rel: string) => readFileSync(path.join(here, '..', '..', rel), 'utf8');

describe('suspended cards are never graded', () => {
  it('getGradableCard is null for a suspended card, so the grading sites record nothing', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const { item } = await repos.bank.addWord({
      lemma: 'вопрос',
      surface: 'вопрос',
      translation: 'question',
    });
    const prod = (await repos.reviews.getCard(item.id, 'production'))!;
    await repos.reviews.suspendCard(prod.id);

    expect(await repos.reviews.getGradableCard(item.id, 'production')).toBeNull();
    // mirror of the grading-site guard: nothing is graded, no review_log row appears
    const card = await repos.reviews.getGradableCard(item.id, 'production');
    if (card) await repos.reviews.gradeCard(card.id, Rating.Good);
    expect(await repos.reviews.listReviewLog(prod.id)).toHaveLength(0);
  });

  it('getGradableCard is non-null for a buried (not suspended) card', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const { item } = await repos.bank.addWord({
      lemma: 'ответ',
      surface: 'ответ',
      translation: 'answer',
    });
    const prod = (await repos.reviews.getCard(item.id, 'production'))!;
    await repos.reviews.buryUntilTomorrow(prod.id);
    expect(await repos.reviews.getGradableCard(item.id, 'production')).not.toBeNull();
  });

  it('both spoken-grading call sites resolve the card through getGradableCard', () => {
    for (const rel of [
      'features/dialogue/grade-spoken-choice.ts',
      'features/scenario/grade-spoken-turn.ts',
    ]) {
      const src = appSrc(rel);
      expect(src).toContain("repos.reviews.getGradableCard(item.id, 'production')");
      expect(src).not.toContain("repos.reviews.getCard(item.id, 'production')");
    }
  });
});
