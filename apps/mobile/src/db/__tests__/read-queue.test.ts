import { describe, expect, it } from 'vitest';

import { createReadQueue } from '../read-queue';

/** T99: the dashboard's background reads run serially, cheapest-first. */
describe('createReadQueue', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it('runs tasks enqueued in one tick by priority, not by enqueue order', async () => {
    const q = createReadQueue();
    const order: string[] = [];
    const task = (name: string) => async () => {
      order.push(name);
      return name;
    };
    await Promise.all([
      q.run(10, task('grammar')),
      q.run(0, task('activity')),
      q.run(8, task('vocab')),
      q.run(1, task('forecast')),
    ]);
    expect(order).toEqual(['activity', 'forecast', 'vocab', 'grammar']);
  });

  it('is FIFO within a priority and never runs two tasks at once', async () => {
    const q = createReadQueue();
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const gate = deferred();
    const task = (n: number) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (n === 1) await gate.promise;
      order.push(n);
      active--;
    };
    const all = Promise.all([q.run(7, task(1)), q.run(7, task(2)), q.run(7, task(3))]);
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([]); // task 1 holds the queue
    gate.resolve();
    await all;
    expect(order).toEqual([1, 2, 3]);
    expect(maxActive).toBe(1);
  });

  it('a failing task rejects only itself; the queue keeps draining', async () => {
    const q = createReadQueue();
    const failing = q.run(0, async () => {
      throw new Error('boom');
    });
    const ok = q.run(1, async () => 'fine');
    await expect(failing).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('fine');
  });

  it('a higher-priority task enqueued while one runs goes next', async () => {
    const q = createReadQueue();
    const order: string[] = [];
    const gate = deferred();
    const first = q.run(5, async () => {
      await gate.promise;
      order.push('slow');
    });
    await new Promise((r) => setTimeout(r, 0));
    const later = q.run(9, async () => void order.push('low'));
    const urgent = q.run(0, async () => void order.push('urgent'));
    gate.resolve();
    await Promise.all([first, later, urgent]);
    expect(order).toEqual(['slow', 'urgent', 'low']);
  });
});
