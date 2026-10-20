import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createLearningSessionsRepo } from '../repositories/learning-sessions';
import { createTestDb } from './helpers';

describe('immutable completed learning sessions', () => {
  const attempt = {
    id: 'attempt-1',
    mode: 'story-case-file',
    startedAt: 100,
    endedAt: 200,
    itemCount: 1,
    correctCount: 1,
    detail: { version: 1, answer: 'Я иду в комнату.', helped: false },
  };
  it('writes only a final row, round-trips JSON and retries without another outbox event', async () => {
    const db = createTestDb();
    const repo = createLearningSessionsRepo(db);
    // A local observer models the append-only upload seeing the INSERT.
    db.run(sql`CREATE TABLE observed (ended_at INTEGER, detail TEXT)`);
    db.run(sql`CREATE TRIGGER capture_final AFTER INSERT ON game_sessions BEGIN
      INSERT INTO observed VALUES (NEW.ended_at, NEW.detail); END`);
    await repo.recordCompleted(attempt);
    await repo.recordCompleted(attempt);
    expect(await repo.list(attempt.mode)).toEqual([attempt]);
    const observed = db.all<{ ended_at: number; detail: string }>(sql`SELECT * FROM observed`);
    expect(observed).toHaveLength(1);
    expect(observed[0]!.ended_at).toBe(200);
    expect(JSON.parse(observed[0]!.detail)).toEqual(attempt.detail);
    expect(db.all(sql`SELECT * FROM review_log`)).toHaveLength(0);
    expect(db.all(sql`SELECT * FROM cards`)).toHaveLength(0);
  });
  it('rejects conflicting id reuse without changing the original', async () => {
    const repo = createLearningSessionsRepo(createTestDb());
    await repo.recordCompleted(attempt);
    await expect(repo.recordCompleted({ ...attempt, correctCount: 0 })).rejects.toThrow(
      'already been saved',
    );
    expect((await repo.list(attempt.mode))[0]!.correctCount).toBe(1);
  });
  it('rejects invalid counts, dates and non-JSON detail before writing', async () => {
    const repo = createLearningSessionsRepo(createTestDb());
    await expect(repo.recordCompleted({ ...attempt, correctCount: 2 })).rejects.toThrow();
    await expect(repo.recordCompleted({ ...attempt, endedAt: 10 })).rejects.toThrow();
    expect(await repo.list(attempt.mode)).toEqual([]);
  });
});
