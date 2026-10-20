import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newId } from '@/db/ids';

import {
  applyPage,
  collectPush,
  createCtx,
  pendingCount,
  rebuildDirtyCards,
  replayCard,
} from '../engine';
import { mergeMonotonic } from '../merge';
import { SPEC_BY_LOCAL } from '../registry';
import { FakeServer } from './fake-server';
import { makePhone } from './phones';
import type { WirePullChange } from '../wire';

type Row = Record<string, unknown>;

describe("FSRS replay matches the app's own grading path (T104 H)", () => {
  it('N gradeCard calls == replayCard over the resulting log (all ratings, long gaps)', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    const item = await A.repos.bank.addWord({
      lemma: 'лес',
      surface: 'лес',
      translation: 'forest',
    });
    const [card] = (await A.repos.reviews.ensureCards(item.item.id)).filter(
      (c) => c.direction === 'ru-en',
    );
    const T = 1_760_000_000_000;
    const ratings = [3, 1, 3, 3, 2, 4, 1, 1, 3, 4, 3, 2];
    let t = T;
    for (const r of ratings) {
      t += r === 1 ? 600_000 : 2 * 86_400_000 + r * 3_600_000;
      await A.repos.reviews.gradeCard(card!.id, r as 1 | 2 | 3 | 4, { now: t });
    }
    const stored = (await A.repos.reviews.getCardById(card!.id))!;
    const log = await A.db.all<{ rating: number; reviewed_at: number }>(
      sql`SELECT rating, reviewed_at FROM review_log WHERE card_id = ${card!.id} ORDER BY reviewed_at`,
    );
    const r = replayCard(stored.createdAt, log)!;
    expect(r).toEqual({
      due_at: stored.dueAt,
      stability: stored.stability,
      difficulty: stored.difficulty,
      elapsed_days: stored.elapsedDays,
      scheduled_days: stored.scheduledDays,
      learning_steps: stored.learningSteps,
      reps: stored.reps,
      lapses: stored.lapses,
      state: stored.state,
      last_review_at: stored.lastReviewAt,
    });
  });

  it('rebuildDirtyCards is idempotent and requeues only when the schedule changed', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    const it1 = await A.repos.bank.addWord({
      lemma: 'река',
      surface: 'река',
      translation: 'river',
    });
    const [c] = (await A.repos.reviews.ensureCards(it1.item.id)).filter(
      (x) => x.direction === 'ru-en',
    );
    await A.repos.reviews.gradeCard(c!.id, 3, { now: 1_760_000_000_000 });
    await A.db.run(sql`INSERT INTO sync_dirty_cards (card_id) VALUES (${c!.id})`);
    await A.db.run(sql`DELETE FROM sync_outbox`);
    expect(await rebuildDirtyCards(A.db)).toBe(0);
    expect(await pendingCount(A.db)).toBe(0);
  });
});

describe('monotonic merges never move backwards', () => {
  const spec = SPEC_BY_LOCAL.get('course_progress')!;
  it('course_progress: max best/attempts, min passed_at (passed_via follows it)', () => {
    const local = {
      key: 'k',
      pack_id: 'p',
      unit_id: 'u',
      best_percent: 60,
      passed_at: 500,
      passed_via: 'course',
      attempts: 2,
      last_attempt_at: 10,
      cooldown_until: null,
      updated_at: 5,
    };
    const remote = {
      ...local,
      best_percent: 90,
      passed_at: 300,
      passed_via: 'extern',
      attempts: 1,
      last_attempt_at: 20,
      cooldown_until: 99,
      updated_at: 9,
    };
    expect(mergeMonotonic(spec, local, remote)).toMatchObject({
      best_percent: 90,
      passed_at: 300,
      passed_via: 'extern',
      attempts: 2,
      last_attempt_at: 20,
      cooldown_until: 99,
      updated_at: 9,
    });
  });
  it('story_progress: null finished_at never beats a real one', () => {
    const s = SPEC_BY_LOCAL.get('story_progress')!;
    const m = mergeMonotonic(
      s,
      { current_sentence_idx: 3, started_at: 9, updated_at: 5, finished_at: null },
      { current_sentence_idx: 1, started_at: 4, updated_at: 7, finished_at: 80 },
    );
    expect(m).toMatchObject({
      current_sentence_idx: 3,
      started_at: 4,
      updated_at: 7,
      finished_at: 80,
    });
  });
});

describe('parking, push shape, and limits', () => {
  it('a child whose parent has not arrived is parked, then applied when the parent lands', async () => {
    const server = new FakeServer();
    const B = await makePhone('B', 'dev-B', server.client());
    const reviewRow: Row = {
      id: 'r1',
      card_id: 'c-missing',
      rating: 3,
      state: 0,
      due_at: 1,
      stability: 1,
      difficulty: 1,
      elapsed_days: 0,
      last_elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reviewed_at: 5,
      duration_ms: null,
      source: null,
    };
    const bank: Row = {
      id: 'b1',
      kind: 'word',
      lemma: 'х',
      lemma_norm: 'х',
      surface: 'х',
      normalized: 'х',
      translation: 'x',
      grammar: null,
      pos: null,
      level: null,
      source_sentence_id: null,
      source_story_id: null,
      note: null,
      needs_enrichment: 0,
      created_at: 1,
    };
    const card: Row = {
      id: 'c-missing',
      bank_item_id: 'b1',
      direction: 'ru-en',
      due_at: 1,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      last_review_at: null,
      suspended_at: null,
      buried_until: null,
      created_at: 1,
    };
    const mk = (tbl: string, pk: string, data: Row, seq: number): WirePullChange => ({
      tbl,
      pk,
      op: 'upsert',
      data,
      hlc: 10 + seq,
      deviceId: 'dev-A',
      seq,
    });
    const ctx = createCtx(B.db, 'dev-B');
    const r1 = await applyPage(ctx, [mk('review_log', '["r1"]', reviewRow, 1)], 1);
    expect(r1.parked).toBe(1);
    expect((await B.db.all(sql`SELECT * FROM sync_parked`)).length).toBe(1);
    const r2 = await applyPage(
      ctx,
      [mk('bank_items', '["b1"]', bank, 2), mk('cards', '["c-missing"]', card, 3)],
      3,
    );
    expect(r2.parked).toBe(0);
    expect(await B.db.all(sql`SELECT * FROM sync_parked`)).toEqual([]);
    expect((await B.db.all(sql`SELECT id FROM review_log`)).length).toBe(1);
    expect(await pendingCount(B.db)).toBe(0); // applied rows never echo
  });

  it('push uses current row data, composite wire pks, own-device daily pk, and coalesces', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    await A.repos.reading.savePosition('p', 's', 1);
    await A.repos.reading.savePosition('p', 's', 4);
    await A.repos.stats.bumpDailyActivity({ xp: 2 }, '2026-10-05');
    await A.repos.stats.logEvent('x', { a: 1 });
    const b = await collectPush(A.db, 'dev-A');
    const sp = b.changes.filter((c) => c.tbl === 'story_progress');
    expect(sp).toHaveLength(1);
    expect(sp[0]!.pk).toBe('["p","s"]');
    expect(sp[0]!.data).toMatchObject({ current_sentence_idx: 4 });
    expect(b.changes.find((c) => c.tbl === 'daily_activity')!.pk).toBe('["2026-10-05","dev-A"]');
    const ev = b.changes.find((c) => c.tbl === 'analytics_events')!;
    expect(ev.pk).toMatch(/^\["dev-A:\d+"\]$/);
    expect(ev.data).not.toHaveProperty('id');
  });

  it('a row deleted before push goes out as a delete', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    const n = await A.repos.journal.createNote({ title: 't', body: 'b' });
    await A.repos.journal.deleteNote(n.id);
    const b = await collectPush(A.db, 'dev-A');
    expect(b.changes).toHaveLength(1);
    expect(b.changes[0]).toMatchObject({ tbl: 'notes', op: 'delete', pk: JSON.stringify([n.id]) });
  });

  it('batches are <= 500 changes and the outbox drains only after acks', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    for (let i = 0; i < 1203; i++) {
      await A.db.run(
        sql`INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (${newId()}, 't', 'b', 1, 1)`,
      );
    }
    const b = await collectPush(A.db, 'dev-A');
    expect(b.changes).toHaveLength(500);
    const s = await A.sync();
    expect(s.pushed).toBe(1203);
    expect(server.pushes).toBe(3);
    expect(await pendingCount(A.db)).toBe(0);
  });

  it('a failed push keeps the outbox intact', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    await A.repos.journal.createNote({ title: 't', body: 'b' });
    server.failNext = { status: 503 };
    await expect(A.sync()).rejects.toMatchObject({ stage: 'push' });
    expect(await pendingCount(A.db)).toBe(1);
    await A.sync();
    expect(await pendingCount(A.db)).toBe(0);
  });

  it('an edit made after a push but before its ack is not lost', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    const n = await A.repos.journal.createNote({ title: 't', body: 'b' });
    const batch = await collectPush(A.db, 'dev-A');
    await A.repos.journal.updateNote(n.id, { body: 'edited mid-push' });
    const { ackPush } = await import('../engine');
    await ackPush(A.db, batch.acks, 'dev-A');
    expect(await pendingCount(A.db)).toBe(1);
  });
});

describe('analytics events sync by sync_key', () => {
  it('pulled events insert once with a fresh local id; own events are not duplicated', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    const B = await makePhone('B', 'dev-B', server.client());
    await A.repos.stats.logEvent('e1', { n: 1 });
    await B.repos.stats.logEvent('e2', { n: 2 });
    for (let i = 0; i < 2; i++) {
      await A.sync();
      await B.sync();
    }
    for (const P of [A, B]) {
      const rows = await P.db.all<{ event: string }>(
        sql`SELECT event FROM analytics_events ORDER BY event`,
      );
      expect(rows.map((r) => r.event)).toEqual(['e1', 'e2']);
    }
    expect(await pendingCount(B.db)).toBe(0);
  });
});

describe('big pull (T104 AC4, unit level)', () => {
  it('applies 20k review_log rows in pages with no per-row network', async () => {
    const server = new FakeServer();
    const A = await makePhone('A', 'dev-A', server.client());
    const B = await makePhone('B', 'dev-B', server.client());
    const it1 = await A.repos.bank.addWord({ lemma: 'мир', surface: 'мир', translation: 'world' });
    const [card] = (await A.repos.reviews.ensureCards(it1.item.id)).filter(
      (c) => c.direction === 'ru-en',
    );
    await A.db.run(sql`BEGIN`);
    for (let i = 0; i < 20_000; i++) {
      await A.db
        .run(sql`INSERT INTO review_log (id, card_id, rating, state, due_at, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, learning_steps, reviewed_at)
        VALUES (${`rl${i}`}, ${card!.id}, 3, 2, 1, 1, 1, 0, 0, 1, 0, ${1_700_000_000_000 + i * 60_000})`);
    }
    await A.db.run(sql`COMMIT`);
    const sa = await A.sync();
    expect(sa.pushed).toBeGreaterThanOrEqual(20_000);
    const pullsBefore = server.pulls;
    const t0 = performance.now();
    const sb = await B.sync();
    const ms = performance.now() - t0;
    console.log(
      `[T104 perf] pulled+applied ${sb.pulled} changes in ${sb.pages} pages, ${ms.toFixed(0)} ms (replay incl.)`,
    );
    expect(sb.pulled).toBeGreaterThanOrEqual(20_002);
    expect(server.pulls - pullsBefore).toBe(sb.pages); // exactly one request per page
    expect((await B.db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM review_log`))[0]!.n).toBe(
      20_000,
    );
    expect(sb.parked).toBe(0);
  }, 120_000);
});
