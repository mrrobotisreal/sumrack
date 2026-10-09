import { describe, expect, it } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';
import {
  dailyActivity,
  dailyQuests,
  gameSessions,
  journalEntries,
  storyProgress,
} from '@/db/schema';
import type { SumrakDB } from '@/db/types';
import { seedStory } from '@/features/review/games/__tests__/seed';
import { addDaysToKey, localDayWindow } from '@/lib/dates';

import { evaluateQuest, previewQuestRotation, type QuestEnv } from '../quest-service';
import {
  availableKinds,
  hashDayKey,
  pickQuestKind,
  QUEST_KINDS,
  type QuestContext,
  type QuestKindId,
} from '../quests';

/**
 * T34 — the daily quest slot: the pure rotation rule, the registry's
 * availability gates, and the DB-backed service across injected day keys
 * (the T19 date-injection pattern): assignment once per day, no repeat of
 * yesterday's kind when > 2 are available, unavailable kinds never assigned,
 * completion → XP once and NEVER goal_met_at.
 */

const ALL: QuestKindId[] = QUEST_KINDS.map((k) => k.id);

function ctx(over: Partial<QuestContext> = {}): QuestContext {
  return {
    unfinishedStories: 0,
    asrInstalled: false,
    productionCards: 0,
    dictationAvailable: false,
    blitzPoolSize: 0,
    visibleLeechIds: [],
    today: {
      storiesFinished: 0,
      pronunciationGrades: 0,
      journalEntries: 0,
      dictationSessions: 0,
      blitzSprints: 0,
      numbersRounds: 0,
    },
    ...over,
  };
}

describe('rotation rule (pure)', () => {
  it('is deterministic per day key', () => {
    expect(hashDayKey('2026-10-09')).toBe(hashDayKey('2026-10-09'));
    expect(pickQuestKind('2026-10-09', ALL, null)).toBe(pickQuestKind('2026-10-09', ALL, null));
  });

  it('never repeats yesterday when > 2 kinds are available', () => {
    let day = '2026-01-01';
    let yesterday: string | null = null;
    for (let i = 0; i < 120; i++) {
      const kind = pickQuestKind(day, ALL, yesterday);
      expect(kind).not.toBeNull();
      expect(kind).not.toBe(yesterday);
      yesterday = kind;
      day = addDaysToKey(day, 1);
    }
  });

  it('allows a repeat with 1–2 kinds available; none → null', () => {
    expect(pickQuestKind('2026-10-09', ['journal-1'], 'journal-1')).toBe('journal-1');
    const two: QuestKindId[] = ['journal-1', 'numbers-round'];
    // With two available yesterday's kind stays a candidate.
    const picks = new Set<string>();
    let day = '2026-01-01';
    for (let i = 0; i < 30; i++) {
      picks.add(pickQuestKind(day, two, 'journal-1')!);
      day = addDaysToKey(day, 1);
    }
    expect(picks).toEqual(new Set(two));
    expect(pickQuestKind('2026-10-09', [], null)).toBeNull();
  });

  it('spreads over every kind across a month', () => {
    const seen = new Set<string>();
    let day = '2026-10-01';
    let y: string | null = null;
    for (let i = 0; i < 60; i++) {
      y = pickQuestKind(day, ALL, y);
      seen.add(y!);
      day = addDaysToKey(day, 1);
    }
    expect(seen).toEqual(new Set(ALL));
  });
});

describe('availability gates (registry)', () => {
  it('baseline: only journal + numbers are always available', () => {
    expect(availableKinds(ctx())).toEqual(['journal-1', 'numbers-round']);
  });

  it('each gated kind needs its prerequisite', () => {
    expect(availableKinds(ctx({ unfinishedStories: 1 }))).toContain('finish-a-story');
    expect(availableKinds(ctx({ asrInstalled: true }))).not.toContain('pronunciation-5');
    expect(availableKinds(ctx({ productionCards: 3 }))).not.toContain('pronunciation-5');
    expect(availableKinds(ctx({ asrInstalled: true, productionCards: 3 }))).toContain(
      'pronunciation-5',
    );
    expect(availableKinds(ctx({ blitzPoolSize: 5 }))).not.toContain('match-blitz');
    expect(availableKinds(ctx({ blitzPoolSize: 6 }))).toContain('match-blitz');
    expect(availableKinds(ctx({ visibleLeechIds: ['c1'] }))).toContain('clear-leeches');
    // T33 not shipped → dictation never available.
    expect(availableKinds(ctx())).not.toContain('dictation-set');
    expect(availableKinds(ctx({ dictationAvailable: true }))).toContain('dictation-set');
  });
});

// --- DB-backed service ------------------------------------------------------

function makeEnv(
  repos: ReturnType<typeof createRepositories>,
  over: Partial<Omit<QuestEnv, 'repos'>> & { leeches?: string[] } = {},
): QuestEnv {
  return {
    repos,
    asrInstalled: over.asrInstalled ?? (() => false),
    dictationAvailable: over.dictationAvailable ?? (() => false),
    visibleLeechIds: over.visibleLeechIds ?? (async () => over.leeches ?? []),
    blitzPoolSize: over.blitzPoolSize ?? (async () => 0),
    now: over.now,
  };
}

/** A game_sessions row ended inside `day` (noon local). */
async function finishSession(db: SumrakDB, mode: string, day: string, completed: boolean) {
  const t = localDayWindow(day).start + 12 * 3_600_000;
  await db.insert(gameSessions).values({
    id: `${mode}-${day}-${Math.random()}`,
    mode,
    startedAt: t - 60_000,
    endedAt: t,
    itemCount: 10,
    correctCount: 10,
    detail: { completed },
  });
}

describe('evaluateQuest (DB, injected day keys)', () => {
  it('assigns once per day, persists, rotates ≥ 3 days without repeating yesterday', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedStory(db, {
      packId: 'p',
      storyId: 's',
      sentences: [{ id: 's1', ru: 'дом', en: 'house', lemmas: ['дом'] }],
    });
    const env = makeEnv(repos, { blitzPoolSize: async () => 10 });
    // Four always/now-available kinds: finish-a-story, journal, blitz, numbers.
    let day = '2026-10-09';
    const kinds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const first = await evaluateQuest(env, day);
      expect(first.assigned).toBe(true);
      const again = await evaluateQuest(env, day);
      expect(again.assigned).toBe(false);
      expect(again.state!.kind.id).toBe(first.state!.kind.id);
      expect(first.available).toBe(4);
      kinds.push(first.state!.kind.id);
      day = addDaysToKey(day, 1);
    }
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
    expect(await db.select().from(dailyQuests)).toHaveLength(5);
    // Never an unavailable kind (no ASR, no leeches, no dictation).
    for (const k of kinds) {
      expect(['finish-a-story', 'journal-1', 'match-blitz', 'numbers-round']).toContain(k);
    }
  });

  it('no unfinished stories ⇒ never finish-a-story; no kinds ⇒ no quest', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await seedStory(db, {
      packId: 'p',
      storyId: 's',
      sentences: [{ id: 's1', ru: 'дом', en: 'house', lemmas: ['дом'] }],
    });
    await repos.reading.markFinished('p', 's');
    const env = makeEnv(repos);
    let day = '2026-03-01';
    for (let i = 0; i < 40; i++) {
      const res = await evaluateQuest(env, day);
      expect(res.state!.kind.id).not.toBe('finish-a-story');
      day = addDaysToKey(day, 1);
    }
  });

  it('completion: XP once, toast flag once, goal_met_at NEVER set', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const day = '2026-10-09';
    // Force the journal kind: it is the only… make it the pick by pre-seeding the row.
    await repos.quests.assign({
      date: day,
      kind: 'journal-1',
      target: 1,
      snapshot: null,
      assignedAt: 1,
    });
    const env = makeEnv(repos);
    const before = await evaluateQuest(env, day);
    expect(before.state).toMatchObject({ progress: 0, target: 1, complete: false });

    const noon = localDayWindow(day).start + 12 * 3_600_000;
    await db.insert(journalEntries).values({
      id: 'j1',
      ru: 'Привет',
      feedbackStatus: 'none',
      createdAt: noon,
      updatedAt: noon,
    });
    const done = await evaluateQuest(env, day);
    expect(done.justCompleted).toBe(true);
    expect(done.state).toMatchObject({ complete: true, progress: 1 });
    const again = await evaluateQuest(env, day);
    expect(again.justCompleted).toBe(false);

    const [act] = await db.select().from(dailyActivity);
    expect(act).toMatchObject({ date: day, xp: 15, reviewsDone: 0, goalMetAt: null });
    const [row] = await db.select().from(dailyQuests);
    expect(row).toMatchObject({ xp: 15, progress: 1 });
    expect(row!.completedAt).not.toBeNull();
    expect((await repos.stats.getStreakDays()).met.size).toBe(0);
  });

  it('match-blitz and numbers complete only off FULL sessions of today', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const day = '2026-10-10';
    for (const kind of ['match-blitz', 'numbers-round'] as const) {
      await db.delete(dailyQuests);
      await db.delete(gameSessions);
      await repos.quests.assign({ date: day, kind, target: 1, snapshot: null, assignedAt: 1 });
      const env = makeEnv(repos, { blitzPoolSize: async () => 10 });
      const mode = kind === 'match-blitz' ? 'match-blitz' : 'numbers';
      await finishSession(db, mode, addDaysToKey(day, -1), true); // yesterday
      await finishSession(db, mode, day, false); // quit today
      expect((await evaluateQuest(env, day)).state!.complete).toBe(false);
      await finishSession(db, mode, day, true);
      const res = await evaluateQuest(env, day);
      expect(res.justCompleted).toBe(true);
    }
  });

  it('dictation-set completes off a real dictation session once T33 enables it', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const day = '2026-10-11';
    await repos.quests.assign({
      date: day,
      kind: 'dictation-set',
      target: 1,
      snapshot: null,
      assignedAt: 1,
    });
    const env = makeEnv(repos, { dictationAvailable: () => true });
    expect((await evaluateQuest(env, day)).state!.complete).toBe(false);
    await finishSession(db, 'dictation', day, true);
    expect((await evaluateQuest(env, day)).justCompleted).toBe(true);
  });

  it('pronunciation-5 counts today’s pronunciation grades (progress persisted)', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const { item } = await repos.bank.addWord({
      lemma: 'дом',
      surface: 'дом',
      translation: 'house',
    });
    const card = await repos.reviews.getCard(item.id, 'production');
    expect(card).not.toBeNull();
    const day = '2026-10-12';
    await repos.quests.assign({
      date: day,
      kind: 'pronunciation-5',
      target: 5,
      snapshot: null,
      assignedAt: 1,
    });
    const env = makeEnv(repos, { asrInstalled: () => true });
    const noon = localDayWindow(day).start + 12 * 3_600_000;
    for (let i = 0; i < 3; i++) {
      await repos.reviews.gradeCard(card!.id, 3, { now: noon + i * 1000, source: 'pronunciation' });
    }
    const mid = await evaluateQuest(env, day);
    expect(mid.state).toMatchObject({ progress: 3, target: 5, complete: false });
    expect(mid.progressed).toBe(true);
    expect((await repos.quests.get(day))!.progress).toBe(3);
    for (let i = 3; i < 5; i++) {
      await repos.reviews.gradeCard(card!.id, 3, { now: noon + i * 1000, source: 'pronunciation' });
    }
    expect((await evaluateQuest(env, day)).justCompleted).toBe(true);
  });

  it('clear-leeches snapshots the flagged ids at assignment; later leeches never extend it', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    let visible = ['c1', 'c2'];
    // Only leeches + the always-on kinds: find a day whose pick is clear-leeches.
    const env = makeEnv(repos, { visibleLeechIds: async () => visible });
    let day = '2026-10-01';
    for (let i = 0; i < 60; i++) {
      await db.delete(dailyQuests);
      const res = await evaluateQuest(env, day);
      if (res.state!.kind.id === 'clear-leeches') break;
      day = addDaysToKey(day, 1);
    }
    const row = await repos.quests.get(day);
    expect(row).toMatchObject({ kind: 'clear-leeches', target: 2, snapshot: ['c1', 'c2'] });

    visible = ['c2', 'c3']; // c1 cleared, c3 new
    expect((await evaluateQuest(env, day)).state).toMatchObject({ progress: 1, target: 2 });
    visible = ['c3'];
    const done = await evaluateQuest(env, day);
    expect(done.justCompleted).toBe(true);
    expect(done.state!.complete).toBe(true);
  });

  it('an unknown persisted kind renders nothing and never throws', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    await repos.quests.assign({
      date: '2026-10-09',
      kind: 'from-the-future',
      target: 1,
      snapshot: null,
      assignedAt: 1,
    });
    const res = await evaluateQuest(makeEnv(repos), '2026-10-09');
    expect(res.state).toBeNull();
    expect(await db.select().from(storyProgress)).toHaveLength(0);
  });
});

describe('previewQuestRotation (dev-db, read-only)', () => {
  it('chains the rule over injected days and writes no quest rows', async () => {
    const db = createTestDb();
    const repos = createRepositories(db);
    const env = makeEnv(repos, { blitzPoolSize: async () => 10 });
    const res = await previewQuestRotation(env, '2026-10-09', 7);
    expect(res.available).toEqual(['journal-1', 'match-blitz', 'numbers-round']);
    expect(res.days).toHaveLength(7);
    for (let i = 1; i < 7; i++) expect(res.days[i]!.kind).not.toBe(res.days[i - 1]!.kind);
    // Day 1 of the preview = what evaluateQuest assigns for that day.
    expect(await db.select().from(dailyQuests)).toHaveLength(0);
    const real = await evaluateQuest(env, '2026-10-09');
    expect(real.state!.kind.id).toBe(res.days[0]!.kind);
  });
});
