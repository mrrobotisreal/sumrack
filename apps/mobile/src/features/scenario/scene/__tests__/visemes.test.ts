import { describe, expect, it } from 'vitest';

import { buildKaraokeIndex } from '@/features/reader/karaoke';

import {
  buildRoundMask,
  isRoundWord,
  MOUTH_TICK_MS,
  mouthShapeAt,
  MUPPET_SEQUENCE,
  MUPPET_STEP_MS,
  muppetShapeAt,
  startMediaClock,
  stepIndexAt,
  syncMediaClock,
} from '../visemes';

describe('round rule (§8.2)', () => {
  it('a word whose FIRST vowel is о/у/ю/ё is round', () => {
    for (const w of ['Проверка', 'ужас', 'Юля', 'ёж', 'СЛОВО', 'кто'])
      expect(isRoundWord(w), w).toBe(true);
  });

  it('any other first vowel — or no vowel — is wide', () => {
    for (const w of ['раз', 'три', 'меня', 'Вы', 'слышите', 'ты', 'хм', '']) {
      expect(isRoundWord(w), w).toBe(false);
    }
  });

  it('only the first vowel counts (второй → в-т-О → round; тебя → е → wide)', () => {
    expect(isRoundWord('второй')).toBe(true);
    expect(isRoundWord('тебя')).toBe(false);
    expect(isRoundWord('идёт')).toBe(false);
  });
});

describe('index math', () => {
  it('floors media time into 40 ms steps', () => {
    expect(MOUTH_TICK_MS).toBe(40);
    expect(stepIndexAt(0)).toBe(0);
    expect(stepIndexAt(39.9)).toBe(0);
    expect(stepIndexAt(40)).toBe(1);
    expect(stepIndexAt(1260)).toBe(31);
  });

  it('mouthShapeAt reads the digit, 0 outside the track, null without a track', () => {
    const track = '0123440';
    expect(mouthShapeAt(track, null, 0)).toBe(0);
    expect(mouthShapeAt(track, null, 45)).toBe(1);
    expect(mouthShapeAt(track, null, 160)).toBe(4);
    expect(mouthShapeAt(track, null, 240)).toBe(0);
    expect(mouthShapeAt(track, null, 10_000)).toBe(0);
    expect(mouthShapeAt(track, null, -5)).toBe(0);
    expect(mouthShapeAt(null, null, 100)).toBeNull();
  });

  it('a 4 becomes 5 (round) only where the mask says so', () => {
    const track = '44444';
    const mask = '01010';
    expect(mouthShapeAt(track, mask, 0)).toBe(4);
    expect(mouthShapeAt(track, mask, 40)).toBe(5);
    expect(mouthShapeAt(track, mask, 80)).toBe(4);
    expect(mouthShapeAt(track, mask, 120)).toBe(5);
    // Never promotes anything but a 4.
    expect(mouthShapeAt('33333', '11111', 40)).toBe(3);
  });

  it('a garbage character reads as closed', () => {
    expect(mouthShapeAt('0x0', null, 40)).toBe(0);
  });
});

describe('buildRoundMask (T10 activeWordAt over the stamps)', () => {
  // «Проверка связи.» — проверка is round (о), связи is wide (я).
  const sentence = [{ id: 's', ru: 'Проверка связи.' }];
  const words = ['Проверка', 'связи', '.'];
  const stamps = [
    { sentenceId: 's', tokenIndex: 0, startMs: 160, endMs: 620 },
    { sentenceId: 's', tokenIndex: 1, startMs: 660, endMs: 1000 },
  ];
  const index = buildKaraokeIndex(sentence, stamps, 1260);

  it('marks the steps of round words and nothing else', () => {
    const mask = buildRoundMask(32, index, (i) => words[i]);
    expect(mask).toHaveLength(32);
    // Lead-in silence (steps 0–3) is never round.
    expect(mask.slice(0, 4)).toBe('0000');
    // Проверка: 160–620 ms → steps 4..15 round.
    expect(mask.slice(4, 16)).toBe('111111111111');
    // связи: from 660 ms on → wide.
    expect(mask.slice(17, 25)).toBe('00000000');
  });

  it('is all zeros without stamps (sentence mode) or without an index', () => {
    const none = buildKaraokeIndex(sentence, [], 1260);
    expect(buildRoundMask(10, none, (i) => words[i])).toBe('0000000000');
    expect(buildRoundMask(10, null, (i) => words[i])).toBe('0000000000');
    expect(buildRoundMask(0, index, (i) => words[i])).toBe('');
  });
});

describe('muppet fallback', () => {
  it('alternates 2/0/3/1 at 90 ms', () => {
    expect(MUPPET_SEQUENCE).toEqual([2, 0, 3, 1]);
    expect(MUPPET_STEP_MS).toBe(90);
    expect([0, 90, 180, 270, 360].map(muppetShapeAt)).toEqual([2, 0, 3, 1, 2]);
    expect(muppetShapeAt(-50)).toBe(2);
  });
});

describe('media clock (stale currentTime extrapolation)', () => {
  it('follows fresh readings and extrapolates repeated ones at the rate', () => {
    const clock = startMediaClock(0, 1000, 1);
    expect(syncMediaClock(clock, 0, 1040)).toBe(40);
    expect(syncMediaClock(clock, 0, 1080)).toBe(80);
    expect(syncMediaClock(clock, 250, 1250)).toBe(250);
    expect(syncMediaClock(clock, 250, 1290)).toBe(290);
  });

  it('extrapolates at 0.8× for slower replay', () => {
    const clock = startMediaClock(0, 0, 0.8);
    expect(syncMediaClock(clock, 0, 100)).toBeCloseTo(80);
    expect(syncMediaClock(clock, 80, 100)).toBe(80);
    expect(syncMediaClock(clock, 80, 200)).toBeCloseTo(160);
  });
});
