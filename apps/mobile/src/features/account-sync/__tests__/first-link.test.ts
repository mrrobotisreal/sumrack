import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { readSetting } from '../engine';
import { linkDevice, linkModeFor, seedOutbox } from '../first-link';
import { FakeServer } from './fake-server';
import { makePhone } from './phones';

/**
 * T105 first link: a phone with history made BEFORE migration 0023 (no
 * outbox rows for it) must still get all of it to the account, and a second
 * phone with its own history must merge rather than overwrite.
 */
async function count(db: Parameters<typeof seedOutbox>[0], table: string): Promise<number> {
  return (await db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table}`)))[0]!.n;
}

describe('T105 first link', () => {
  it('seed: pre-existing history (no outbox rows) reaches the server and a fresh second phone', async () => {
    const server = new FakeServer();
    const s24u = await makePhone('S24U', 'dev-s24u', server.client());
    // History written "before 0023": triggers muted, so nothing is in the outbox.
    await s24u.db.run(sql`UPDATE sync_control SET applying = 1`);
    const word = await s24u.repos.bank.addWord({
      lemma: 'тьма',
      surface: 'тьма',
      translation: 'darkness',
    });
    const card = (await s24u.repos.reviews.ensureCards(word.item.id)).find(
      (c) => c.direction === 'ru-en',
    )!;
    await s24u.repos.reviews.gradeCard(card.id, 3, {
      now: Date.now() - 86_400_000,
      source: 'flashcard',
    });
    await s24u.repos.reading.savePosition('pack-1', 'story-1', 7);
    await s24u.repos.stats.bumpDailyActivity({ reviewsDone: 4, xp: 40 });
    await s24u.db.run(sql`UPDATE sync_control SET applying = 0`);
    expect(await count(s24u.db, 'sync_outbox')).toBe(0);

    expect(linkModeFor({ recordCount: 0 })).toBe('seed');
    const { seeded } = await linkDevice(s24u.db, 'uid-mitch');
    expect(seeded).toBeGreaterThan(5);
    expect(await readSetting<boolean>(s24u.db, 'sync.linked')).toBe(true);
    await s24u.sync();
    expect(await count(s24u.db, 'sync_outbox')).toBe(0);

    // Relinking the same account never re-seeds.
    expect(await linkDevice(s24u.db, 'uid-mitch')).toEqual({ seeded: 0, already: true });

    const s25 = await makePhone('S25', 'dev-s25', server.client());
    expect(linkModeFor({ recordCount: 5 })).toBe('merge');
    await linkDevice(s25.db, 'uid-mitch');
    await s25.sync();

    expect(await s25.repos.bank.findWordByLemma('тьма')).not.toBeNull();
    expect(await count(s25.db, 'review_log')).toBe(1);
    const prog = await s25.db.all<{ i: number }>(
      sql`SELECT current_sentence_idx AS i FROM story_progress WHERE pack_id = 'pack-1'`,
    );
    expect(prog[0]!.i).toBe(7);
    const day = await s25.db.all<{ r: number; xp: number }>(
      sql`SELECT reviews_done AS r, xp FROM daily_activity`,
    );
    expect(day[0]).toEqual({ r: 4, xp: 40 });
  });

  it('merge: a second phone with its OWN pre-existing history keeps it and gains the account history', async () => {
    const server = new FakeServer();
    const a = await makePhone('S24U', 'dev-a', server.client());
    const b = await makePhone('S25', 'dev-b', server.client());
    for (const p of [a, b]) await p.db.run(sql`UPDATE sync_control SET applying = 1`);
    await a.repos.bank.addWord({ lemma: 'дом', surface: 'дом', translation: 'house' });
    await a.repos.reading.savePosition('pack-1', 'story-1', 3);
    await b.repos.bank.addWord({ lemma: 'дом', surface: 'дом', translation: 'house' }); // same lemma
    await b.repos.bank.addWord({ lemma: 'ночь', surface: 'ночь', translation: 'night' });
    await b.repos.reading.savePosition('pack-1', 'story-1', 9);
    for (const p of [a, b]) await p.db.run(sql`UPDATE sync_control SET applying = 0`);

    await linkDevice(a.db, 'uid');
    await a.sync();
    await linkDevice(b.db, 'uid');
    await b.sync();
    await a.sync();

    for (const p of [a, b]) {
      const words = await p.db.all<{ l: string }>(
        sql`SELECT lemma AS l FROM bank_items ORDER BY lemma`,
      );
      expect(words.map((w) => w.l)).toEqual(['дом', 'ночь']); // collapsed, nothing lost
      const prog = await p.db.all<{ i: number }>(
        sql`SELECT current_sentence_idx AS i FROM story_progress`,
      );
      expect(prog[0]!.i).toBe(9); // furthest point wins
    }
  });

  it('never seeds device-local settings or sync bookkeeping', async () => {
    const server = new FakeServer();
    const p = await makePhone('S24U', 'dev-x', server.client());
    await p.db.run(sql`UPDATE sync_control SET applying = 1`);
    await p.repos.settings.set('themeMode', 'dark');
    await p.repos.settings.set('backup.syncd', { host: 'x' });
    await p.db.run(sql`UPDATE sync_control SET applying = 0`);
    await seedOutbox(p.db);
    const keys = await p.db.all<{ pk: string }>(
      sql`SELECT pk FROM sync_outbox WHERE tbl = 'settings'`,
    );
    const flat = keys.map((k) => JSON.parse(k.pk)[0] as string);
    expect(flat.some((k) => k.startsWith('sync.') || k.startsWith('auth.'))).toBe(false);
    expect(flat).not.toContain('backup.syncd');
  });
});

describe('T105 account switch (Mitch, 2026-10-20)', () => {
  it('linked under the wrong account, partly synced, then signed in with the right one → the right account gets EVERYTHING', async () => {
    const wrong = new FakeServer();
    const right = new FakeServer();
    const p = await makePhone('S24U', 'dev-s24u', wrong.client());
    await p.db.run(sql`UPDATE sync_control SET applying = 1`);
    for (const l of ['тьма', 'ночь', 'дом']) {
      await p.repos.bank.addWord({ lemma: l, surface: l, translation: 'x' });
    }
    await p.repos.reading.savePosition('pack-1', 'story-1', 6);
    await p.db.run(sql`UPDATE sync_control SET applying = 0`);

    // Linked + fully synced to the WRONG (test) account.
    await linkDevice(p.db, 'uid-test');
    await p.sync();
    expect(await count(p.db, 'sync_outbox')).toBe(0);

    // Signs in with the real account: the orchestrator detects the switch.
    const { relinkForAccount } = await import('../first-link');
    const reseeded = await relinkForAccount(p.db, 'uid-real');
    expect(reseeded).toBeGreaterThan(5);
    expect(await readSetting<number>(p.db, 'sync.cursor')).toBeNull();
    expect(await readSetting<string>(p.db, 'sync.linkedUid')).toBe('uid-real');

    const { runSync } = await import('../run');
    await runSync(p.db, right.client(), 'dev-s24u');

    // A fresh phone on the RIGHT account sees all of it; local data untouched.
    const s25 = await makePhone('S25', 'dev-s25', right.client());
    await linkDevice(s25.db, 'uid-real', Date.now(), 'merge');
    await s25.sync();
    const words = await s25.db.all<{ l: string }>(
      sql`SELECT lemma AS l FROM bank_items ORDER BY lemma`,
    );
    expect(words.map((w) => w.l)).toEqual(['дом', 'ночь', 'тьма']);
    expect(await count(p.db, 'bank_items')).toBe(3);
    const prog = await s25.db.all<{ i: number }>(
      sql`SELECT current_sentence_idx AS i FROM story_progress`,
    );
    expect(prog[0]!.i).toBe(6);
  });
});

describe('T105 second-phone seed never overwrites the account (2026-10-20 S25 regression)', () => {
  it('older copies of LWW rows on the linking phone lose; rows the account lacks still arrive', async () => {
    const server = new FakeServer();
    const a = await makePhone('S24U', 'dev-a', server.client());
    const b = await makePhone('S25', 'dev-b', server.client());
    for (const p of [a, b]) await p.db.run(sql`UPDATE sync_control SET applying = 1`);
    await a.repos.settings.set('ai.model', 'anthropic/claude-opus-5');
    await a.db
      .run(sql`INSERT INTO daily_quests (date, kind, target, progress, snapshot, assigned_at, completed_at, xp)
      VALUES ('2026-10-12', 'journal-1', 1, 1, '{}', 1, 2, 15)`);
    await b.repos.settings.set('ai.model', 'anthropic/claude-sonnet-5'); // stale S25 value
    await b.db
      .run(sql`INSERT INTO daily_quests (date, kind, target, progress, snapshot, assigned_at, completed_at, xp)
      VALUES ('2026-10-12', 'numbers-round', 1, 0, '{}', 1, NULL, 0)`);
    await b.db
      .run(sql`INSERT INTO daily_quests (date, kind, target, progress, snapshot, assigned_at, completed_at, xp)
      VALUES ('2026-10-20', 'journal-1', 1, 0, '{}', 1, NULL, 0)`); // only the S25 has today
    for (const p of [a, b]) await p.db.run(sql`UPDATE sync_control SET applying = 0`);

    await linkDevice(a.db, 'uid', Date.now(), 'seed');
    await a.sync();
    await linkDevice(b.db, 'uid', Date.now(), linkModeFor({ recordCount: server.recordCount() }));
    await b.sync();
    await a.sync();

    for (const p of [a, b]) {
      expect(await readSetting<string>(p.db, 'ai.model')).toBe('anthropic/claude-opus-5');
      const q = await p.db.all<{ date: string; kind: string; xp: number }>(
        sql`SELECT date, kind, xp FROM daily_quests ORDER BY date`,
      );
      expect(q).toEqual([
        { date: '2026-10-12', kind: 'journal-1', xp: 15 },
        { date: '2026-10-20', kind: 'journal-1', xp: 0 },
      ]);
    }
  });
});
