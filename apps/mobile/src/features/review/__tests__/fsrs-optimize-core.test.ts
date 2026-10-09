/**
 * T39 — offline FSRS optimizer. Pure core (scripts/fsrs-optimize-core.mjs):
 * export → binding CSV, output shape, the low-data warning, and a real run
 * through the fsrs-rs binding. The end-to-end test drives the CLI against a
 * file SQLite DB built with the app's real migrations.
 */
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { CLAMP_PARAMETERS, W17_W18_Ceiling, default_w } from 'ts-fsrs';

import * as schema from '@/db/schema';
import {
  CSV_HEADER,
  FsrsOptimizeError,
  LOW_REVIEW_THRESHOLD,
  buildParamsFile,
  buildRevlogCsv,
  isSqliteBytes,
  lowReviewWarning,
  normalizeRows,
  optimize,
  parseExportJson,
  roundWeights,
  tzOffsetMinutes,
  validateWeights,
  type ReviewRow,
} from '../../../../scripts/fsrs-optimize-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(here, '../../../..');
const CLI = path.join(MOBILE_ROOT, 'scripts/fsrs-optimize.mjs');
const MIGRATIONS = path.join(MOBILE_ROOT, 'drizzle');

const DAY = 86_400_000;
const T0 = Date.parse('2026-06-01T08:00:00Z');

/** mulberry32 — seeded so the synthetic dataset is identical on every run. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plausible review histories: intervals grow ×2–3, ~85 % Good. */
function synthRows(cards: number, seed = 42): ReviewRow[] {
  const rnd = prng(seed);
  const rows: ReviewRow[] = [];
  for (let c = 0; c < cards; c++) {
    const cardId = `card-${c}`;
    let t = T0 + Math.floor(rnd() * 30) * DAY;
    let state = 0;
    let ivl = 0;
    const n = 4 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const u = rnd();
      const rating = u < 0.05 ? 1 : u < 0.1 ? 2 : u < 0.95 ? 3 : 4;
      rows.push({
        cardId,
        direction: 'ru-en',
        rating,
        state,
        reviewedAt: Math.round(t + rnd() * 3_600_000),
        durationMs: 1000 + Math.floor(rnd() * 3000),
      });
      if (rating === 1) {
        state = 3;
        ivl = 0.5;
      } else {
        state = 2;
        ivl = ivl === 0 ? 1 + rnd() : ivl * (2 + rnd());
      }
      t += Math.max(1, Math.round(ivl)) * DAY;
    }
  }
  return rows;
}

describe('export JSON parsing', () => {
  it('accepts the exact sumrak-review-log v1 shape', () => {
    const text = JSON.stringify({
      v: 1,
      kind: 'sumrak-review-log',
      exportedAt: '2026-10-09T00:00:00.000Z',
      timezone: 'America/Denver',
      rows: [
        { cardId: 'a', direction: 'ru-en', rating: 3, state: 0, reviewedAt: T0, durationMs: 900 },
      ],
    });
    const parsed = parseExportJson(text);
    expect(parsed.timezone).toBe('America/Denver');
    expect(parsed.rows).toEqual([
      { cardId: 'a', direction: 'ru-en', rating: 3, state: 0, reviewedAt: T0, durationMs: 900 },
    ]);
  });

  it('rejects a wrong kind or version', () => {
    expect(() =>
      parseExportJson(JSON.stringify({ v: 2, kind: 'sumrak-review-log', rows: [] })),
    ).toThrow(FsrsOptimizeError);
    expect(() => parseExportJson(JSON.stringify({ v: 1, kind: 'other', rows: [] }))).toThrow(
      /Not a/,
    );
  });

  it('rejects out-of-range ratings and states', () => {
    expect(() => normalizeRows([{ cardId: 'a', rating: 5, state: 0, reviewedAt: T0 }])).toThrow(
      /rating/,
    );
    expect(() => normalizeRows([{ cardId: 'a', rating: 3, state: 4, reviewedAt: T0 }])).toThrow(
      /state/,
    );
  });

  it('detects SQLite bytes by magic header', () => {
    expect(isSqliteBytes(new TextEncoder().encode('SQLite format 3\0rest'))).toBe(true);
    expect(isSqliteBytes(new TextEncoder().encode('{"v":1}'))).toBe(false);
  });
});

describe('export → binding CSV', () => {
  it('writes the header, groups per card, sorts reviews by time, maps card ids to integers', () => {
    const rows: ReviewRow[] = [
      {
        cardId: 'b',
        direction: 'ru-en',
        rating: 3,
        state: 2,
        reviewedAt: T0 + 5 * DAY,
        durationMs: 700,
      },
      { cardId: 'a', direction: 'ru-en', rating: 3, state: 0, reviewedAt: T0, durationMs: null },
      {
        cardId: 'b',
        direction: 'ru-en',
        rating: 4,
        state: 0,
        reviewedAt: T0 + 1 * DAY,
        durationMs: 500,
      },
      {
        cardId: 'a',
        direction: 'ru-en',
        rating: 2,
        state: 2,
        reviewedAt: T0 + 2 * DAY,
        durationMs: 800,
      },
    ];
    const built = buildRevlogCsv(rows);
    const lines = built.csv.trimEnd().split('\n');
    expect(lines[0]).toBe(CSV_HEADER);
    // Card 'a' (first review at T0) → 1, card 'b' (first at T0+1d) → 2.
    expect(lines.slice(1)).toEqual([
      `1,${T0},3,0,0`,
      `1,${T0 + 2 * DAY},2,2,800`,
      `2,${T0 + 1 * DAY},4,0,500`,
      `2,${T0 + 5 * DAY},3,2,700`,
    ]);
    expect(built.reviewCount).toBe(4);
    expect(built.cardCount).toBe(2);
    expect(built.firstReviewedAt).toBe(T0);
    expect(built.lastReviewedAt).toBe(T0 + 5 * DAY);
  });

  it('computes minute offsets for DST zones and UTC', () => {
    expect(tzOffsetMinutes(Date.parse('2026-01-05T12:00:00Z'), 'America/Denver')).toBe(-7 * 60);
    expect(tzOffsetMinutes(Date.parse('2026-07-05T12:00:00Z'), 'America/Denver')).toBe(-6 * 60);
    expect(tzOffsetMinutes(0, 'UTC')).toBe(0);
  });
});

describe('output shape and guards', () => {
  it('builds the exact sumrak-fsrs-params v1 object', () => {
    const w = roundWeights(Array.from(default_w));
    const file = buildParamsFile({
      w,
      fittedAt: '2026-10-09T12:00:00.000Z',
      reviewCount: 1200,
      cardCount: 300,
      logLoss: 0.2,
      rmse: 0.02,
      defaultLogLoss: 0.21,
      defaultRmse: 0.03,
    });
    expect(Object.keys(file)).toEqual([
      'v',
      'kind',
      'w',
      'fittedAt',
      'reviewCount',
      'cardCount',
      'logLoss',
      'rmse',
      'defaultLogLoss',
      'defaultRmse',
    ]);
    expect(file.v).toBe(1);
    expect(file.kind).toBe('sumrak-fsrs-params');
    expect(file.w).toHaveLength(21);
  });

  it('warns below the review threshold and not at it', () => {
    expect(lowReviewWarning(LOW_REVIEW_THRESHOLD - 1)).toMatch(/Only \d+ reviews/);
    expect(lowReviewWarning(LOW_REVIEW_THRESHOLD)).toBeUndefined();
  });

  it('rounds to 4 dp and rejects out-of-bounds weights', () => {
    expect(roundWeights([1.23456, 0.00005])).toEqual([1.2346, 0.0001]);
    const bad = Array.from(default_w);
    bad[7] = 9; // w[7] upper bound is 2 → out of range
    expect(() => validateWeights(bad)).toThrow(/w\[7\]/);
    expect(() => validateWeights(bad.slice(0, 20))).toThrow(/21 weights/);
    expect(() => validateWeights(Array.from(default_w))).not.toThrow();
  });

  it('matches ts-fsrs clamp bounds shape', () => {
    expect(CLAMP_PARAMETERS(W17_W18_Ceiling, true)).toHaveLength(21);
  });

  it('fails with NOT_ENOUGH_DATA for an empty history', async () => {
    await expect(optimize({ rows: [], timezone: 'UTC' })).rejects.toMatchObject({
      code: 'NOT_ENOUGH_DATA',
    });
  });
});

describe('real binding run', () => {
  it('fits 21 finite in-bounds weights on a synthetic 600-card history', async () => {
    const rows = normalizeRows(synthRows(600));
    expect(rows.length).toBeGreaterThanOrEqual(3000);

    const { params, summary } = await optimize({
      rows,
      timezone: 'America/Denver',
      now: new Date('2026-10-09T12:00:00.000Z'),
    });

    expect(params.w).toHaveLength(21);
    const bounds = CLAMP_PARAMETERS(W17_W18_Ceiling, true);
    params.w.forEach((x, i) => {
      expect(Number.isFinite(x)).toBe(true);
      const [lo = -Infinity, hi = Infinity] = bounds[i] ?? [];
      expect(x).toBeGreaterThanOrEqual(lo);
      expect(x).toBeLessThanOrEqual(hi);
    });
    expect(Number.isFinite(params.logLoss)).toBe(true);
    expect(Number.isFinite(params.defaultLogLoss)).toBe(true);
    expect(params.reviewCount).toBe(rows.length);
    expect(params.cardCount).toBe(600);
    expect(params.warning).toBeUndefined();
    expect(summary.timezone).toBe('America/Denver');
  }, 60_000);
});

describe('CLI end-to-end (file DB with real migrations)', () => {
  it('reads a pulled sumrak.db and writes a valid params file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't39-cli-'));
    try {
      const dbPath = path.join(dir, 'sumrak.db');
      const sqlite = new Database(dbPath);
      migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS });

      const insertBank = sqlite.prepare(
        `INSERT INTO bank_items (id, kind, surface, normalized, translation, created_at)
         VALUES (?, 'word', ?, ?, 'x', 0)`,
      );
      const insertCard = sqlite.prepare(
        `INSERT INTO cards (id, bank_item_id, direction, due_at, stability, difficulty, elapsed_days,
           scheduled_days, learning_steps, reps, lapses, state, created_at)
         VALUES (?, ?, 'ru-en', 0, 1, 5, 0, 0, 0, 0, 0, 0, 0)`,
      );
      const insertLog = sqlite.prepare(
        `INSERT INTO review_log (id, card_id, rating, state, due_at, stability, difficulty, elapsed_days,
           last_elapsed_days, scheduled_days, learning_steps, reviewed_at, duration_ms, source)
         VALUES (?, ?, ?, ?, 0, 1, 5, 0, 0, 0, 0, ?, 1000, 'flashcard')`,
      );

      const rows = synthRows(120, 7);
      const seen = new Set<string>();
      sqlite.transaction(() => {
        for (const r of rows) {
          if (!seen.has(r.cardId)) {
            seen.add(r.cardId);
            insertBank.run(`bank-${r.cardId}`, `w-${r.cardId}`, `w-${r.cardId}`);
            insertCard.run(r.cardId, `bank-${r.cardId}`);
          }
        }
        rows.forEach((r, i) =>
          insertLog.run(`log-${i}`, r.cardId, r.rating, r.state, r.reviewedAt),
        );
      })();
      sqlite.close();

      const outPath = path.join(dir, 'params.json');
      const stdout = execFileSync(
        'node',
        [CLI, dbPath, '--out', outPath, '--tz', 'America/Denver'],
        {
          cwd: MOBILE_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 120_000,
        },
      );

      const file = JSON.parse(readFileSync(outPath, 'utf8'));
      expect(file.v).toBe(1);
      expect(file.kind).toBe('sumrak-fsrs-params');
      expect(file.w).toHaveLength(21);
      expect(file.reviewCount).toBe(rows.length);
      expect(file.cardCount).toBe(seen.size);
      expect(file.warning).toMatch(/Only \d+ reviews/);
      expect(typeof file.fittedAt).toBe('string');
      // The final stdout line is the one-line JSON, identical in content to the file.
      const last = stdout.trim().split('\n').at(-1) ?? '';
      expect(JSON.parse(last)).toEqual(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('exits 2 and writes nothing for an empty DB', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't39-empty-'));
    try {
      const dbPath = path.join(dir, 'empty.db');
      const sqlite = new Database(dbPath);
      migrate(drizzle(sqlite, { schema }), { migrationsFolder: MIGRATIONS });
      sqlite.close();
      const outPath = path.join(dir, 'params.json');
      let status = 0;
      try {
        execFileSync('node', [CLI, dbPath, '--out', outPath], { cwd: MOBILE_ROOT, stdio: 'pipe' });
      } catch (err) {
        status = (err as { status: number }).status;
      }
      expect(status).toBe(2);
      expect(() => readFileSync(outPath)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 and writes nothing for an empty JSON export', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 't39-json-'));
    try {
      const input = path.join(dir, 'export.json');
      writeFileSync(
        input,
        JSON.stringify({
          v: 1,
          kind: 'sumrak-review-log',
          exportedAt: '2026-10-09T00:00:00Z',
          timezone: 'UTC',
          rows: [],
        }),
      );
      const outPath = path.join(dir, 'p.json');
      let status = 0;
      try {
        execFileSync('node', [CLI, input, '--out', outPath], { cwd: MOBILE_ROOT, stdio: 'pipe' });
      } catch (err) {
        status = (err as { status: number }).status;
      }
      expect(status).toBe(2);
      expect(() => readFileSync(outPath)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
