import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories, type Repositories } from '@/db/repositories';
import type { SumrakDB } from '@/db/types';
import { foldForAnswer } from '@/lib/text';

import { resolveListeningAudio } from '../listening/audio-source';
import {
  buildListeningItemForCard,
  buildListeningSession,
  LISTENING_CHOICE_COUNT,
} from '../listening/session';
import { seedStory } from './seed';

/** T14 / T85: listening-quiz audio resolution (TTS of the banked surface) + session generation. */

/**
 * One story whose sentence s0 is «Вот словами здесь» with lemma «слово» on
 * token 1 — the banked word points at that sentence, so the post-answer
 * context can highlight surface «словами».
 */
async function setup(opts: { unread?: boolean } = {}) {
  const { unread = false } = opts;
  const db = createTestDb();
  const repos = createRepositories(db);
  await seedStory(db, {
    packId: 'p1',
    storyId: 'st1',
    sentences: [
      {
        id: 's0',
        ru: 'Вот словами здесь',
        en: 'Here with words',
        lemmas: ['вот', 'слово', 'здесь'],
      },
    ],
  });
  const { item } = await repos.bank.addWord({
    lemma: 'слово',
    surface: 'словами',
    translation: 'word',
    pos: 'noun',
    level: 'A1',
    sentenceId: 's0',
    sourceStoryId: 'st1',
  });
  if (!unread) await repos.reading.markFinished('p1', 'st1');
  return { db, repos, item };
}

async function addDistractors(repos: Repositories, n: number) {
  for (let i = 0; i < n; i++) {
    await repos.bank.addWord({
      lemma: `другое${i}`,
      surface: `другое${i}`,
      translation: `other-${i}`,
      pos: 'noun',
      level: 'A1',
    });
  }
}

describe('resolveListeningAudio (T85: TTS only)', () => {
  it('speaks the banked surface and highlights the context token for a read story', async () => {
    const { repos, item } = await setup();
    const audio = await resolveListeningAudio(repos, item);
    expect(audio).toMatchObject({ kind: 'tts', keySource: 'surface', text: 'словами' });
    expect(audio.context?.tokens.filter((t) => t.isTarget)).toHaveLength(1);
    expect(audio.context?.tokens.find((t) => t.isTarget)?.text).toBe('словами');
  });

  it('never carries story audio fields', async () => {
    const { repos, item } = await setup();
    const audio = await resolveListeningAudio(repos, item);
    expect(audio).not.toHaveProperty('uri');
    expect(audio).not.toHaveProperty('startMs');
    expect(audio).not.toHaveProperty('endMs');
  });

  it('respects the unseen-stories rule: unread source sentence → no context, unless the toggle allows it', async () => {
    const { repos, item } = await setup({ unread: true });
    // No progress row: the sentence would spoil an unopened story.
    expect(await resolveListeningAudio(repos, item)).toEqual({
      kind: 'tts',
      keySource: 'tts',
      text: 'словами',
      context: null,
    });
    const allowed = await resolveListeningAudio(repos, item, { unseenAllowed: true });
    expect(allowed).toMatchObject({ keySource: 'surface', text: 'словами' });
    expect(allowed.context).not.toBeNull();
  });

  it('item with no source sentence → no context, spoken text is the surface', async () => {
    const { repos } = await setup();
    const { item } = await repos.bank.addWord({
      lemma: 'дом',
      surface: 'дом',
      translation: 'house',
    });
    expect(await resolveListeningAudio(repos, item)).toEqual({
      kind: 'tts',
      keySource: 'tts',
      text: 'дом',
      context: null,
    });
  });

  it('phrases speak the phrase surface with no context', async () => {
    const { repos } = await setup();
    const { item } = await repos.bank.addPhrase({
      surface: 'вот словами',
      translation: 'here with words',
      sentenceId: 's0',
      sourceStoryId: 'st1',
    });
    expect(await resolveListeningAudio(repos, item)).toEqual({
      kind: 'tts',
      keySource: 'tts',
      text: 'вот словами',
      context: null,
    });
  });
});

describe('buildListeningItemForCard', () => {
  it('answer key is the spoken text; the surface form is the answer', async () => {
    const { repos, item } = await setup();
    await addDistractors(repos, 5);
    const card = (await repos.reviews.getCard(item.id, 'listening'))!;
    const entry = await buildListeningItemForCard(repos, card, item, 'pick4');
    expect(entry.answerRu).toBe('словами');
    expect(entry.variant).toBe('pick4');
    expect(entry.choices).toHaveLength(LISTENING_CHOICE_COUNT);
    expect(entry.choices!.some((c) => foldForAnswer(c) === foldForAnswer('словами'))).toBe(true);
    // Distinct options through the tolerant fold — nothing sounds identical.
    expect(new Set(entry.choices!.map(foldForAnswer)).size).toBe(LISTENING_CHOICE_COUNT);
  });

  it('degrades pick4 to typed when distractors run short', async () => {
    const { repos, item } = await setup();
    const card = (await repos.reviews.getCard(item.id, 'listening'))!;
    const entry = await buildListeningItemForCard(repos, card, item, 'pick4');
    expect(entry.variant).toBe('typed');
    expect(entry.choices).toBeUndefined();
  });

  it('keeps unenriched items playable with a blank translation', async () => {
    const { repos } = await setup();
    const { item } = await repos.bank.addWord({ lemma: 'тень', surface: 'тень', translation: '' });
    const card = (await repos.reviews.getCard(item.id, 'listening'))!;
    const entry = await buildListeningItemForCard(repos, card, item, 'typed');
    expect(entry.answerRu).toBe('тень');
    expect(entry.translation).toBeNull();
  });
});

describe('buildListeningSession', () => {
  it('serves due listening cards first, one exercise per bank item, alternating variants', async () => {
    const { repos } = await setup();
    await addDistractors(repos, 8);
    const session = await buildListeningSession(repos, { limit: 6 });
    expect(session.length).toBe(6);
    expect(new Set(session.map((e) => e.item.id)).size).toBe(6);
    for (const [i, entry] of session.entries()) {
      expect(entry.card.direction).toBe('listening');
      if (i % 2 === 0) expect(entry.variant).toBe('pick4');
    }
  });

  it('returns empty for an empty bank', async () => {
    const db = createTestDb() as SumrakDB;
    const repos = createRepositories(db);
    expect(await buildListeningSession(repos)).toEqual([]);
  });
});
