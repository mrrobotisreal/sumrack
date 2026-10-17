import type { CourseItem } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import { courseDrillEntry, courseDrillItem } from '../course-drill';

/**
 * T89 decision 9: a course card in the deck session maps onto the existing drill
 * entry kinds. choice/typed 1:1, trigger → a choice over its tokens, transform →
 * typed; writing/speaking are not served in the deck.
 */

const EXPLAIN = 'x'.repeat(130);

const choice: CourseItem = {
  id: 'u1-c01',
  topic: 'case-prep',
  explain: EXPLAIN,
  kind: 'choice',
  stem: 'Я живу в … городе.',
  stemEn: 'I live in a … city.',
  options: ['большом', 'большой', 'большого', 'большую'],
  answer: 0,
} as CourseItem;

const trigger: CourseItem = {
  id: 'u1-t01',
  topic: 'case-prep',
  kind: 'trigger',
  sentence: 'Я живу в большом городе.',
  tokens: ['Я', 'живу', 'в', 'большом', 'городе', '.'],
  answer: 2,
  explain: EXPLAIN,
} as CourseItem;

const typed: CourseItem = {
  id: 'u1-ty1',
  topic: 'case-prep',
  kind: 'typed',
  prompt: 'Я живу в Москв…',
  accept: ['Москве'],
  explain: EXPLAIN,
} as CourseItem;

const transform: CourseItem = {
  id: 'u1-tr1',
  topic: 'case-prep',
  kind: 'transform',
  prompt: 'Это мой брат. → У меня нет …',
  accept: ['брата'],
  half: ['брат'],
  explain: EXPLAIN,
} as CourseItem;

// A writing item only needs to be a non-deck kind here; the mapper drops it on the kind.
const writing = {
  id: 'f12-w1',
  topic: 'writing',
  kind: 'writing',
  prompt: 'Напишите письмо.',
  explain: EXPLAIN,
} as unknown as CourseItem;

describe('courseDrillItem (decision 9)', () => {
  it('a choice maps 1:1', () => {
    const drill = courseDrillItem(choice);
    expect(drill).toMatchObject({
      id: 'u1-c01',
      kind: 'choice',
      stem: choice.kind === 'choice' ? choice.stem : '',
      options: ['большом', 'большой', 'большого', 'большую'],
      answer: 0,
    });
  });

  it('a trigger becomes a choice whose options are the sentence tokens', () => {
    const drill = courseDrillItem(trigger);
    expect(drill).toMatchObject({
      id: 'u1-t01',
      kind: 'choice',
      stem: 'Я живу в большом городе.',
      options: ['Я', 'живу', 'в', 'большом', 'городе', '.'],
      answer: 2,
    });
  });

  it('a typed item maps 1:1 with its prompt and accepted forms', () => {
    expect(courseDrillItem(typed)).toMatchObject({
      id: 'u1-ty1',
      kind: 'typed',
      prompt: 'Я живу в Москв…',
      accept: ['Москве'],
    });
  });

  it('a transform becomes a typed item with its prompt, accept and half forms', () => {
    expect(courseDrillItem(transform)).toMatchObject({
      id: 'u1-tr1',
      kind: 'typed',
      prompt: 'Это мой брат. → У меня нет …',
      accept: ['брата'],
      half: ['брат'],
    });
  });

  it('writing items are not served in the deck', () => {
    expect(courseDrillItem(writing)).toBeNull();
  });
});

describe('courseDrillEntry', () => {
  it('builds a drill entry keyed to the course deck card', () => {
    const entry = courseDrillEntry('a1-hotel-f03', choice, 'lexgram');
    expect(entry).not.toBeNull();
    expect(entry!.examId).toBe('course');
    expect(entry!.packId).toBe('a1-hotel-f03');
    expect(entry!.itemKey).toBe('a1-hotel-f03:course:u1-c01');
    expect(entry!.subtest.kind).toBe('lexgram');
    expect(entry!.item.id).toBe('u1-c01');
  });

  it('a course A1 card resolves to level A1 (the pack-id convention)', () => {
    expect(courseDrillEntry('a1-hotel-f03', choice, 'lexgram')!.level).toBe('A1');
  });

  it('an A2 pack id resolves to A2 (the same CASE fallback as the deck)', () => {
    expect(courseDrillEntry('a2-hotel-f01', choice, 'lexgram')!.level).toBe('A2');
  });

  it('a writing item yields no entry', () => {
    expect(courseDrillEntry('a1-hotel-f12', writing, 'writing')).toBeNull();
  });
});

describe('passage and audio refs survive the mapper (T92d)', () => {
  it("carries a floor-14 choice item's passage and audio into the drill item", () => {
    const passage = { storyId: 'story-a', sentenceIds: ['s1'] };
    const audio = { storyId: 'story-a', sentenceIds: ['s1', 's2'] };
    const item = { ...choice, passage, audio } as CourseItem;
    const drill = courseDrillItem(item) as unknown as { passage?: unknown; audio?: unknown };
    expect(drill.passage).toEqual(passage);
    expect(drill.audio).toEqual(audio);
  });

  it('leaves refs off an item that has none', () => {
    const drill = courseDrillItem(choice) as unknown as { passage?: unknown; audio?: unknown };
    expect(drill.passage).toBeUndefined();
    expect(drill.audio).toBeUndefined();
  });
});
