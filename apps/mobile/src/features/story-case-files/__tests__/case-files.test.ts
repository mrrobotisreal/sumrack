import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '@/db/__tests__/helpers';
import { createLearningSessionsRepo } from '@/db/repositories/learning-sessions';
import { exportUserData } from '@/features/backup/export-core';
import { restoreUserData } from '@/features/backup/restore-core';
import { FakeServer } from '@/features/account-sync/__tests__/fake-server';
import { makePhone } from '@/features/account-sync/__tests__/phones';
import { CASE_FILES } from '../catalog';
import {
  CaseFileSchema,
  caseAvailability,
  finishCaseAttempt,
  gradeQuestions,
  parseAttempts,
  validateSource,
  type CaseDraft,
  type CaseFile,
} from '../model';
import { createCaseDraftStore, saveCaseAttempt } from '../persistence';

const file = CASE_FILES[0]!;
function sourceFor(f: CaseFile) {
  const count = Number(f.boundarySentenceId.split('-s')[1]);
  return {
    pack: { id: f.packId, version: f.packVersion },
    story: { id: f.storyId },
    sentences: Array.from({ length: count }, (_, i) => {
      const id = f.boundarySentenceId.replace(/s\d+$/, `s${String(i + 1).padStart(2, '0')}`);
      return {
        id,
        orderIdx: i,
        ru: f.source.find((s) => s.id === id)?.ru ?? 'Unreferenced test sentence.',
      };
    }),
  };
}
function draft(f = file, id = 'attempt-1', stage: 'story' | 'transfer' = 'story'): CaseDraft {
  const activity = stage === 'story' ? f : f.transfer;
  return {
    schemaVersion: 1,
    id,
    caseId: f.id,
    revision: f.revision,
    stage,
    startedAt: 100,
    answers: Object.fromEntries(activity.questions.map((q) => [q.id, q.accepted[0]!])),
    retelling: 'Питер написал Дэвиду. Дэвид поехал к дому.',
    checklist: [0],
    helped: false,
  };
}

describe('case files source contract', () => {
  it('has three complete parts, each with all five reasoning kinds and an original transfer', () => {
    expect(CASE_FILES).toHaveLength(3);
    for (const f of CASE_FILES) {
      expect(CaseFileSchema.safeParse(f).success).toBe(true);
      expect(new Set(f.questions.map((q) => q.kind)).size).toBe(5);
      expect(f.transfer.questions).toHaveLength(4);
      expect(validateSource(f, sourceFor(f))).toEqual([]);
    }
  });
  it('blocks future parts, missing packs, version mismatches, changed text, missing refs and boundaries', () => {
    const source = sourceFor(file);
    expect(caseAvailability(file, null, { finishedAt: 200 })).toBe('missing');
    expect(caseAvailability(file, source, null)).toBe('unread');
    expect(caseAvailability(file, source, { finishedAt: null })).toBe('unread');
    expect(caseAvailability(file, source, { finishedAt: 200 })).toBe('ready');
    expect(
      caseAvailability(
        file,
        { ...source, pack: { ...source.pack, version: 4 } },
        { finishedAt: 200 },
      ),
    ).toBe('stale');
    expect(
      caseAvailability(file, { ...source, story: { id: 'part-4' } }, { finishedAt: 200 }),
    ).toBe('stale');
    expect(caseAvailability(file, { ...source, sentences: [] }, { finishedAt: 200 })).toBe('stale');
    const changed = source.sentences.map((s) =>
      s.id === file.source[0]!.id ? { ...s, ru: 'changed' } : s,
    );
    expect(caseAvailability(file, { ...source, sentences: changed }, { finishedAt: 200 })).toBe(
      'stale',
    );
    expect(validateSource({ ...file, boundarySentenceId: file.source[0]!.id }, source)).not.toEqual(
      [],
    );
    const future = structuredClone(file);
    future.questions[0]!.sourceIds.push('nea1p4-s01');
    expect(validateSource(future, source)).toContain('unresolved support nea1p4-s01');
  });
  it('accepts alternative defensible evidence and never treats a guess as a fact', () => {
    const evidence = CASE_FILES[1]!.questions.find((q) => q.id === 'p2-evidence')!;
    expect(gradeQuestions([evidence], { [evidence.id]: '1' })[0]!.correct).toBe(true);
    expect(gradeQuestions([evidence], { [evidence.id]: '3' })[0]!.correct).toBe(true);
    expect(gradeQuestions([evidence], { [evidence.id]: '2' })[0]!.correct).toBe(false);
    const uncertainty = CASE_FILES[2]!.questions.find((q) => q.kind === 'inference')!;
    expect(gradeQuestions([uncertainty], { [uncertainty.id]: '3' })[0]!.correct).toBe(true);
  });
  it('rejects invalid answer keys and duplicate choice ids', () => {
    const broken = structuredClone(file);
    broken.questions[0]!.accepted = ['not-an-option'];
    expect(CaseFileSchema.safeParse(broken).success).toBe(false);
    broken.questions[0]!.accepted = ['1'];
    broken.questions[0]!.options[1]!.id = '1';
    expect(CaseFileSchema.safeParse(broken).success).toBe(false);
  });
  const packPath = path.resolve(
    __dirname,
    '../../../../../../../sumrak-content/packs/a1-no-end-house-001/pack.json',
  );
  it.skipIf(!existsSync(packPath))(
    'validates every bound source sentence against the local published v3 pack',
    () => {
      const pack: {
        id: string;
        version: number;
        stories: { id: string; sentences: { id: string; ru: string }[] }[];
      } = JSON.parse(readFileSync(packPath, 'utf8'));
      for (const f of CASE_FILES) {
        const story = pack.stories.find((s) => s.id === f.storyId)!;
        expect(
          validateSource(f, {
            pack,
            story,
            sentences: story.sentences.map((s, orderIdx) => ({ ...s, orderIdx })),
          }),
        ).toEqual([]);
      }
    },
  );
});

describe('immutable attempts and local drafts', () => {
  it('rejects incomplete work and preserves first/repeated/helped/transfer distinctions', () => {
    const first = finishCaseAttempt(file, draft(), [], 200);
    expect(first.exposure).toBe('first');
    const repeat = finishCaseAttempt(
      file,
      { ...draft(file, 'attempt-2'), helped: true },
      [first],
      300,
    );
    expect(repeat.exposure).toBe('repeated');
    expect(repeat.helped).toBe(true);
    expect(
      finishCaseAttempt(file, draft(file, 'transfer', 'transfer'), [first], 300).exposure,
    ).toBe('first');
    expect(() => finishCaseAttempt(file, { ...draft(), answers: {} }, [], 200)).toThrow(
      'every question',
    );
    expect(() => finishCaseAttempt(file, { ...draft(), retelling: ' ' }, [], 200)).toThrow(
      'typed retelling',
    );
    expect(() => finishCaseAttempt(file, { ...draft(), revision: 99 }, [], 200)).toThrow('changed');
    expect(() => finishCaseAttempt(file, { ...draft(), checklist: [99] }, [], 200)).toThrow(
      'self-review',
    );
  });
  it('coalesces double submit, restores history and writes no learning/progress tables', async () => {
    const db = createTestDb();
    const sessions = createLearningSessionsRepo(db);
    const [saved, double] = await Promise.all([
      saveCaseAttempt(sessions, file, draft(), 200),
      saveCaseAttempt(sessions, file, draft(), 201),
    ]);
    expect(double).toEqual(saved);
    expect(
      await saveCaseAttempt(sessions, file, { ...draft(), retelling: 'different' }, 900),
    ).toEqual(saved);
    expect(await sessions.list('story-case-file')).toHaveLength(1);
    const retry = await saveCaseAttempt(
      sessions,
      file,
      { ...draft(file, 'retry'), helped: true },
      400,
    );
    expect(retry.exposure).toBe('repeated');
    expect(db.all(sql`SELECT * FROM cards`)).toEqual([]);
    expect(db.all(sql`SELECT * FROM review_log`)).toEqual([]);
    expect(db.all(sql`SELECT * FROM story_progress`)).toEqual([]);
    expect(db.all(sql`SELECT * FROM daily_activity`)).toEqual([]);
    const { payload } = await exportUserData(db);
    const restored = createTestDb();
    await restoreUserData(restored, JSON.parse(JSON.stringify(payload)));
    const restoredAttempts = parseAttempts(
      await createLearningSessionsRepo(restored).list('story-case-file'),
    );
    expect(restoredAttempts).toEqual([retry, saved]);
    expect(restoredAttempts[1]!.retelling).toBe(draft().retelling);
  });
  it('round-trips the completed JSON through the existing sync wire with two in-memory databases', async () => {
    const server = new FakeServer();
    const first = await makePhone('Case fixture A', 'case-fixture-a', server.client());
    const second = await makePhone('Case fixture B', 'case-fixture-b', server.client());
    const saved = await saveCaseAttempt(first.repos.learningSessions, file, draft(), 200);
    await first.sync();
    await second.sync();
    await first.sync();
    expect(parseAttempts(await second.repos.learningSessions.list('story-case-file'))).toEqual([
      saved,
    ]);
    expect(second.db.all(sql`SELECT * FROM cards`)).toEqual([]);
    expect(second.db.all(sql`SELECT * FROM review_log`)).toEqual([]);
    expect(second.db.all(sql`SELECT * FROM story_progress`)).toEqual([]);
  });
  it('serializes keystrokes then clear, survives a store restart and ignores stale/corrupt drafts', async () => {
    const values = new Map<string, string>();
    const storage = {
      async getItem(k: string) {
        return values.get(k) ?? null;
      },
      async setItem(k: string, v: string) {
        values.set(k, v);
      },
      async removeItem(k: string) {
        values.delete(k);
      },
    };
    const store = createCaseDraftStore(storage, file);
    await store.write(draft());
    expect(await createCaseDraftStore(storage, file).read()).toEqual(draft());
    expect(await createCaseDraftStore(storage, { ...file, revision: 2 }).read()).toBeNull();
    const write = store.write({ ...draft(), retelling: 'Новый текст.' });
    const clear = store.clear();
    await Promise.all([write, clear]);
    expect(await store.read()).toBeNull();
    values.set(`sumrak:case-file-draft:v1:${file.id}`, '{broken');
    expect(await store.read()).toBeNull();
    expect(parseAttempts([{ detail: { unrecognized: true } }])).toEqual([]);
  });
});
