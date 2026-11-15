import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ useFocusEffect: () => undefined }));

import { currentScoreSource, listenScoreSource, readerScoreSource } from '../score-source';

/** T115: which narration owns which score, and on what clock. */

const score = { trackId: 't1', localUri: 'file:///s1', durationMs: 60_000 };

describe('readerScoreSource', () => {
  const base = {
    packId: 'p',
    storyId: 'part-1',
    score,
    currentTrackId: 't1',
    playing: true,
    rate: 1.1,
    seekRevision: 3,
    positionMs: () => 4_200,
  };

  it('publishes the part score while its own track is the narration', () => {
    const s = readerScoreSource(base)!;
    expect(s).toMatchObject({
      key: 'p/part-1/t1',
      uri: 'file:///s1',
      durationMs: 60_000,
      playing: true,
      rate: 1.1,
      seekRevision: 3,
      props: { packId: 'p', storyId: 'part-1', mode: 'reader' },
    });
    expect(s.positionMs()).toBe(4_200);
  });

  it('no score, or another voice track, = no source (the bed plays)', () => {
    expect(readerScoreSource({ ...base, score: null })).toBeNull();
    expect(readerScoreSource({ ...base, currentTrackId: 't2' })).toBeNull();
    expect(readerScoreSource({ ...base, currentTrackId: null })).toBeNull();
  });

  it('a score not yet downloaded still publishes (uri null → policy falls back to the bed)', () => {
    expect(readerScoreSource({ ...base, score: { ...score, localUri: null } })!.uri).toBeNull();
  });
});

describe('listenScoreSource', () => {
  const segment = { storyId: 'part-2', trackId: 't1', startMs: 10_000 };
  it('positions the score at full-track position − segment.startMs', () => {
    const s = listenScoreSource({
      packId: 'p',
      segment,
      score,
      playing: true,
      rate: 2,
      seekRevision: 0,
      positionMs: () => 12_500,
    })!;
    expect(s.key).toBe('p/part-2/t1');
    expect(s.positionMs()).toBe(2_500);
    expect(s.props).toEqual({ packId: 'p', storyId: 'part-2', mode: 'listen' });
  });

  it('an unscored segment, or a score cut for another track, = none', () => {
    const args = {
      packId: 'p',
      segment,
      playing: true,
      rate: 1,
      seekRevision: 0,
      positionMs: () => 0,
    };
    expect(listenScoreSource({ ...args, score: undefined })).toBeNull();
    expect(listenScoreSource({ ...args, score: { ...score, trackId: 'other' } })).toBeNull();
    expect(listenScoreSource({ ...args, segment: undefined, score })).toBeNull();
  });
});

describe('currentScoreSource', () => {
  it('the most recently registered source wins; none = null', () => {
    expect(currentScoreSource(new Map())).toBeNull();
    const a = readerScoreSource({
      packId: 'p',
      storyId: 'a',
      score,
      currentTrackId: 't1',
      playing: false,
      rate: 1,
      seekRevision: 0,
      positionMs: () => 0,
    })!;
    const b = { ...a, key: 'p/b/t1' };
    const m = new Map([
      [Symbol('a'), a],
      [Symbol('b'), b],
    ]);
    expect(currentScoreSource(m)!.key).toBe('p/b/t1');
  });
});
