import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { HttpSyncClient } from '../client';
import { pendingCount, readSetting } from '../engine';
import { makePhone } from './phones';

/**
 * Opt-in live suite (T104 K): the REAL HttpSyncClient + engine against a REAL
 * SumrakAPI. Skipped unless SUMRAK_SYNC_IT_URL and SUMRAK_SYNC_IT_TOKEN are
 * set. Local recipe (throwaway everything, nothing touches production):
 *   createdb sumrak_t104_it_$$
 *   (cd SumrakAPI && go build -tags dev -o /tmp/syncd-dev ./cmd/syncd ./cmd/devtoken)
 *   go run -tags dev ./cmd/devtoken  -> prints a token, serves certs on :9099
 *   SYNCD_TOKEN=<16+ chars> SYNCD_ADDR=127.0.0.1:18687 SYNCD_DATA_DIR=/tmp/x \
 *   SYNCD_DATABASE_URL=postgres:///sumrak_t104_it_$$ SYNCD_FIREBASE_PROJECT_ID=sumrak-dev \
 *   SYNCD_DEV_CERTS_URL=http://127.0.0.1:9099/certs /tmp/syncd-dev
 *   SUMRAK_SYNC_IT_URL=http://127.0.0.1:18687 SUMRAK_SYNC_IT_TOKEN=<devtoken> pnpm vitest run live-server
 */
const URL = process.env.SUMRAK_SYNC_IT_URL;
const TOKEN = process.env.SUMRAK_SYNC_IT_TOKEN;

describe.skipIf(!URL || !TOKEN)('live server round trip', () => {
  const mk = () => new HttpSyncClient({ baseUrl: URL!, token: async () => TOKEN! });

  it('registers devices, pushes, pulls, merges and converges two phones', async () => {
    const A = await makePhone('A', 'it-dev-A', mk());
    const B = await makePhone('B', 'it-dev-B', mk());
    const c = mk();
    const me0 = await c.registerDevice({
      deviceId: 'it-dev-A',
      name: 'A',
      model: 'A',
      appVersion: 'it',
    });
    expect(me0.uid).toBeTruthy();
    await c.registerDevice({ deviceId: 'it-dev-B', name: 'B', model: 'B', appVersion: 'it' });
    expect((await c.me()).deviceCount).toBeGreaterThanOrEqual(2);

    // Same word on both, graded on both; progress; a note deleted; daily split.
    const ia = await A.repos.bank.addWord({
      lemma: 'огонь',
      surface: 'огонь',
      translation: 'fire',
    });
    const ib = await B.repos.bank.addWord({
      lemma: 'огонь',
      surface: 'огнём',
      translation: 'fire',
    });
    const ca = (await A.repos.reviews.ensureCards(ia.item.id)).find(
      (x) => x.direction === 'ru-en',
    )!;
    const cb = (await B.repos.reviews.ensureCards(ib.item.id)).find(
      (x) => x.direction === 'ru-en',
    )!;
    await A.repos.reviews.gradeCard(ca.id, 3, { now: 1_760_000_000_000 });
    await B.repos.reviews.gradeCard(cb.id, 4, { now: 1_760_000_100_000 });
    await A.repos.reading.savePosition('p', 's', 3);
    await B.repos.reading.savePosition('p', 's', 8);
    const n = await A.repos.journal.createNote({ title: 'x', body: 'y' });
    await A.sync();
    await B.sync();
    await B.repos.journal.deleteNote(n.id);
    await A.repos.stats.bumpDailyActivity({ reviewsDone: 3 }, '2026-10-02');
    await B.repos.stats.bumpDailyActivity({ reviewsDone: 4 }, '2026-10-02');
    for (let i = 0; i < 3; i++) {
      await A.sync();
      await B.sync();
    }
    await A.sync();

    for (const P of [A, B]) {
      expect(await pendingCount(P.db)).toBe(0);
      const sp = await P.db.all<{ current_sentence_idx: number }>(
        sql`SELECT current_sentence_idx FROM story_progress`,
      );
      expect(sp[0]!.current_sentence_idx).toBe(8);
      const da = await P.db.all<{ reviews_done: number }>(
        sql`SELECT reviews_done FROM daily_activity WHERE date = '2026-10-02'`,
      );
      expect(da[0]!.reviews_done).toBe(7);
      expect(await P.db.all(sql`SELECT id FROM notes`)).toEqual([]);
      expect(
        (
          await P.db.all<{ reps: number }>(sql`SELECT reps FROM cards WHERE direction = 'ru-en'`)
        )[0]!.reps,
      ).toBe(2);
      expect(await P.db.all(sql`SELECT * FROM sync_parked`)).toEqual([]);
    }
    expect(await readSetting(A.db, 'sync.cursor')).toBe(await readSetting(B.db, 'sync.cursor'));
  }, 60_000);
});
