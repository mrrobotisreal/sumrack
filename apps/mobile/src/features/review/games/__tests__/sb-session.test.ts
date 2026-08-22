import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';

import {
  arrangementCorrect,
  buildSbSession,
  SB_DISTRACTOR_COUNT,
} from '../sentence-builder/session';
import { seedStory } from './seed';

/** T13: sentence-builder session generation + arrangement validation. */

describe('arrangementCorrect', () => {
  it('accepts the canonical order, tolerant of case and ё/е per tile', () => {
    const answer = ['Ещё', 'темно', 'здесь'];
    expect(arrangementCorrect(['ещё', 'темно', 'здесь'], answer)).toBe(true);
    expect(arrangementCorrect(['еще', 'темно', 'здесь'], answer)).toBe(true);
  });

  it('rejects wrong order, wrong words, and wrong length', () => {
    const answer = ['я', 'вижу', 'дом'];
    expect(arrangementCorrect(['вижу', 'я', 'дом'], answer)).toBe(false);
    expect(arrangementCorrect(['я', 'вижу', 'том'], answer)).toBe(false);
    expect(arrangementCorrect(['я', 'вижу'], answer)).toBe(false);
  });

  it('treats duplicate words as interchangeable tiles', () => {
    const answer = ['тук', 'тук', 'в', 'стене'];
    expect(arrangementCorrect(['тук', 'тук', 'в', 'стене'], answer)).toBe(true);
  });
});

describe('buildSbSession', () => {
  it('A1 stories get no distractor tiles; word tokens all present, punctuation excluded', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedStory(db, {
      packId: 'p1',
      storyId: 'st1',
      level: 'A1',
      sentences: [
        {
          id: 's0',
          ru: 'Кто-то стучит в стену',
          en: 'Someone knocks on the wall',
          lemmas: ['кто-то', 'стучать', 'в', 'стена'],
          punct: '.',
        },
      ],
    });
    await repos.reading.markFinished('p1', 'st1');
    await repos.bank.addWord({ lemma: 'стена', surface: 'стену', translation: 'wall' });

    const session = await buildSbSession(repos);
    expect(session).toHaveLength(1);
    const item = session[0]!;
    expect(item.answerTokens.map((t) => t.text)).toEqual(['Кто-то', 'стучит', 'в', 'стену']);
    expect(item.tiles).toHaveLength(4); // no distractors at A1, no punctuation tile
    expect(item.tiles.every((t) => !t.distractor)).toBe(true);
    const tileTexts = item.tiles.map((t) => t.text).sort();
    expect(tileTexts).toEqual(['в', 'кто-то', 'стену', 'стучит'].sort());
  });

  it('higher-level stories add level-scaled distractor tiles that never collide with the sentence', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedStory(db, {
      packId: 'p1',
      storyId: 'st1',
      level: 'C1',
      sentences: [
        {
          id: 's0',
          ru: 'Зеркало помнит всё',
          en: 'The mirror remembers everything',
          lemmas: ['зеркало', 'помнить', 'всё'],
        },
      ],
    });
    await repos.reading.markFinished('p1', 'st1');
    await repos.bank.addWord({
      lemma: 'зеркало',
      surface: 'зеркало',
      translation: 'mirror',
      pos: 'noun',
      level: 'C1',
    });
    // distractor pool
    for (let i = 0; i < 8; i++) {
      await repos.bank.addWord({
        lemma: `сосед${i}`,
        surface: `сосед${i}`,
        translation: `neighbor-${i}`,
        pos: 'noun',
        level: 'C1',
      });
    }

    const session = await buildSbSession(repos, { limit: 1 });
    expect(session).toHaveLength(1);
    const item = session[0]!;
    const distractors = item.tiles.filter((t) => t.distractor);
    expect(distractors).toHaveLength(SB_DISTRACTOR_COUNT.C1);
    const sentenceWords = new Set(item.answerTokens.map((t) => t.text.toLocaleLowerCase('ru-RU')));
    for (const d of distractors) expect(sentenceWords.has(d.text)).toBe(false);
  });

  it('skips sentences that are too long or single-word, and unread stories', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const longWords = Array.from({ length: 11 }, (_, i) => `слово${i}`);
    await seedStory(db, {
      packId: 'p1',
      storyId: 'long',
      sentences: [
        { id: 's0', ru: longWords.join(' '), en: 'long', lemmas: longWords },
        { id: 's1', ru: 'тишина', en: 'silence', lemmas: ['тишина'] },
      ],
    });
    await seedStory(db, {
      packId: 'p1',
      storyId: 'unread',
      sentences: [
        { id: 's2', ru: 'Он ждёт тебя', en: 'He waits for you', lemmas: ['он', 'ждать', 'ты'] },
      ],
    });
    await repos.reading.markFinished('p1', 'long');
    await repos.bank.addWord({ lemma: 'слово0', surface: 'слово0', translation: 'w' });
    await repos.bank.addWord({ lemma: 'тишина', surface: 'тишина', translation: 'silence' });
    await repos.bank.addWord({ lemma: 'ждать', surface: 'ждёт', translation: 'waits' });

    expect(await buildSbSession(repos)).toHaveLength(0);
  });
});
