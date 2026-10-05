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
  examAttempts,
  examItemCards,
  examResponses,
  frozenDays,
  gameSessions,
  grammarLessons,
  importedPacks,
  importRequests,
  journalEntries,
  notes,
  packs,
  reviewLog,
  scenarioAttempts,
  scenarioRuns,
  settings,
  storyProgress,
  syncState,
  unitProgress,
  wordProfiles,
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
    source: 'flashcard',
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
  await db.insert(wordProfiles).values([
    {
      id: 'wp-old',
      lemmaNorm: 'говорить',
      kind: 'word',
      headword: 'говорить',
      pos: 'verb',
      isCurrent: false,
      payload: { v: 1, stub: 'old version' },
      provider: 'anthropic',
      model: 'anthropic/claude-opus-5.5',
      quality: 'normal',
      effort: 'high',
      effortApplied: true,
      promptTokens: 1200,
      completionTokens: 3400,
      reasoningTokens: 900,
      costUsd: 0.0421,
      durationMs: 41_000,
      createdAt: NOW - 9000,
    },
    {
      id: 'wp-cur',
      lemmaNorm: 'говорить',
      kind: 'word',
      headword: 'говорить',
      pos: 'verb',
      isCurrent: true,
      payload: { v: 1, stub: 'current version', nested: { ok: true } },
      provider: 'openai',
      model: 'openai/gpt-6-sol',
      quality: 'fast',
      effort: 'medium',
      effortApplied: false,
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      costUsd: null,
      durationMs: 12_500,
      createdAt: NOW - 8000,
    },
  ]);
  await db.insert(grammarLessons).values({
    id: 'gl-1',
    lemmaNorm: 'говорить',
    kind: 'word',
    headword: 'говорить',
    sectionId: 'verb-nonpast',
    profileId: 'wp-cur',
    markdown: '## What this is\n\nA stub lesson.',
    provider: 'anthropic',
    model: 'anthropic/claude-opus-5.5',
    quality: 'normal',
    effort: 'high',
    effortApplied: true,
    promptTokens: 800,
    completionTokens: 1500,
    reasoningTokens: 0,
    costUsd: 0.0198,
    durationMs: 22_000,
    createdAt: NOW - 7000,
  });
  // T58: a finished scenario run with two attempts (one pruned) + an open one.
  await db.insert(scenarioRuns).values([
    {
      id: 'srun-1',
      packId: 'a1-scenario-fixture',
      scenarioId: 'radio-a1',
      familyId: 'radio',
      level: 'A1',
      startedAt: NOW - 6500,
      finishedAt: NOW - 6000,
      endingId: 'end-ok',
      pathJson: JSON.stringify({
        v: 1,
        steps: [
          {
            turnId: 'radio-a1-t01',
            misses: 0,
            assisted: false,
            skipped: false,
            rescued: false,
            meta: 0,
          },
          {
            turnId: 'radio-a1-t02',
            misses: 1,
            assisted: false,
            skipped: false,
            rescued: false,
            meta: 1,
          },
        ],
      }),
      statsJson: JSON.stringify({
        turns: 2,
        cleanTurns: 1,
        misses: 1,
        lifelines: 0,
        skips: 0,
        metaAsks: 1,
        rescues: 0,
        avgScore: 61.5,
      }),
      pinned: true,
      mediaLocal: false,
      mediaBundleState: 'uploaded',
      mediaBundleName: 'srun-1.bundle.enc',
      gameSessionId: 'gs-1',
    },
    {
      id: 'srun-2',
      packId: 'a1-scenario-fixture',
      scenarioId: 'radio-a1',
      familyId: 'radio',
      level: 'A1',
      startedAt: NOW - 5900,
      finishedAt: null,
      endingId: null,
      pathJson: JSON.stringify({ v: 1, steps: [] }),
      statsJson: null,
      pinned: false,
      mediaLocal: true,
      mediaBundleState: null,
      mediaBundleName: null,
      gameSessionId: null,
    },
  ]);
  await db.insert(scenarioAttempts).values([
    {
      id: 'satt-1',
      runId: 'srun-1',
      turnId: 'radio-a1-t02',
      attemptNo: 1,
      kind: 'answer',
      outcome: 'miss',
      transcript: 'э… меня',
      detailJson: JSON.stringify({
        kind: 'answer',
        target: 'Меня зовут Митч.',
        words: [],
        score: 31,
        slots: { name: null },
      }),
      audioFile: null,
      audioDurationMs: 700,
      createdAt: NOW - 6400,
    },
    {
      id: 'satt-2',
      runId: 'srun-1',
      turnId: 'radio-a1-t02',
      attemptNo: 2,
      kind: 'meta',
      outcome: 'explain',
      transcript: 'что значит проверка',
      detailJson: JSON.stringify({
        kind: 'meta',
        query: 'проверка',
        hit: 'radio-a1-gl-check',
        source: 'glossary',
      }),
      audioFile: 'srun-1/satt-2.ogg',
      audioDurationMs: 1400,
      createdAt: NOW - 6300,
    },
  ]);
  // T68: a finished full mock with two responses (one pending AI) + an abandoned drill + two deck cards.
  await db.insert(examAttempts).values([
    {
      id: 'eatt-1',
      packId: 'a1-exam-fixture',
      examId: 'a1-mock-fx',
      scope: 'full',
      subtestIds: JSON.stringify(['writing', 'lexgram', 'reading', 'listening', 'speaking']),
      mode: 'mock',
      status: 'finished',
      stateJson: JSON.stringify({ v: 1, subtests: [], current: 4, phase: 'done' }),
      startedAt: NOW - 5800,
      finishedAt: NOW - 5000,
      resultsJson: JSON.stringify({
        lexgram: { points: 4, maxPoints: 5, pct: 80, provisional: false, gradedBy: 'offline' },
      }),
      verdict: 'pass-borderline',
      xpAwarded: 60,
      pinned: true,
    },
    {
      id: 'eatt-2',
      packId: 'a1-exam-fixture',
      examId: 'a1-drill-fx',
      scope: 'drill',
      subtestIds: JSON.stringify(['lexgram']),
      mode: 'drill',
      status: 'abandoned',
      stateJson: JSON.stringify({ v: 1, subtests: [], current: 0, phase: 'intro' }),
      startedAt: NOW - 4900,
      finishedAt: NOW - 4800,
      resultsJson: null,
      verdict: null,
      xpAwarded: 0,
      pinned: false,
    },
  ]);
  await db.insert(examResponses).values([
    {
      id: 'eresp-1',
      attemptId: 'eatt-1',
      subtestId: 'lexgram',
      itemId: 'lg01',
      answerJson: JSON.stringify({ kind: 'choice', index: 1 }),
      points: 1,
      maxPoints: 1,
      gradingStatus: 'scored',
      gradingJson: null,
      durationMs: 8000,
      createdAt: NOW - 5700,
      updatedAt: NOW - 5700,
    },
    {
      id: 'eresp-2',
      attemptId: 'eatt-1',
      subtestId: 'writing',
      itemId: 'wr01',
      answerJson: JSON.stringify({ kind: 'writing', text: 'Здравствуй, мама!' }),
      points: 30.5,
      maxPoints: 100,
      gradingStatus: 'pending-ai',
      gradingJson: JSON.stringify({ v: 1, offline: { criteria: [] } }),
      durationMs: null,
      createdAt: NOW - 5600,
      updatedAt: NOW - 5500,
    },
  ]);
  await db.insert(examItemCards).values([
    {
      itemKey: 'a1-exam-fixture:a1-mock-fx:lg01',
      packId: 'a1-exam-fixture',
      examId: 'a1-mock-fx',
      itemId: 'lg01',
      subtestKind: 'lexgram',
      topic: 'case-prep',
      fsrsJson: JSON.stringify({ due: NOW, state: 1 }),
      due: NOW,
      lastResult: 'wrong',
      suspended: false,
      createdAt: NOW - 5000,
      updatedAt: NOW - 5000,
    },
    {
      itemKey: 'a1-exam-fixture:a1-drill-fx:dr01',
      packId: 'a1-exam-fixture',
      examId: 'a1-drill-fx',
      itemId: 'dr01',
      subtestKind: 'lexgram',
      topic: 'case-prep',
      fsrsJson: '{}',
      due: NOW + 1000,
      lastResult: null,
      suspended: true,
      createdAt: NOW - 4800,
      updatedAt: NOW - 4800,
    },
  ]);
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
    wordProfiles: await db.select().from(wordProfiles),
    grammarLessons: await db.select().from(grammarLessons),
    scenarioRuns: await db.select().from(scenarioRuns),
    scenarioAttempts: await db.select().from(scenarioAttempts),
    examAttempts: await db.select().from(examAttempts),
    examResponses: await db.select().from(examResponses),
    examItemCards: await db.select().from(examItemCards),
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
      if (k === 'scenarioRuns') {
        // T63 §10.3: restore leaves media lazy — every run comes back
        // `mediaLocal: false` (the debrief's Download fetches its bundle).
        expect(restored[k]).toEqual(
          (expected[k] as { mediaLocal: boolean }[]).map((r) => ({ ...r, mediaLocal: false })),
        );
        continue;
      }
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

  it('a pre-T50 payload (review_log rows without a source key) still parses + restores as NULL', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    const legacy = JSON.parse(JSON.stringify(payload)) as {
      tables: { reviewLog: Record<string, unknown>[] };
    };
    for (const row of legacy.tables.reviewLog) delete row.source;

    const target = createTestDb();
    const result = await restoreUserData(target, legacy);
    expect(result.rowCounts.reviewLog).toBe(1);
    const rows = await target.select().from(reviewLog);
    expect(rows[0]).toMatchObject({ id: 'rl-1', source: null });
  });

  it('review_log.source round-trips through export → restore (T50)', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    expect(payload.tables.reviewLog[0]).toMatchObject({ id: 'rl-1', source: 'flashcard' });

    const target = createTestDb();
    await restoreUserData(target, JSON.parse(JSON.stringify(payload)));
    const rows = await target.select().from(reviewLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe('flashcard');
  });

  it('word_profiles + grammar_lessons round-trip through export → restore (T52)', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    expect(payload.tables.wordProfiles.map((r) => r.id).sort()).toEqual(['wp-cur', 'wp-old']);
    expect(payload.tables.grammarLessons).toHaveLength(1);

    const target = createTestDb();
    const result = await restoreUserData(target, JSON.parse(JSON.stringify(payload)));
    expect(result.rowCounts.wordProfiles).toBe(2);
    expect(result.rowCounts.grammarLessons).toBe(1);
    const profiles = await target.select().from(wordProfiles);
    expect(profiles).toEqual(await source.select().from(wordProfiles));
    const cur = profiles.find((p) => p.id === 'wp-cur')!;
    expect(cur.isCurrent).toBe(true);
    expect(cur.effortApplied).toBe(false);
    expect(cur.payload).toEqual({ v: 1, stub: 'current version', nested: { ok: true } });
    const lessons = await target.select().from(grammarLessons);
    expect(lessons).toEqual(await source.select().from(grammarLessons));
  });

  it('a pre-T52 payload (no wordProfiles / grammarLessons keys) still parses + restores under version 1', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    const legacy = JSON.parse(JSON.stringify(payload)) as { tables: Record<string, unknown> };
    delete legacy.tables.wordProfiles;
    delete legacy.tables.grammarLessons;

    const target = createTestDb();
    const result = await restoreUserData(target, legacy);
    expect(result.rowCounts.wordProfiles).toBe(0);
    expect(result.rowCounts.grammarLessons).toBe(0);
    expect(await target.select().from(wordProfiles)).toHaveLength(0);
    expect(result.rowCounts.bankItems).toBe(2);
  });

  it('scenario_runs + scenario_attempts round-trip through export → restore (T58)', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    expect(payload.tables.scenarioRuns.map((r) => r.id).sort()).toEqual(['srun-1', 'srun-2']);
    expect(payload.tables.scenarioAttempts.map((a) => a.id).sort()).toEqual(['satt-1', 'satt-2']);
    // JSON columns travel as strings, audioFile as-is (bundle-relative).
    expect(typeof payload.tables.scenarioRuns[0]!.pathJson).toBe('string');
    expect(payload.tables.scenarioAttempts.find((a) => a.id === 'satt-2')!.audioFile).toBe(
      'srun-1/satt-2.ogg',
    );

    const target = createTestDb();
    const result = await restoreUserData(target, JSON.parse(JSON.stringify(payload)));
    expect(result.rowCounts.scenarioRuns).toBe(2);
    expect(result.rowCounts.scenarioAttempts).toBe(2);
    // T63: every restored run is `mediaLocal: false` (lazy media) — everything else byte-identical.
    expect(await target.select().from(scenarioRuns)).toEqual(
      (await source.select().from(scenarioRuns)).map((r) => ({ ...r, mediaLocal: false })),
    );
    expect(await target.select().from(scenarioAttempts)).toEqual(
      await source.select().from(scenarioAttempts),
    );
    const run1 = (await target.select().from(scenarioRuns)).find((r) => r.id === 'srun-1')!;
    expect(run1).toMatchObject({ pinned: true, mediaLocal: false, mediaBundleState: 'uploaded' });
    const run2 = (await target.select().from(scenarioRuns)).find((r) => r.id === 'srun-2')!;
    expect(run2.mediaLocal).toBe(false); // was true at the source — restore made it lazy
    // The attempts keep their bundle-relative file names for the lazy download to re-point.
    expect(
      (await target.select().from(scenarioAttempts)).find((a) => a.id === 'satt-2')!.audioFile,
    ).toBe('srun-1/satt-2.ogg');
    expect(JSON.parse(run1.statsJson!)).toMatchObject({ turns: 2, avgScore: 61.5 });
    // The attempts' FK survived the ordered insert (runs before attempts).
    const fk = await target.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM scenario_attempts a LEFT JOIN scenario_runs r ON r.id = a.run_id WHERE r.id IS NULL`,
    );
    expect(fk[0]!.n).toBe(0);
  });

  it('a pre-M17 payload (no scenarioRuns / scenarioAttempts keys) still parses + restores under version 1', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    const legacy = JSON.parse(JSON.stringify(payload)) as { tables: Record<string, unknown> };
    delete legacy.tables.scenarioRuns;
    delete legacy.tables.scenarioAttempts;

    const target = createTestDb();
    const result = await restoreUserData(target, legacy);
    expect(result.rowCounts.scenarioRuns).toBe(0);
    expect(result.rowCounts.scenarioAttempts).toBe(0);
    expect(await target.select().from(scenarioRuns)).toHaveLength(0);
    expect(result.rowCounts.wordProfiles).toBe(2);
  });

  it('exam_attempts + exam_responses + exam_item_cards round-trip through export → restore (T68)', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    expect(payload.tables.examAttempts.map((a) => a.id).sort()).toEqual(['eatt-1', 'eatt-2']);
    expect(payload.tables.examResponses.map((r) => r.id).sort()).toEqual(['eresp-1', 'eresp-2']);
    expect(payload.tables.examItemCards).toHaveLength(2);
    expect(typeof payload.tables.examAttempts[0]!.stateJson).toBe('string');

    const target = createTestDb();
    const result = await restoreUserData(target, JSON.parse(JSON.stringify(payload)));
    expect(result.rowCounts.examAttempts).toBe(2);
    expect(result.rowCounts.examResponses).toBe(2);
    expect(result.rowCounts.examItemCards).toBe(2);
    expect(await target.select().from(examAttempts)).toEqual(
      await source.select().from(examAttempts),
    );
    expect(await target.select().from(examResponses)).toEqual(
      await source.select().from(examResponses),
    );
    expect(await target.select().from(examItemCards)).toEqual(
      await source.select().from(examItemCards),
    );
    // Restored responses still cascade with their attempt (FK intact).
    await target.delete(examAttempts).where(sql`id = 'eatt-1'`);
    expect(await target.select().from(examResponses)).toHaveLength(0);
  });

  it('a pre-M18 payload (no exam keys) still parses + restores under version 1', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    const legacy = JSON.parse(JSON.stringify(payload)) as { tables: Record<string, unknown> };
    delete legacy.tables.examAttempts;
    delete legacy.tables.examResponses;
    delete legacy.tables.examItemCards;

    const target = createTestDb();
    const result = await restoreUserData(target, legacy);
    expect(result.rowCounts.examAttempts).toBe(0);
    expect(result.rowCounts.examResponses).toBe(0);
    expect(result.rowCounts.examItemCards).toBe(0);
    expect(await target.select().from(examAttempts)).toHaveLength(0);
    expect(result.rowCounts.scenarioRuns).toBe(2);
  });

  it('an exam attempt with an out-of-domain status is refused whole (T68)', async () => {
    const source = createTestDb();
    await seedSource(source);
    const { payload } = await exportUserData(source);
    const bad = JSON.parse(JSON.stringify(payload)) as {
      tables: { examAttempts: { status: string }[] };
    };
    bad.tables.examAttempts[0]!.status = 'paused';
    await expect(restoreUserData(createTestDb(), bad)).rejects.toThrow(/examAttempts/);
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
      // T58 scenario content group (rebuilt from packs, never backed up).
      'scenarios',
      'scenario_turns',
      'scenario_glossary',
      'scenario_line_audio',
      'scenario_line_stamps',
      'scenario_assets',
      // T68 exam content table (rebuilt from packs, never backed up).
      'exams',
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
