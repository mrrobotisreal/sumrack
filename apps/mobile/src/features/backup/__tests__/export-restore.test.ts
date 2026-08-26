import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createJournalRepo } from '@/db/repositories/journal';
import {
  achievements,
  analyticsEvents,
  assessments,
  bankItems,
  bookmarks,
  cards,
  checkpointResults,
  dailyActivity,
  dialogueEndingsSeen,
  dialogueRuns,
  encounters,
  frozenDays,
  gameSessions,
  importedPacks,
  importRequests,
  journalEntries,
  notes,
  packs,
  reviewLog,
  settings,
  storyProgress,
  syncState,
  unitProgress,
} from '@/db/schema';
import type { SumrakDB } from '@/db/types';
import { bytesToBase64 } from '@/lib/base64';

import {
  decryptBackupEnvelope,
  deriveBackupKey,
  encryptBackupPayload,
  GCM_IV_BYTES,
} from '../crypto';
import { exportUserData } from '../export-core';
import { USER_TABLE_NAMES } from '../payload-schema';
import { restoreUserData } from '../restore-core';

const NOW = 1756000000000;

/** Seed at least one row into EVERY user table + a matching content pack. */
async function seedSource(db: SumrakDB) {
  await db.insert(packs).values({
    id: 'pack-a',
    version: 2,
    type: 'stories',
    titleRu: 'Тест',
    titleEn: 'Test',
    level: 'A1',
    tags: [],
    importedAt: NOW,
  });

  await db.insert(bankItems).values([
    {
      id: 'bi-word',
      kind: 'word',
      lemma: 'тёмный',
      lemmaNorm: 'темный',
      surface: 'тёмном',
      normalized: 'темном',
      translation: 'dark',
      grammar: 'adj., prep. sg.',
      pos: 'adj',
      level: 'A2',
      sourceSentenceId: 's1',
      sourceStoryId: 'story-1',
      note: null,
      needsEnrichment: false,
      createdAt: NOW - 5000,
    },
    {
      id: 'bi-phrase',
      kind: 'phrase',
      lemma: null,
      lemmaNorm: null,
      surface: 'в тёмном лесу',
      normalized: 'в темном лесу',
      translation: 'in the dark forest',
      grammar: null,
      pos: null,
      level: null,
      sourceSentenceId: null,
      sourceStoryId: null,
      note: 'from Alina',
      needsEnrichment: true,
      createdAt: NOW - 4000,
    },
  ]);
  await db.insert(encounters).values({
    id: 'enc-1',
    bankItemId: 'bi-word',
    sentenceId: 's1',
    journalEntryId: null,
    surface: 'тёмном',
    createdAt: NOW - 5000,
  });
  await db.insert(cards).values([
    {
      id: 'card-1',
      bankItemId: 'bi-word',
      direction: 'ru-en',
      dueAt: NOW + 86400000,
      stability: 3.5,
      difficulty: 5.1,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 1,
      reps: 3,
      lapses: 1,
      state: 2,
      lastReviewAt: NOW - 3000,
      createdAt: NOW - 5000,
    },
    {
      id: 'card-2',
      bankItemId: 'bi-word',
      direction: 'production',
      dueAt: NOW,
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      lastReviewAt: null,
      createdAt: NOW - 5000,
    },
  ]);
  await db.insert(reviewLog).values({
    id: 'rl-1',
    cardId: 'card-1',
    rating: 3,
    state: 2,
    dueAt: NOW,
    stability: 3.5,
    difficulty: 5.1,
    elapsedDays: 1,
    lastElapsedDays: 0,
    scheduledDays: 1,
    learningSteps: 1,
    reviewedAt: NOW - 3000,
    durationMs: 4200,
  });
  await db.insert(journalEntries).values({
    id: 'je-1',
    promptId: 'prompt-1',
    ru: 'Сегодня я видел тёмный лес.',
    aiFeedback: '{"v":1,"summary":"ok"}',
    feedbackStatus: 'done',
    createdAt: NOW - 2000,
    updatedAt: NOW - 1000,
  });
  await db.insert(notes).values({
    id: 'note-1',
    title: 'Грамматика',
    body: '# ещё раз\nтёмный.',
    createdAt: NOW - 2000,
    updatedAt: NOW - 500,
  });
  await db.insert(checkpointResults).values({
    id: 'cr-1',
    checkpointPackId: 'a1-checkpoint-001',
    scorePercent: 92.5,
    passed: true,
    detail: { specs: 14 },
    completedAt: NOW - 9000,
  });
  await db.insert(assessments).values({
    id: 'as-1',
    payload: { v: 1, skills: { reading: 'A1' } },
    createdAt: NOW - 8000,
  });
  await db.insert(gameSessions).values({
    id: 'gs-1',
    mode: 'daily',
    startedAt: NOW - 7000,
    endedAt: null,
    itemCount: 10,
    correctCount: 8,
    detail: null,
  });
  await db.insert(storyProgress).values({
    packId: 'pack-a',
    storyId: 'story-1',
    currentSentenceIdx: 6,
    startedAt: NOW - 6000,
    updatedAt: NOW - 100,
    finishedAt: null,
  });
  await db.insert(unitProgress).values({
    packId: 'pack-a',
    lessonReadAt: NOW - 5000,
    quizPassedAt: null,
    quizBestScorePercent: 70,
    completedAt: null,
    updatedAt: NOW - 5000,
  });
  await db.insert(dailyActivity).values({
    date: '2026-08-22',
    reviewsDone: 25,
    readingMs: 660000,
    storiesFinished: 1,
    goalMetAt: NOW - 4000,
    xp: 49,
    updatedAt: NOW - 4000,
  });
  await db.insert(frozenDays).values({ date: '2026-08-21', consumedAt: NOW - 3000 });
  await db.insert(achievements).values({ id: 'first-word', unlockedAt: NOW - 2000 });
  await db.insert(bookmarks).values([
    {
      id: 'bm-story',
      kind: 'story',
      packId: 'pack-a',
      storyId: 'story-1',
      sentenceId: null,
      createdAt: NOW - 1500,
    },
    {
      id: 'bm-sentence',
      kind: 'sentence',
      packId: 'pack-a',
      storyId: 'story-1',
      sentenceId: 's1',
      createdAt: NOW - 1000,
    },
  ]);
  await db.insert(dialogueRuns).values({
    id: 'run-1',
    dialogueId: 'dinner-mini',
    startedAt: NOW - 900,
    finishedAt: NOW - 800,
    endingId: 'end-good',
    pathJson: {
      v: 1,
      steps: [{ nodeId: 'din-n01' }, { nodeId: 'din-n02', choiceId: 'din-n02-c1', score: 92 }],
    },
    spokenScoreAvg: 92,
  });
  await db.insert(dialogueEndingsSeen).values({
    dialogueId: 'dinner-mini',
    endingId: 'end-good',
    firstSeenAt: NOW - 800,
  });
  // T28: import request + imported pack ride the payload like every user table.
  await db.insert(importRequests).values({
    id: 'imp-1',
    text: 'Тёмный вечер. Кто-то стучит.',
    title: 'Тёмный вечер',
    sourceLabel: 'Telegram',
    status: 'committed',
    annotationJson: null,
    error: null,
    packId: 'imported-20260825-temnyi-vecher',
    createdAt: NOW - 700,
    updatedAt: NOW - 600,
  });
  await db.insert(importedPacks).values({
    id: 'imported-20260825-temnyi-vecher',
    title: 'Тёмный вечер',
    sourceLabel: 'Telegram',
    packJsonGz: 'H4sIAAAAAAAAA6tWKkktLlGyUlAqSy0qzszPU9JRUEreBQBhpN6RFgAAAA==',
    createdAt: NOW - 650,
  });
  await db.insert(settings).values([
    { key: 'themeMode', value: 'dark', updatedAt: NOW },
    { key: 'goal.daily', value: { reviews: 20, readingMin: 10 }, updatedAt: NOW },
    // Planted fake secret — must NEVER survive into a payload.
    { key: 'evil.leak', value: 'github_pat_11FAKE_NOT_REAL', updatedAt: NOW },
  ]);
  await db.insert(syncState).values([
    // Content actually present at this exact version.
    {
      packId: 'pack-a',
      version: 2,
      source: 'github',
      installedAt: NOW,
      updatedAt: NOW,
      bytes: 900,
    },
    // Claimed installed, but content absent → must be reconciled away on restore.
    {
      packId: 'pack-b',
      version: 1,
      source: 'github',
      installedAt: NOW,
      updatedAt: NOW,
      bytes: null,
    },
    {
      packId: 'pack-c',
      version: 3,
      source: 'local-file',
      installedAt: NOW,
      updatedAt: NOW,
      bytes: null,
    },
  ]);
  await db.insert(analyticsEvents).values([
    { id: 1, event: 'app_opened', props: { cold: true }, createdAt: NOW - 100 },
    { id: 2, event: 'review_graded', props: null, createdAt: NOW - 50 },
  ]);
}

async function selectAllUserTables(db: SumrakDB) {
  return {
    bankItems: await db.select().from(bankItems),
    encounters: await db.select().from(encounters),
    cards: await db.select().from(cards),
    reviewLog: await db.select().from(reviewLog),
    journalEntries: await db.select().from(journalEntries),
    notes: await db.select().from(notes),
    checkpointResults: await db.select().from(checkpointResults),
    assessments: await db.select().from(assessments),
    gameSessions: await db.select().from(gameSessions),
    storyProgress: await db.select().from(storyProgress),
    unitProgress: await db.select().from(unitProgress),
    dailyActivity: await db.select().from(dailyActivity),
    frozenDays: await db.select().from(frozenDays),
    achievements: await db.select().from(achievements),
    bookmarks: await db.select().from(bookmarks),
    dialogueRuns: await db.select().from(dialogueRuns),
    dialogueEndingsSeen: await db.select().from(dialogueEndingsSeen),
    importRequests: await db.select().from(importRequests),
    importedPacks: await db.select().from(importedPacks),
    settings: await db.select().from(settings),
    syncState: await db.select().from(syncState),
    analyticsEvents: await db.select().from(analyticsEvents),
  };
}

describe('export-core', () => {
  let db: SumrakDB;
  beforeEach(async () => {
    db = createTestDb();
    await seedSource(db);
  });

  it('exports every user table and zero content tables', async () => {
    const { payload } = await exportUserData(db, { now: new Date(NOW), appVersion: '0.1.0' });
    expect(Object.keys(payload.tables).sort()).toEqual(Object.keys(USER_TABLE_NAMES).sort());
    expect(payload.tables.bankItems).toHaveLength(2);
    expect(payload.tables.analyticsEvents).toHaveLength(2);
    // No content sneaks in under any key.
    const json = JSON.stringify(payload);
    expect(json).not.toContain('"titleRu"');
    expect(json).not.toContain('Тест'); // the pack title
    expect(payload.exportedAt).toBe(NOW);
  });

  it('drops settings values that look like secrets and reports the count', async () => {
    const { payload, secretsDropped } = await exportUserData(db);
    expect(secretsDropped).toBe(1);
    const keys = payload.tables.settings.map((s) => s.key);
    expect(keys).not.toContain('evil.leak');
    expect(JSON.stringify(payload)).not.toContain('github_pat_');
    expect(keys).toContain('themeMode');
  });

  it('payload survives a JSON round trip intact (what actually gets encrypted)', async () => {
    const { payload } = await exportUserData(db);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe('restore-core (full pipeline: export → encrypt → decrypt → restore)', () => {
  const ITERATIONS = 500;
  const SALT_B64 = bytesToBase64(new Uint8Array(16).fill(9));

  it('wipe-and-restore reproduces every user table exactly; stale sync_state reconciled', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);

    // Seal + unseal exactly like the device does.
    const key = await deriveBackupKey('test-pass', SALT_B64, ITERATIONS);
    const envelope = encryptBackupPayload(JSON.stringify(payload), key, {
      saltB64: SALT_B64,
      iterations: ITERATIONS,
      iv: new Uint8Array(GCM_IV_BYTES).fill(1),
      createdAt: new Date(NOW),
    });
    const decrypted = JSON.parse(decryptBackupEnvelope(envelope, key)) as unknown;

    // "Fresh install": same content pack present (bundled re-import analog).
    const target = createTestDb();
    await target.insert(packs).values({
      id: 'pack-a',
      version: 2,
      type: 'stories',
      titleRu: 'Тест',
      titleEn: 'Test',
      level: 'A1',
      tags: [],
      importedAt: NOW + 99,
    });
    // Pre-restore junk that must be replaced, not merged.
    await target.insert(bankItems).values({
      id: 'bi-preexisting',
      kind: 'word',
      lemma: 'другой',
      lemmaNorm: 'другои',
      surface: 'другой',
      normalized: 'другои',
      translation: 'other',
      needsEnrichment: false,
      createdAt: NOW,
    });
    await target.insert(settings).values({ key: 'bootstrapDone', value: true, updatedAt: NOW + 1 });

    const result = await restoreUserData(target, decrypted);
    expect(result.packsToRedownload.sort()).toEqual(['pack-b', 'pack-c']);
    expect(result.totalRows).toBeGreaterThan(15);

    const restored = await selectAllUserTables(target);
    const expected = payload.tables;
    // sync_state loses the two stale rows; everything else matches exactly.
    expect(restored.syncState).toEqual(expected.syncState.filter((r) => r.packId === 'pack-a'));
    for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
      if (k === 'syncState') continue;
      expect(restored[k]).toEqual(expected[k]);
    }
    // Replace semantics: pre-existing junk is gone.
    expect(restored.bankItems.map((b) => b.id)).not.toContain('bi-preexisting');
    expect(restored.settings.map((s) => s.key)).not.toContain('bootstrapDone');
  });

  it('restored journal/notes are searchable again (FTS triggers rebuilt the index)', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);

    const target = createTestDb();
    await restoreUserData(target, JSON.parse(JSON.stringify(payload)));
    // ё-folded shadow index: searching with е must find the ё entry (T03 rule).
    const journal = createJournalRepo(target);
    const entryHits = await journal.searchEntries('темный');
    expect(entryHits.map((e) => e.id)).toContain('je-1');
    const noteHits = await journal.searchNotes('еще');
    expect(noteHits.map((n) => n.id)).toContain('note-1');
  });

  it('a pre-T24 payload without a bookmarks key still restores (additive default)', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    // Old snapshots predate the table — simulate by dropping the key.
    const legacy = JSON.parse(JSON.stringify(payload)) as { tables: Record<string, unknown> };
    delete legacy.tables.bookmarks;

    const target = createTestDb();
    const result = await restoreUserData(target, legacy);
    expect(result.rowCounts.bookmarks).toBe(0);
    expect(await target.select().from(bookmarks)).toHaveLength(0);
    // The rest of the payload landed normally.
    expect(result.rowCounts.bankItems).toBe(2);
  });

  it('an invalid payload is refused with ZERO writes (live DB untouched)', async () => {
    const target = createTestDb();
    await target.insert(notes).values({
      id: 'keep-me',
      title: 'still here',
      body: 'untouched',
      createdAt: 1,
      updatedAt: 1,
    });

    const bad = {
      format: 'sumrak-backup-payload',
      payloadVersion: 1,
      exportedAt: NOW,
      tables: { bankItems: [{ id: 'x', bogus: true }] }, // wrong row + missing tables
    };
    await expect(restoreUserData(target, bad)).rejects.toMatchObject({ code: 'invalid-payload' });

    const notesAfter = await target.select().from(notes);
    expect(notesAfter).toHaveLength(1);
    expect(notesAfter[0]!.id).toBe('keep-me');
  });

  it('a mid-import failure rolls back completely', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    // Corrupt referential integrity in a way Zod can't see: a review_log row
    // pointing at a card that doesn't exist (FK violation at insert time).
    const sabotaged = JSON.parse(JSON.stringify(payload)) as typeof payload;
    sabotaged.tables.reviewLog.push({
      ...sabotaged.tables.reviewLog[0]!,
      id: 'rl-bad',
      cardId: 'ghost',
    });

    const target = createTestDb();
    await target.insert(notes).values({
      id: 'keep-me',
      title: 'still here',
      body: 'untouched',
      createdAt: 1,
      updatedAt: 1,
    });
    await expect(restoreUserData(target, sabotaged)).rejects.toThrow();

    const notesAfter = await target.select().from(notes);
    expect(notesAfter.map((n) => n.id)).toEqual(['keep-me']);
    expect(await target.select().from(bankItems)).toHaveLength(0);
  });
});

describe('user-table drift guard', () => {
  it('every non-content, non-infra table in the live schema is covered by the backup payload', async () => {
    const db = createTestDb();
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    const CONTENT_TABLES = new Set([
      'packs',
      'stories',
      'sentences',
      'tokens',
      'audio_tracks',
      'word_stamps',
      'lessons',
      'journal_prompts',
      'exercise_specs',
      // T26 dialogue content group (rebuilt from packs, never backed up).
      'dialogues',
      'dialogue_nodes',
      'dialogue_choices',
      'dialogue_endings',
      'dialogue_node_audio',
      'dialogue_node_stamps',
    ]);
    const isInfra = (n: string) =>
      n.startsWith('sqlite_') || n.startsWith('__drizzle') || n.includes('_fts');
    const userTables = rows
      .map((r) => r.name)
      .filter((n) => !CONTENT_TABLES.has(n) && !isInfra(n))
      .sort();
    expect(userTables).toEqual(Object.values(USER_TABLE_NAMES).sort());
  });
});
