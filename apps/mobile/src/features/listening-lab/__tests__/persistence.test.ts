import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb } from '@/db/__tests__/helpers';
import { createLearningSessionsRepo } from '@/db/repositories/learning-sessions';
import { exportUserData } from '@/features/backup/export-core';
import { restoreUserData } from '@/features/backup/restore-core';
import { AttemptSchema, assessMeaning, EMPTY_ASSISTANCE } from '../attempt';
import { catalog, SegmentSchema, LISTENING_MODE } from '../catalog';
import { completeDraft, newDraft } from '../draft';

const segment = SegmentSchema.parse(catalog.segments[0]);
describe('completed listening user data', () => {
  it('round-trips response, provenance and help through the existing backup without any review/card writes', async () => {
    const db = createTestDb(),
      target = createTestDb(),
      repo = createLearningSessionsRepo(db);
    const draft = newDraft(segment, 'lab-attempt', 100, 0, false);
    draft.attempt.assistance = { ...EMPTY_ASSISTANCE, plays: 1 };
    draft.attempt.meaning = assessMeaning(
      segment,
      segment.meaning.correctIndex,
      draft.attempt.assistance,
      0,
      false,
    );
    draft.dictationText = 'Добрый день.';
    draft.retellingText = 'У человека болит голова.';
    draft.attempt.recording = { durationMs: 1200, retention: 'temporary-cache' };
    const completed = completeDraft(draft, segment, 200);
    await repo.recordCompleted(completed);
    await repo.recordCompleted(completed);
    expect(completed.itemCount).toBe(2);
    expect(completed.correctCount).toBe(1);
    expect(completed.detail.meaning).toMatchObject({ firstListen: false, firstLabListen: true });
    const exported = await exportUserData(db);
    await restoreUserData(target, JSON.parse(JSON.stringify(exported.payload)));
    const restored = await createLearningSessionsRepo(target).list(LISTENING_MODE);
    expect(restored).toHaveLength(1);
    expect(AttemptSchema.parse(restored[0]?.detail)).toEqual(completed.detail);
    expect(db.all(sql`SELECT * FROM review_log`)).toHaveLength(0);
    expect(db.all(sql`SELECT * FROM cards`)).toHaveLength(0);
    expect(JSON.stringify(exported.payload.tables.gameSessions)).not.toContain('file:///');
  });
  it('saves independent retelling as self-review without inventing graded items', () => {
    const draft = newDraft(segment, 'retell-only', 100, 3, false);
    draft.retellingText = 'Он хочет лекарство.';
    const result = completeDraft(draft, segment, 200);
    expect(result).toMatchObject({
      itemCount: 0,
      correctCount: 0,
      detail: {
        dictation: null,
        meaning: null,
        retelling: 'Он хочет лекарство.',
        selfReview: 'not-reviewed',
      },
    });
  });
});
