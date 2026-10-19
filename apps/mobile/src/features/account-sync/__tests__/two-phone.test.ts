import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { SumrakDB } from '@/db/types';

import { pendingCount, readSetting, writeSetting, replayCard } from '../engine';
import { SYNCED_SETTING_KEYS } from '../registry';
import { FakeServer } from './fake-server';
import { makePhone, type Phone } from './phones';

/**
 * T104's heart: two independent databases ("S24U", "S25") with every sync
 * table class edited offline, then converged through an in-memory server that
 * implements the T103 contract exactly. Rows are compared by NATURAL keys
 * where the two phones legitimately hold different ids (same word banked
 * independently).
 */
type Row = Record<string, unknown>;
const q = (db: SumrakDB, query: string) => db.all<Row>(sql.raw(query));

async function canonical(db: SumrakDB): Promise<Record<string, Row[]>> {
  const card = `SELECT b.lemma_norm AS lemma, c.direction, c.due_at, c.stability, c.difficulty, c.elapsed_days,
      c.scheduled_days, c.learning_steps, c.reps, c.lapses, c.state, c.last_review_at, c.suspended_at, c.buried_until, c.created_at AS created_at
      FROM cards c JOIN bank_items b ON b.id = c.bank_item_id ORDER BY lemma, direction`;
  return {
    bank_items: await q(db, `SELECT kind, lemma, lemma_norm, surface, normalized, translation, grammar, pos, level, note, needs_enrichment, created_at FROM bank_items ORDER BY lemma_norm`),
    cards: await q(db, card),
    review_log: await q(db, `SELECT b.lemma_norm AS lemma, c.direction, r.rating, r.state, r.due_at, r.stability, r.difficulty, r.reviewed_at, r.source
      FROM review_log r JOIN cards c ON c.id = r.card_id JOIN bank_items b ON b.id = c.bank_item_id ORDER BY lemma, direction, reviewed_at`),
    encounters: await q(db, `SELECT b.lemma_norm AS lemma, e.surface, e.created_at AS created_at FROM encounters e JOIN bank_items b ON b.id = e.bank_item_id ORDER BY lemma, e.created_at, e.surface`),
    story_progress: await q(db, `SELECT * FROM story_progress ORDER BY pack_id, story_id`),
    notes: await q(db, `SELECT * FROM notes ORDER BY id`),
    achievements: await q(db, `SELECT * FROM achievements ORDER BY id`),
    daily_activity: await q(db, `SELECT * FROM daily_activity ORDER BY date`),
    settings: await q(db, `SELECT key, value FROM settings WHERE key IN (${[...SYNCED_SETTING_KEYS].map((k) => `'${k}'`).join(',')}) ORDER BY key`),
    game_sessions: await q(db, `SELECT * FROM game_sessions ORDER BY id`),
  };
}

async function converge(a: Phone, b: Phone, maxRounds = 6) {
  for (let i = 0; i < maxRounds; i++) {
    const s = [await a.sync(), await b.sync(), await a.sync()];
    const quiet = (await pendingCount(a.db)) === 0 && (await pendingCount(b.db)) === 0;
    if (quiet && s[2]!.pushed === 0 && s[2]!.rebuiltCards === 0) return i + 1;
  }
  throw new Error('did not quiesce');
}

describe('two phones converge through the T103 contract', () => {
  it('independent edits across every class end identical on both phones', async () => {
    const server = new FakeServer();
    const A = await makePhone('S24U', 'dev-A', server.client());
    const B = await makePhone('S25', 'dev-B', server.client());
    const T0 = 1_760_000_000_000;
    const DAY = '2026-10-01';

    // 1. SAME lemma banked independently (natural-key collision), cards graded on both.
    const addA = await A.repos.bank.addWord({ lemma: 'тень', surface: 'тени', translation: 'shadow', sentenceId: 's1' });
    const addB = await B.repos.bank.addWord({ lemma: 'тень', surface: 'тенью', translation: 'shadow (B)', sentenceId: 's2' });
    expect(addA.item.id).not.toBe(addB.item.id);
    const cardA = (await A.repos.reviews.ensureCards(addA.item.id)).find((c) => c.direction === 'ru-en')!;
    const cardB = (await B.repos.reviews.ensureCards(addB.item.id)).find((c) => c.direction === 'ru-en')!;
    await A.repos.reviews.gradeCard(cardA.id, 3, { now: T0 + 1_000, source: 'flashcard' });
    await A.repos.reviews.gradeCard(cardA.id, 3, { now: T0 + 5 * 86_400_000, source: 'flashcard' });
    await B.repos.reviews.gradeCard(cardB.id, 1, { now: T0 + 2_000, source: 'mc' });
    await B.repos.reviews.gradeCard(cardB.id, 3, { now: T0 + 3 * 86_400_000, source: 'mc' });
    await B.repos.reviews.gradeCard(cardB.id, 4, { now: T0 + 9 * 86_400_000, source: 'mc' });

    // 2. A bank item created on A, synced, then edited on BOTH offline (later edit wins).
    const dom = await A.repos.bank.addWord({ lemma: 'дом', surface: 'дом', translation: 'house' });
    await A.sync();
    await B.sync();
    await A.repos.bank.updateItem(dom.item.id, { translation: 'house (A edit)' });
    await new Promise((r) => setTimeout(r, 5));
    const bDom = (await B.repos.bank.findWordByLemma('дом'))!;
    await B.repos.bank.updateItem(bDom.id, { translation: 'home (B edit, later)', note: 'B note' });

    // 3. Reading progress on the same story to different points.
    await A.repos.reading.savePosition('pack-1', 'story-1', 5);
    await B.repos.reading.savePosition('pack-1', 'story-1', 9);
    await A.repos.reading.savePosition('pack-2', 'story-9', 3);

    // 4. A note created on A, synced to B, deleted on B.
    const note = await A.repos.journal.createNote({ title: 'bye', body: 'x' });
    const keep = await A.repos.journal.createNote({ title: 'keep', body: 'y' });
    await A.sync();
    await B.sync();
    expect(await B.repos.journal.getNote(note.id)).not.toBeNull();
    await B.repos.journal.deleteNote(note.id);

    // 5. Daily activity: A hits the goal, B adds reviews the same day.
    await A.repos.stats.bumpDailyActivity({ reviewsDone: 20, xp: 100, readingMs: 60_000 }, DAY);
    await A.repos.stats.markGoalMet(DAY);
    await B.repos.stats.bumpDailyActivity({ reviewsDone: 7, xp: 30, storiesFinished: 1 }, DAY);

    // 6. Achievement unlocked on both at different times (min wins).
    await A.db.run(sql`INSERT INTO achievements (id, unlocked_at) VALUES ('first-word', ${T0 + 500})`);
    await B.db.run(sql`INSERT INTO achievements (id, unlocked_at) VALUES ('first-word', ${T0 + 100})`);
    await A.db.run(sql`INSERT INTO achievements (id, unlocked_at) VALUES ('streak-3', ${T0 + 900})`);

    // 7. Settings: a synced key on A, a DEVICE-LOCAL key different on each.
    await A.repos.settings.set('goal.daily', { reviews: 30, readingMin: 15 });
    await A.repos.settings.set('themeMode', 'dark');
    await B.repos.settings.set('themeMode', 'light');
    await A.repos.settings.set('sync.serverUrl', 'https://a.example');

    // Offline edits are all queued; nothing synced yet.
    expect(await pendingCount(A.db)).toBeGreaterThan(2);

    const rounds = await converge(A, B);
    expect(rounds).toBeLessThanOrEqual(3);

    // ---- assertions
    const ca = await canonical(A.db);
    const cb = await canonical(B.db);
    for (const t of Object.keys(ca)) expect({ t, rows: ca[t] }).toEqual({ t, rows: cb[t] });

    // Both reviews' logs merged on both; card schedule == replay of the merged log.
    expect(ca.review_log).toHaveLength(5);
    const tenA = (await q(A.db, `SELECT c.created_at, c.id FROM cards c JOIN bank_items b ON b.id=c.bank_item_id WHERE b.lemma_norm='тень' AND c.direction='ru-en'`))[0]!;
    const merged = await q(A.db, `SELECT rating, reviewed_at FROM review_log WHERE card_id='${tenA.id}' ORDER BY reviewed_at`);
    const want = replayCard(tenA.created_at as number, merged as never)!;
    const got = (await q(A.db, `SELECT due_at, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review_at FROM cards WHERE id='${tenA.id}'`))[0]!;
    expect(got).toEqual(want);
    expect(got.reps).toBe(5);
    expect(ca.encounters.filter((e) => e.lemma === 'тень')).toHaveLength(2);

    // LWW: the later edit won everywhere, field-complete.
    expect(ca.bank_items.find((r) => r.lemma_norm === 'дом')).toMatchObject({
      translation: 'home (B edit, later)',
      note: 'B note',
    });
    // Monotonic.
    expect(ca.story_progress).toEqual([
      expect.objectContaining({ pack_id: 'pack-1', story_id: 'story-1', current_sentence_idx: 9 }),
      expect.objectContaining({ pack_id: 'pack-2', story_id: 'story-9', current_sentence_idx: 3 }),
    ]);
    expect(ca.achievements).toEqual([
      { id: 'first-word', unlocked_at: T0 + 100 },
      { id: 'streak-3', unlocked_at: T0 + 900 },
    ]);
    // Tombstone applied on A; the other note survives.
    expect(ca.notes.map((n) => n.id)).toEqual([keep.id]);
    // Daily activity = own + peers on BOTH phones; goal-met from A.
    expect(ca.daily_activity).toEqual([
      expect.objectContaining({ date: DAY, reviews_done: 27, xp: 130, reading_ms: 60_000, stories_finished: 1 }),
    ]);
    expect(ca.daily_activity[0]!.goal_met_at).toBeTypeOf('number');
    const peersB = await q(B.db, `SELECT device_id, reviews_done FROM daily_activity_peers`);
    expect(peersB).toEqual([{ device_id: 'dev-A', reviews_done: 20 }]);
    // Settings: synced key crossed, device-local keys untouched.
    expect(await readSetting(B.db, 'goal.daily')).toEqual({ reviews: 30, readingMin: 15 });
    expect(await readSetting(A.db, 'themeMode')).toBe('dark');
    expect(await readSetting(B.db, 'themeMode')).toBe('light');
    expect(await readSetting(B.db, 'sync.serverUrl')).toBeNull();
    expect([...server.records.values()].some((r) => r.pk.includes('themeMode') || r.pk.includes('sync.'))).toBe(false);
    // Nothing parked, nothing pending, no cursor leak into the synced set.
    expect(await q(A.db, 'SELECT * FROM sync_parked')).toEqual([]);
    expect(await q(B.db, 'SELECT * FROM sync_parked')).toEqual([]);
    expect(await q(B.db, 'SELECT * FROM sync_outbox')).toEqual([]);
    expect(await readSetting(A.db, 'sync.cursor')).toBe(server.seq);
    // The two ids for the same word stayed distinct but mapped.
    expect((await q(B.db, `SELECT COUNT(*) AS n FROM sync_id_map WHERE tbl='bank_items'`))[0]!.n).toBeGreaterThan(0);
  });

  it('a second round of edits keeps converging (mapped ids keep working)', async () => {
    const server = new FakeServer();
    const A = await makePhone('S24U', 'dev-A', server.client());
    const B = await makePhone('S25', 'dev-B', server.client());
    await A.repos.bank.addWord({ lemma: 'ночь', surface: 'ночь', translation: 'night' });
    await B.repos.bank.addWord({ lemma: 'ночь', surface: 'ночью', translation: 'night' });
    await converge(A, B);
    // Edit on B (whose id is the one A mapped), then delete on A.
    const bn = (await B.repos.bank.findWordByLemma('ночь'))!;
    await new Promise((r) => setTimeout(r, 3));
    await B.repos.bank.updateItem(bn.id, { translation: 'night, evening' });
    await converge(A, B);
    expect((await A.repos.bank.findWordByLemma('ночь'))!.translation).toBe('night, evening');
    await A.repos.bank.deleteItem((await A.repos.bank.findWordByLemma('ночь'))!.id);
    await converge(A, B);
    expect(await B.repos.bank.findWordByLemma('ночь')).toBeNull();
    expect(await q(B.db, 'SELECT * FROM cards')).toEqual([]);
    expect(await q(B.db, 'SELECT * FROM sync_parked')).toEqual([]);
  });
});
