import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories, type Repositories } from '@/db/repositories';
import { audioTracks, wordStamps } from '@/db/schema';
import type { SumrakDB } from '@/db/types';
import { foldForAnswer } from '@/lib/text';

import { resolveListeningAudio } from '../listening/audio-source';
import {
  buildListeningItemForCard,
  buildListeningSession,
  LISTENING_CHOICE_COUNT,
} from '../listening/session';
import { seedStory } from './seed';

/** T14: listening-quiz audio-source selection + session generation. */

/**
 * One story whose sentence s0 is «Вот словами здесь» with lemma «слово» on
 * token 1 — the banked word points at that sentence, so the segment path
 * can resolve surface «словами» when a downloaded track stamps it.
 */
async function setup(
  opts: { withTrack?: boolean; withStamp?: boolean; downloaded?: boolean } = {},
) {
  const { withTrack = false, withStamp = false, downloaded = true } = opts;
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
  if (withTrack) {
    await db.insert(audioTracks).values({
      packId: 'p1',
      storyId: 'st1',
      id: 'tr1',
      voice: 'elevenlabs:Test',
      style: 'neutral',
      file: 'audio/st1.opus',
      localUri: downloaded ? 'file:///packs/p1/audio/st1.opus' : null,
      durationMs: 5000,
    });
    if (withStamp) {
      await db.insert(wordStamps).values({
        packId: 'p1',
        storyId: 'st1',
        trackId: 'tr1',
        stampIndex: 0,
        sentenceId: 's0',
        tokenIndex: 1,
        startMs: 700,
        endMs: 1400,
      });
    }
  }
  const { item } = await repos.bank.addWord({
    lemma: 'слово',
    surface: 'словами',
    translation: 'word',
    pos: 'noun',
    level: 'A1',
    sentenceId: 's0',
    sourceStoryId: 'st1',
  });
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

describe('resolveListeningAudio', () => {
  it('picks the pack segment when a downloaded track stamps the lemma token in a read story', async () => {
    const { repos, item } = await setup({ withTrack: true, withStamp: true });
    await repos.reading.markFinished('p1', 'st1');
    const audio = await resolveListeningAudio(repos, item);
    expect(audio).toEqual({
      kind: 'segment',
      uri: 'file:///packs/p1/audio/st1.opus',
      startMs: 700,
      endMs: 1400,
      spokenText: 'словами',
    });
  });

  it('respects the unseen-stories rule: unread source sentence → TTS unless the toggle allows it', async () => {
    const { repos, item } = await setup({ withTrack: true, withStamp: true });
    // No progress row: the sentence would spoil an unopened story.
    expect(await resolveListeningAudio(repos, item)).toEqual({ kind: 'tts', text: 'слово' });
    const allowed = await resolveListeningAudio(repos, item, { unseenAllowed: true });
    expect(allowed.kind).toBe('segment');
  });

  it('falls back to TTS of the lemma when the track has no stamp for the token', async () => {
    const { repos, item } = await setup({ withTrack: true, withStamp: false });
    await repos.reading.markFinished('p1', 'st1');
    expect(await resolveListeningAudio(repos, item)).toEqual({ kind: 'tts', text: 'слово' });
  });

  it('falls back to TTS when the track audio is not downloaded', async () => {
    const { repos, item } = await setup({ withTrack: true, withStamp: true, downloaded: false });
    await repos.reading.markFinished('p1', 'st1');
    expect(await resolveListeningAudio(repos, item)).toEqual({ kind: 'tts', text: 'слово' });
  });

  it('falls back to TTS when the item has no source sentence', async () => {
    const { repos } = await setup();
    const { item } = await repos.bank.addWord({
      lemma: 'дом',
      surface: 'дом',
      translation: 'house',
    });
    expect(await resolveListeningAudio(repos, item)).toEqual({ kind: 'tts', text: 'дом' });
  });

  it('phrases always go to TTS of the phrase surface', async () => {
    const { repos } = await setup({ withTrack: true, withStamp: true });
    const { item } = await repos.bank.addPhrase({
      surface: 'вот словами',
      translation: 'here with words',
      sentenceId: 's0',
      sourceStoryId: 'st1',
    });
    expect(await resolveListeningAudio(repos, item)).toEqual({
      kind: 'tts',
      text: 'вот словами',
    });
  });
});

describe('buildListeningItemForCard', () => {
  it('answer key is the spoken text; segment case answers the surface form', async () => {
    const { repos, item } = await setup({ withTrack: true, withStamp: true });
    await repos.reading.markFinished('p1', 'st1');
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
