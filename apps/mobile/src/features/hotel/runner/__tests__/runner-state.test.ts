import type { CourseItem } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import { answer, moveTo, percentOf, startRun, submit, unanswered } from '../runner-state';

const choice = (id: string, answerIdx: number) =>
  ({
    id,
    topic: 't',
    kind: 'choice',
    stem: 'x … y',
    stemEn: 'x',
    options: ['а', 'б', 'в'],
    answer: answerIdx,
    explain: 'e',
  }) as unknown as CourseItem;

const writing = (id: string) => ({ id, topic: 't', kind: 'writing' }) as unknown as CourseItem;

const items = [choice('a', 0), choice('b', 1), writing('w'), choice('c', 2)];

describe('startRun', () => {
  it('keeps the drawn order, serves writing and speaking (T93), and reports only deferred items', () => {
    const withSpeaking = [
      ...items,
      { id: 's', topic: 't', kind: 'speaking-reply' } as never,
      { id: 'm', topic: 't', kind: 'speaking-monologue' } as never,
    ];
    const s = startRun('unit', withSpeaking, ['a', 'w', 'b', 'c', 's', 'm']);
    expect(s.itemIds).toEqual(['a', 'w', 'b', 'c', 's']);
    expect(s.deferred).toEqual(['m']);
    expect(s.phase).toBe('run');
  });

  it('drops drawn ids the pool no longer holds', () => {
    expect(startRun('floor', items, ['a', 'gone']).itemIds).toEqual(['a']);
  });

  it('needs the drawn ITEMS, not just ids — an empty item list yields an empty sitting (the «1 из 0» S25 bug)', () => {
    // runner-screen must load the drawn items (repos.course.getItems) before calling startRun.
    expect(startRun('unit', [], ['a', 'b', 'c']).itemIds).toEqual([]);
    expect(startRun('unit', items, ['a', 'b', 'c']).itemIds).toEqual(['a', 'b', 'c']);
  });
});

describe('answer and scoring', () => {
  it('records a correct and a wrong choice, then scores the sitting', () => {
    let s = startRun('unit', items, ['a', 'b', 'c']);
    s = answer(s, items[0]!, 0);
    s = answer(s, items[1]!, 0);
    expect(s.responses.a).toMatchObject({ correct: true });
    expect(s.responses.b).toMatchObject({ correct: false });
    const { percent, points } = percentOf(s, items);
    expect(points).toEqual({ a: 1, b: 0, c: 0 });
    expect(percent).toBe(33);
  });

  it('lists unanswered items so the «Сдать» confirm can count them', () => {
    let s = startRun('floor', items, ['a', 'b', 'c']);
    s = answer(s, items[0]!, 0);
    expect(unanswered(s)).toEqual(['b', 'c']);
  });

  it('a submitted run takes no more answers', () => {
    let s = startRun('floor', items, ['a']);
    s = submit(s);
    expect(answer(s, items[0]!, 0).responses).toEqual({});
  });
});

describe('navigation', () => {
  it('clamps the cursor into the run', () => {
    const s = startRun('floor', items, ['a', 'b', 'c']);
    expect(moveTo(s, -3).cursor).toBe(0);
    expect(moveTo(s, 99).cursor).toBe(2);
  });
});
