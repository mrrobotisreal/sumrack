import { describe, expect, it } from 'vitest';

import { minutesRu } from '../minutes-ru';

describe('minutesRu', () => {
  it('picks the Russian plural form of the rounded minute count', () => {
    expect(minutesRu(60)).toBe('1 минута');
    expect(minutesRu(120)).toBe('2 минуты');
    expect(minutesRu(300)).toBe('5 минут');
    expect(minutesRu(480)).toBe('8 минут');
    expect(minutesRu(600)).toBe('10 минут');
    expect(minutesRu(1260)).toBe('21 минута');
  });
});
