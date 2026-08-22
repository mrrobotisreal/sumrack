import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';

import { buildReadIndex, pickSentenceForLemma } from '../sentence-source';
import { seedStory } from './seed';

/** T13: the read-stories-only sourcing rule (acceptance criterion 3). */

async function setup() {
  const db = createTestDb();
  const repos = createRepositories(db);
  await seedStory(db, {
    packId: 'p1',
    storyId: 'read-story',
    sentences: [
      { id: 's1', ru: 'Я вижу дом', en: 'I see a house', lemmas: ['я', 'видеть', 'дом'] },
      {
        id: 's2',
        ru: 'Дом стоит тихо',
        en: 'The house stands quietly',
        lemmas: ['дом', 'стоять', 'тихо'],
      },
    ],
  });
  await seedStory(db, {
    packId: 'p1',
    storyId: 'unread-story',
    sentences: [
      {
        id: 's3',
        ru: 'Странный дом ждёт',
        en: 'A strange house waits',
        lemmas: ['странный', 'дом', 'ждать'],
      },
    ],
  });
  return { db, repos };
}

describe('pickSentenceForLemma', () => {
  it('never returns a sentence from a story with no reading progress (toggle off)', async () => {
    const { repos } = await setup();
    const index = await buildReadIndex(repos);
    expect(await pickSentenceForLemma(repos, 'дом', index)).toBeNull();
  });

  it('serves sentences from finished stories, resolving the target token', async () => {
    const { repos } = await setup();
    await repos.reading.markFinished('p1', 'read-story');
    const index = await buildReadIndex(repos);
    const picked = await pickSentenceForLemma(repos, 'дом', index);
    expect(picked).not.toBeNull();
    expect(['s1', 's2']).toContain(picked!.sentence.id);
    const target = picked!.tokens[picked!.targetIndex]!;
    expect(target.lemmaNorm).toBe('дом');
    expect(picked!.storyLevel).toBe('A1');
  });

  it('in-progress stories: only sentences at or above the reading position', async () => {
    const { repos } = await setup();
    await repos.reading.savePosition('p1', 'read-story', 0);
    const index = await buildReadIndex(repos);
    // 'тихо' only occurs in s2 (orderIdx 1) — beyond position 0, so unread.
    expect(await pickSentenceForLemma(repos, 'тихо', index)).toBeNull();
    // 'я' occurs in s1 (orderIdx 0) — seen.
    const picked = await pickSentenceForLemma(repos, 'я', index);
    expect(picked?.sentence.id).toBe('s1');
  });

  it('the unseenAllowed toggle opens unread stories', async () => {
    const { repos } = await setup();
    const index = await buildReadIndex(repos);
    const picked = await pickSentenceForLemma(repos, 'странный', index, { unseenAllowed: true });
    expect(picked?.sentence.id).toBe('s3');
  });

  it('matches lemmas ё/е-tolerantly', async () => {
    const { db, repos } = await setup();
    await seedStory(db, {
      packId: 'p2',
      storyId: 'yo-story',
      sentences: [{ id: 's4', ru: 'Ещё темно', en: 'Still dark', lemmas: ['ещё', 'тёмный'] }],
    });
    await repos.reading.markFinished('p2', 'yo-story');
    const index = await buildReadIndex(repos);
    const picked = await pickSentenceForLemma(repos, 'еще', index);
    expect(picked?.sentence.id).toBe('s4');
    expect(picked?.tokens[picked.targetIndex]?.text).toBe('Ещё');
  });

  it('respects maxWords', async () => {
    const { repos } = await setup();
    await repos.reading.markFinished('p1', 'read-story');
    const index = await buildReadIndex(repos);
    expect(await pickSentenceForLemma(repos, 'дом', index, { maxWords: 2 })).toBeNull();
    expect(await pickSentenceForLemma(repos, 'дом', index, { maxWords: 3 })).not.toBeNull();
  });
});
