import { describe, expect, it } from 'vitest';

import type { AudioTrackRow, SentenceWithTokens, WordStampRow } from '@/db/repositories/content';

import { buildExamAudio, pickTrack } from '../items/exam-audio';

const sentence = (id: string, ru: string): SentenceWithTokens =>
  ({
    packId: 'p',
    id,
    storyId: 's',
    orderIdx: 0,
    ru,
    en: '',
    grammarTopics: null,
    tokens: [],
  }) as SentenceWithTokens;
const SENTENCES = [sentence('a', 'Привет!'), sentence('b', 'Где ты?'), sentence('c', 'Я дома.')];
const track = (id: string, localUri: string | null): AudioTrackRow =>
  ({
    packId: 'p',
    storyId: 's',
    id,
    voice: 'v',
    style: 'x',
    file: `${id}.opus`,
    localUri,
    durationMs: 9000,
  }) as AudioTrackRow;
const stamp = (sentenceId: string, i: number, startMs: number, endMs: number): WordStampRow =>
  ({
    packId: 'p',
    storyId: 's',
    trackId: 't1',
    stampIndex: i,
    sentenceId,
    tokenIndex: 0,
    startMs,
    endMs,
  }) as WordStampRow;
const STAMPS = [stamp('a', 0, 200, 900), stamp('b', 1, 1500, 2200), stamp('c', 2, 3000, 3800)];

describe('buildExamAudio', () => {
  it('a downloaded track → a segment over the ref span (stamps − 150 / + 250) with the covered stamps only', () => {
    const a = buildExamAudio({
      ref: { sentenceIds: ['b', 'c'] },
      sentences: SENTENCES,
      tracks: [track('t1', 'file:///t1.opus')],
      stamps: STAMPS,
      fileExists: () => true,
    });
    expect(a.synthetic).toBe(false);
    expect(a.source).toEqual({
      kind: 'segment',
      uri: 'file:///t1.opus',
      startMs: 1350,
      endMs: 4050,
    });
    expect(a.transcript.map((s) => s.id)).toEqual(['b', 'c']);
    expect(a.stamps.map((s) => s.sentenceId)).toEqual(['b', 'c']);
    expect(a.spanMs).toBe(2700);
  });
  it('no sentenceIds → the whole track, whole transcript', () => {
    const a = buildExamAudio({
      ref: {},
      sentences: SENTENCES,
      tracks: [track('t1', 'file:///t1.opus')],
      stamps: STAMPS,
      fileExists: () => true,
    });
    expect(a.source).toMatchObject({ kind: 'segment', startMs: 0, endMs: 9000 });
    expect(a.transcript).toHaveLength(3);
  });
  it('file missing on disk (deleted / Wi-Fi gate) → TTS of the span text, flagged synthetic', () => {
    const a = buildExamAudio({
      ref: { sentenceIds: ['a', 'b'] },
      sentences: SENTENCES,
      tracks: [track('t1', 'file:///gone.opus')],
      stamps: STAMPS,
      fileExists: () => false,
    });
    expect(a).toMatchObject({
      synthetic: true,
      source: { kind: 'tts', text: 'Привет! Где ты?' },
      stamps: [],
    });
  });
  it('no track / localUri null → TTS', () => {
    for (const tracks of [[], [track('t1', null)]]) {
      const a = buildExamAudio({
        ref: {},
        sentences: SENTENCES,
        tracks,
        stamps: [],
        fileExists: () => true,
      });
      expect(a.synthetic).toBe(true);
    }
  });
  it('a stampless track still plays (whole track); a named track wins; an unknown trackId → TTS', () => {
    const tracks = [track('t1', 'file:///t1.opus'), track('t2', 'file:///t2.opus')];
    expect(
      buildExamAudio({
        ref: { sentenceIds: ['a'] },
        sentences: SENTENCES,
        tracks,
        stamps: [],
        fileExists: () => true,
      }).source,
    ).toMatchObject({ kind: 'segment', startMs: 0, endMs: 9000 });
    expect(pickTrack(tracks, { trackId: 't2' })?.id).toBe('t2');
    expect(pickTrack(tracks, {})?.id).toBe('t1');
    expect(
      buildExamAudio({
        ref: { trackId: 'nope' },
        sentences: SENTENCES,
        tracks,
        stamps: [],
        fileExists: () => true,
      }).synthetic,
    ).toBe(true);
  });
});
