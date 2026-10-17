import { describe, expect, it, vi } from 'vitest';

import { listenCaption, minutesLabel, partsLabel, voiceLabel } from '../listen-row-format';
import { parseListenProgress } from '../listen-progress';
import { assembleRows, listenRowTrailing, withListenRow } from '../listen-row-model';
import type { ListenAvailability } from '@/db/repositories/listen';

vi.mock('@/db', () => ({ repos: {} }));
vi.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
vi.mock('@/features/listen/listen-service', () => ({ useListenStore: () => null }));

describe('partsLabel', () => {
  it.each([
    [1, '1 часть'],
    [2, '2 части'],
    [4, '4 части'],
    [5, '5 частей'],
    [8, '8 частей'],
    [11, '11 частей'],
    [12, '12 частей'],
    [14, '14 частей'],
    [21, '21 часть'],
    [22, '22 части'],
  ])('%i', (n, s) => expect(partsLabel(n)).toBe(s));
});

describe('minutesLabel / voiceLabel / caption', () => {
  it('rounds and floors under a minute', () => {
    expect(minutesLabel(59_999)).toBe('< 1 мин');
    expect(minutesLabel(60_000)).toBe('1 мин');
    expect(minutesLabel(17 * 60_000 + 20_000)).toBe('17 мин');
  });
  it('strips the provider prefix', () => {
    expect(voiceLabel('elevenlabs:Mr. Wintrow')).toBe('Mr. Wintrow');
    expect(voiceLabel('Plain')).toBe('Plain');
  });
  it('formats the caption', () => {
    expect(
      listenCaption({ parts: 8, durationMs: 17 * 60_000, voice: 'elevenlabs:Mr. Wintrow' }),
    ).toBe('8 частей · 17 мин · Mr. Wintrow');
  });
});

describe('parseListenProgress', () => {
  it('parses percent and finished', () => {
    const m = parseListenProgress({
      v: 1,
      byPack: {
        a: { positionMs: 250, durationMs: 1000, updatedAt: 1 },
        b: { positionMs: 1000, durationMs: 1000, updatedAt: 1, finishedAt: 5 },
        c: { positionMs: 0, durationMs: 1000, updatedAt: 1 },
      },
    });
    expect(m.get('a')).toEqual({ percent: 25, finished: false });
    expect(m.get('b')).toEqual({ percent: 100, finished: true });
    expect(m.has('c')).toBe(false);
  });
  it('ignores junk', () => {
    expect(parseListenProgress(null).size).toBe(0);
    expect(parseListenProgress({ v: 2, byPack: {} }).size).toBe(0);
  });
});

const ready: ListenAvailability = { state: 'ready', parts: 3, durationMs: 1, voice: 'x:y' };
const pending: ListenAvailability = { ...ready, state: 'pending' };
const none: ListenAvailability = { ...ready, state: 'none' };
const rows = [{ kind: 'story' }, { kind: 'dialogue' }];

describe('withListenRow / assembleRows', () => {
  it('prepends for stories packs when ready or pending', () => {
    for (const a of [ready, pending]) {
      const out = withListenRow(rows, { id: 'p', type: 'stories' }, new Map([['p', a]]));
      expect(out[0]).toMatchObject({ kind: 'listen', packId: 'p', availability: a });
      expect(out).toHaveLength(3);
    }
  });
  it('absent for none, unknown, and non-story packs', () => {
    expect(withListenRow(rows, { id: 'p', type: 'stories' }, new Map([['p', none]]))).toBe(rows);
    expect(withListenRow(rows, { id: 'p', type: 'stories' }, undefined)).toBe(rows);
    for (const type of ['dialogue', 'exam', 'scenario', 'course']) {
      expect(withListenRow(rows, { id: 'p', type }, new Map([['p', ready]]))).toBe(rows);
    }
  });
  it('assembleRows keeps the listen row first', () => {
    const all = withListenRow(rows, { id: 'p', type: 'stories' }, new Map([['p', ready]]));
    const out = assembleRows(all, [{ kind: 'story' }]);
    expect(out.map((r) => r.kind)).toEqual(['listen', 'story', 'dialogue']);
  });
});

describe('listenRowTrailing', () => {
  it('prioritises now-playing, then finished, then percent', () => {
    expect(listenRowTrailing({ nowPlaying: true, finished: true, progressPercent: 5 }).kind).toBe(
      'playing',
    );
    expect(
      listenRowTrailing({ nowPlaying: false, finished: true, progressPercent: 100 }).kind,
    ).toBe('done');
    expect(listenRowTrailing({ nowPlaying: false, finished: false, progressPercent: 42 })).toEqual({
      kind: 'percent',
      text: '42 %',
    });
    expect(
      listenRowTrailing({ nowPlaying: false, finished: false, progressPercent: null }).kind,
    ).toBe('none');
  });
});
