import { sql, type SQL } from 'drizzle-orm';

import type { SumrakDB } from '@/db/types';
import { getReviewScheduler } from '@/db/repositories/reviews';
import { createEmptyCard, type Card as FsrsCard, type Grade, type State } from 'ts-fsrs';

import {
  MAX_DATA_BYTES,
  MAX_PK_BYTES,
  MAX_PUSH_BODY_BYTES,
  MAX_PUSH_CHANGES,
} from './config';
import { mergeMonotonic } from './merge';
import {
  isDeviceLocalSetting,
  isGated,
  serverTable,
  SPEC_BY_LOCAL,
  SPEC_BY_SERVER,
  type NaturalKey,
  type TableSpec,
} from './registry';
import type { WirePullChange, WirePushChange } from './wire';

/**
 * The sync engine's pure-ish core (T104). Every function takes a `SumrakDB`
 * so the same code runs on expo-sqlite and on better-sqlite3 in tests.
 * Writes happen inside explicit BEGIN/COMMIT with `sync_control.applying = 1`
 * so the outbox triggers stay silent for pulled data.
 */
type Row = Record<string, unknown>;
type DB = SumrakDB;

const q = (id: string) => sql.identifier(id);
const list = (items: SQL[] | ReturnType<typeof q>[]): SQL =>
  sql.join(items as SQL[], sql`, `);

async function all<T = Row>(db: DB, query: SQL): Promise<T[]> {
  return db.all<T>(query);
}
async function one<T = Row>(db: DB, query: SQL): Promise<T | null> {
  return (await db.all<T>(query))[0] ?? null;
}

// ------------------------------------------------------------ table metadata

export interface TableMeta {
  cols: string[];
  pk: string[];
  fks: { col: string; parent: string }[];
}

async function loadMeta(db: DB, table: string): Promise<TableMeta> {
  const info = await all<{ name: string; pk: number }>(db, sql.raw(`PRAGMA table_info(${table})`));
  const fks = await all<{ table: string; from: string }>(
    db,
    sql.raw(`PRAGMA foreign_key_list(${table})`),
  );
  return {
    cols: info.map((c) => c.name),
    pk: info
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name),
    fks: fks.map((f) => ({ col: f.from, parent: f.table })),
  };
}

/** Non-FK columns that still reference another synced table's primary key. */
const EXTRA_REFS: Record<string, { col: string; parent: string }[]> = {
  grammar_lessons: [{ col: 'profile_id', parent: 'word_profiles' }],
};

export interface Conflict {
  tbl: string;
  kind: 'natural-key' | 'monotonic' | 'local-wins' | 'parked';
}

export interface ApplyCtx {
  db: DB;
  deviceId: string;
  /** Apply our own echoes too (T105 replace-mode on a wiped phone). */
  applyOwn: boolean;
  meta: Map<string, TableMeta>;
  idMap: Map<string, string>;
  parents: Set<string>;
  touchedDates: Set<string>;
  /** Rows to re-enqueue after the apply window closes (merged ≠ remote). */
  requeue: { tbl: string; pk: unknown[] }[];
  /** Deletes to run with triggers ON (a remote delete landed on a mapped local row). */
  postDeletes: { tbl: string; pk: unknown[] }[];
  conflicts: Conflict[];
  counts: { applied: number; ignored: number; own: number; parked: number; merged: number };
}

export function createCtx(db: DB, deviceId: string, opts: { applyOwn?: boolean } = {}): ApplyCtx {
  return {
    db,
    deviceId,
    applyOwn: opts.applyOwn ?? false,
    meta: new Map(),
    idMap: new Map(),
    parents: new Set(),
    touchedDates: new Set(),
    requeue: [],
    postDeletes: [],
    conflicts: [],
    counts: { applied: 0, ignored: 0, own: 0, parked: 0, merged: 0 },
  };
}

async function metaOf(ctx: ApplyCtx, table: string): Promise<TableMeta> {
  let m = ctx.meta.get(table);
  if (!m) {
    m = await loadMeta(ctx.db, table);
    ctx.meta.set(table, m);
  }
  return m;
}

async function loadIdMap(ctx: ApplyCtx): Promise<void> {
  ctx.idMap.clear();
  const rows = await all<{ tbl: string; remote_pk: string; local_pk: string }>(
    ctx.db,
    sql`SELECT tbl, remote_pk, local_pk FROM sync_id_map`,
  );
  for (const r of rows) ctx.idMap.set(`${r.tbl}|${r.remote_pk}`, r.local_pk);
}

// ------------------------------------------------------------------ id helpers

function mapValue(ctx: ApplyCtx, parent: string, value: unknown): unknown {
  if (value == null) return value;
  const hit = ctx.idMap.get(`${parent}|${JSON.stringify([value])}`);
  return hit != null ? (JSON.parse(hit) as unknown[])[0] : value;
}

/** Remote pk -> local pk (FK pk columns through the parent's map, a lone id through its own). */
function translatePk(ctx: ApplyCtx, spec: TableSpec, meta: TableMeta, remote: unknown[]): unknown[] {
  if (spec.pk.length === 1) {
    const own = ctx.idMap.get(`${spec.name}|${JSON.stringify(remote)}`);
    if (own != null) return JSON.parse(own) as unknown[];
  }
  return remote.map((v, i) => {
    const col = spec.pk[i]!;
    const fk = meta.fks.find((f) => f.col === col);
    return fk ? mapValue(ctx, fk.parent, v) : v;
  });
}

function translateRefs(ctx: ApplyCtx, spec: TableSpec, meta: TableMeta, data: Row): void {
  for (const f of meta.fks) if (f.col in data) data[f.col] = mapValue(ctx, f.parent, data[f.col]);
  for (const r of EXTRA_REFS[spec.name] ?? []) {
    if (r.col in data) data[r.col] = mapValue(ctx, r.parent, data[r.col]);
  }
}

const pkWhere = (spec: TableSpec, pk: unknown[]): SQL =>
  sql.join(
    spec.pk.map((c, i) => sql`${q(c)} = ${pk[i] as never}`),
    sql` AND `,
  );

async function selectRow(db: DB, spec: TableSpec, pk: unknown[]): Promise<Row | null> {
  return one(db, sql`SELECT * FROM ${q(spec.name)} WHERE ${pkWhere(spec, pk)} LIMIT 1`);
}

async function findByNaturalKey(ctx: ApplyCtx, spec: TableSpec, data: Row): Promise<Row | null> {
  for (const nk of spec.naturalKeys ?? []) {
    if (nk.when && !nk.when(data)) continue;
    if (nk.cols.some((c) => data[c] == null)) continue;
    const cond = sql.join(
      nk.cols.map((c) => sql`${q(c)} = ${data[c] as never}`),
      sql` AND `,
    );
    const extra = nk.sqlWhere ? sql` AND ${sql.raw(nk.sqlWhere)}` : sql``;
    const hit = await one(
      ctx.db,
      sql`SELECT * FROM ${q(spec.name)} WHERE ${cond}${extra} LIMIT 1`,
    );
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------- gates

async function gateOf(
  db: DB,
  tbl: string,
  pk: string,
): Promise<{ hlc: number; deviceId: string } | null> {
  const r = await one<{ hlc: number; device_id: string }>(
    db,
    sql`SELECT hlc, device_id FROM sync_row_hlc WHERE tbl = ${tbl} AND pk = ${pk}`,
  );
  return r ? { hlc: r.hlc, deviceId: r.device_id } : null;
}

async function setGate(
  db: DB,
  tbl: string,
  pk: string,
  hlc: number,
  deviceId: string,
): Promise<void> {
  await db.run(sql`INSERT INTO sync_row_hlc (tbl, pk, hlc, device_id) VALUES (${tbl}, ${pk}, ${hlc}, ${deviceId})
    ON CONFLICT (tbl, pk) DO UPDATE SET hlc = excluded.hlc, device_id = excluded.device_id
    WHERE (excluded.hlc, excluded.device_id) > (sync_row_hlc.hlc, sync_row_hlc.device_id)`);
}

const gt = (ah: number, ad: string, bh: number, bd: string): boolean =>
  ah > bh || (ah === bh && ad > bd);

/**
 * Does a remote change beat what this phone holds for the row? Local = the
 * higher of the recorded server clock and a pending (unpushed) local edit.
 */
async function remoteWins(
  ctx: ApplyCtx,
  spec: TableSpec,
  localPk: string,
  ch: WirePullChange,
): Promise<boolean> {
  const g = await gateOf(ctx.db, spec.name, localPk);
  if (g && !gt(ch.hlc, ch.deviceId, g.hlc, g.deviceId)) return false;
  const p = await one<{ h: number | null }>(
    ctx.db,
    sql`SELECT MAX(hlc) AS h FROM sync_outbox WHERE tbl = ${spec.name} AND pk = ${localPk}`,
  );
  if (p?.h != null && !gt(ch.hlc, ch.deviceId, p.h, ctx.deviceId)) return false;
  return true;
}

// -------------------------------------------------------------------- writes

async function insertRow(ctx: ApplyCtx, table: string, meta: TableMeta, data: Row, orIgnore = false) {
  const cols = Object.keys(data).filter((c) => meta.cols.includes(c));
  await ctx.db.run(
    sql`INSERT ${sql.raw(orIgnore ? 'OR IGNORE ' : '')}INTO ${q(table)} (${list(cols.map(q))}) VALUES (${list(
      cols.map((c) => sql`${data[c] as never}`),
    )})`,
  );
}

async function updateRow(
  ctx: ApplyCtx,
  spec: TableSpec,
  meta: TableMeta,
  pk: unknown[],
  data: Row,
  skip: string[] = [],
) {
  const cols = Object.keys(data).filter(
    (c) => meta.cols.includes(c) && !spec.pk.includes(c) && !skip.includes(c),
  );
  if (cols.length === 0) return;
  await ctx.db.run(
    sql`UPDATE ${q(spec.name)} SET ${list(cols.map((c) => sql`${q(c)} = ${data[c] as never}`))} WHERE ${pkWhere(spec, pk)}`,
  );
}

async function parentsPresent(ctx: ApplyCtx, spec: TableSpec, meta: TableMeta, data: Row) {
  const refs = meta.fks; // EXTRA_REFS are translated but soft (never block an apply)
  for (const f of refs) {
    const v = data[f.col];
    if (v == null) continue;
    const key = `${f.parent}|${String(v)}`;
    if (ctx.parents.has(key)) continue;
    const pmeta = await metaOf(ctx, f.parent);
    const pcol = pmeta.pk[0]!;
    const hit = await one(
      ctx.db,
      sql`SELECT 1 AS x FROM ${q(f.parent)} WHERE ${q(pcol)} = ${v as never} LIMIT 1`,
    );
    if (!hit) {
      return false;
    }
    ctx.parents.add(key);
  }
  return true;
}

// -------------------------------------------------------------- parked changes

async function park(ctx: ApplyCtx, ch: WirePullChange, error: string): Promise<void> {
  ctx.counts.parked++;
  ctx.conflicts.push({ tbl: ch.tbl, kind: 'parked' });
  await ctx.db.run(sql`INSERT INTO sync_parked (tbl, pk, op, data, hlc, device_id, error, attempts, parked_at)
    VALUES (${ch.tbl}, ${ch.pk}, ${ch.op}, ${ch.data ? JSON.stringify(ch.data) : null}, ${ch.hlc}, ${ch.deviceId}, ${error}, 1, ${Date.now()})
    ON CONFLICT (tbl, pk) DO UPDATE SET op = excluded.op, data = excluded.data, hlc = excluded.hlc,
      device_id = excluded.device_id, error = excluded.error, attempts = sync_parked.attempts + 1
    WHERE excluded.hlc >= sync_parked.hlc`);
}

export async function countParked(db: DB): Promise<number> {
  return (await one<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM sync_parked`))?.n ?? 0;
}

async function retryParked(ctx: ApplyCtx): Promise<void> {
  for (let pass = 0; pass < 4; pass++) {
    const rows = await all<{
      id: number; tbl: string; pk: string; op: 'upsert' | 'delete'; data: string | null;
      hlc: number; device_id: string;
    }>(ctx.db, sql`SELECT id, tbl, pk, op, data, hlc, device_id FROM sync_parked ORDER BY id`);
    if (rows.length === 0) return;
    let progressed = false;
    for (const r of rows) {
      await ctx.db.run(sql`DELETE FROM sync_parked WHERE id = ${r.id}`);
      const before = ctx.counts.parked;
      await applyChange(ctx, {
        tbl: r.tbl, pk: r.pk, op: r.op, hlc: r.hlc, deviceId: r.device_id, seq: 0,
        data: r.data ? (JSON.parse(r.data) as Row) : undefined,
      });
      if (ctx.counts.parked === before) progressed = true;
      else ctx.counts.parked = before; // a re-park is not a new parking
    }
    if (!progressed) return;
  }
}

// ---------------------------------------------------------------- apply: core

export type Outcome = 'applied' | 'own' | 'ignored' | 'parked';

export async function applyChange(ctx: ApplyCtx, ch: WirePullChange): Promise<Outcome> {
  try {
    return await applyChangeInner(ctx, ch);
  } catch (e) {
    await park(ctx, ch, e instanceof Error ? e.message : String(e));
    return 'parked';
  }
}

async function applyChangeInner(ctx: ApplyCtx, ch: WirePullChange): Promise<Outcome> {
  const spec = SPEC_BY_SERVER.get(ch.tbl);
  if (!spec) {
    ctx.counts.ignored++;
    return 'ignored';
  }
  const remotePk = JSON.parse(ch.pk) as unknown[];

  if (spec.cls === 'per-device') return applyDaily(ctx, ch, remotePk);

  if (spec.name === 'analytics_events') return applyAnalytics(ctx, ch);

  if (spec.cls === 'settings' && isDeviceLocalSetting(String(remotePk[0]))) {
    ctx.counts.ignored++;
    return 'ignored';
  }

  const meta = await metaOf(ctx, spec.name);
  let localPk = translatePk(ctx, spec, meta, remotePk);

  if (ch.deviceId === ctx.deviceId && !ctx.applyOwn) {
    // Our own echo: not applied, but it is the server's clock for the row.
    if (isGated(spec)) await setGate(ctx.db, spec.name, JSON.stringify(localPk), ch.hlc, ch.deviceId);
    ctx.counts.own++;
    return 'own';
  }

  if (ch.op === 'delete') {
    const lpk = JSON.stringify(localPk);
    if (!(await remoteWins(ctx, spec, lpk, ch))) {
      ctx.counts.ignored++;
      ctx.conflicts.push({ tbl: spec.name, kind: 'local-wins' });
      return 'ignored';
    }
    const mapped = lpk !== ch.pk;
    await ctx.db.run(sql`DELETE FROM sync_outbox WHERE tbl = ${spec.name} AND pk = ${lpk}`);
    if (isGated(spec)) await setGate(ctx.db, spec.name, lpk, ch.hlc, ch.deviceId);
    if (mapped) {
      // Our twin has a different id, so the server still holds ITS upserts (and
      // its children's). Delete it after the apply window with triggers live,
      // so the delete + cascaded child deletes are tombstoned for everyone.
      ctx.postDeletes.push({ tbl: spec.name, pk: localPk });
    } else {
      await ctx.db.run(sql`DELETE FROM ${q(spec.name)} WHERE ${pkWhere(spec, localPk)}`);
    }
    ctx.counts.applied++;
    return 'applied';
  }

  const data: Row = { ...(ch.data ?? {}) };
  translateRefs(ctx, spec, meta, data);
  spec.pk.forEach((c, i) => (data[c] = localPk[i]));

  let existing = await selectRow(ctx.db, spec, localPk);
  if (!existing) {
    const nk = await findByNaturalKey(ctx, spec, data);
    if (nk) {
      const nkPk = spec.pk.map((c) => nk[c]);
      if (JSON.stringify(nkPk) !== JSON.stringify(localPk)) {
        await ctx.db.run(sql`INSERT OR REPLACE INTO sync_id_map (tbl, remote_pk, local_pk)
          VALUES (${spec.name}, ${ch.pk}, ${JSON.stringify(nkPk)})`);
        ctx.idMap.set(`${spec.name}|${ch.pk}`, JSON.stringify(nkPk));
        ctx.conflicts.push({ tbl: spec.name, kind: 'natural-key' });
        ctx.counts.merged++;
        localPk = nkPk;
        spec.pk.forEach((c, i) => (data[c] = localPk[i]));
        existing = nk;
      }
    }
  }
  const lpk = JSON.stringify(localPk);

  if (!(await parentsPresent(ctx, spec, meta, data))) {
    await park(ctx, ch, 'missing parent');
    return 'parked';
  }

  switch (spec.cls) {
    case 'append-only': {
      if (!existing) await insertRow(ctx, spec.name, meta, data, true);
      if (spec.name === 'review_log') {
        await ctx.db.run(
          sql`INSERT OR IGNORE INTO sync_dirty_cards (card_id) VALUES (${data.card_id as never})`,
        );
      }
      break;
    }
    case 'monotonic': {
      if (!existing) {
        await insertRow(ctx, spec.name, meta, data);
        break;
      }
      const merged = mergeMonotonic(spec, existing, data);
      const fieldCols = Object.keys(spec.fields ?? {});
      const diffLocal = fieldCols.filter((c) => (merged[c] ?? null) !== (existing![c] ?? null));
      const diffRemote = fieldCols.filter((c) => (merged[c] ?? null) !== (data[c] ?? null));
      if (diffLocal.length > 0) await updateRow(ctx, spec, meta, localPk, merged);
      if (diffLocal.length > 0 && diffRemote.length > 0) {
        ctx.conflicts.push({ tbl: spec.name, kind: 'monotonic' });
        ctx.counts.merged++;
      }
      if (diffRemote.length > 0) ctx.requeue.push({ tbl: spec.name, pk: localPk });
      break;
    }
    default: {
      // lww | fsrs | settings
      if (!(await remoteWins(ctx, spec, lpk, ch))) {
        ctx.counts.ignored++;
        ctx.conflicts.push({ tbl: spec.name, kind: 'local-wins' });
        return 'ignored';
      }
      // A pending lower local edit is superseded by the remote value.
      await ctx.db.run(sql`DELETE FROM sync_outbox WHERE tbl = ${spec.name} AND pk = ${lpk}`);
      if (existing) {
        await updateRow(ctx, spec, meta, localPk, data, spec.localOnlyCols ?? []);
      } else {
        for (const c of spec.localOnlyCols ?? []) delete data[c];
        if (spec.name === 'scenario_runs') data.media_local = 0; // files live on the other phone
        await insertRow(ctx, spec.name, meta, data);
      }
      await setGate(ctx.db, spec.name, lpk, ch.hlc, ch.deviceId);
      if (spec.name === 'cards') {
        await ctx.db.run(sql`INSERT OR IGNORE INTO sync_dirty_cards (card_id)
          SELECT ${localPk[0] as never} WHERE EXISTS (SELECT 1 FROM review_log WHERE card_id = ${localPk[0] as never})`);
      }
    }
  }
  ctx.counts.applied++;
  return 'applied';
}

async function applyAnalytics(ctx: ApplyCtx, ch: WirePullChange): Promise<Outcome> {
  if (ch.op === 'delete' || !ch.data) return 'ignored';
  const key = (JSON.parse(ch.pk) as string[])[0]!;
  if (key.startsWith(`${ctx.deviceId}:`) && !ctx.applyOwn) {
    ctx.counts.own++;
    return 'own';
  }
  const d = ch.data;
  await ctx.db.run(sql`INSERT OR IGNORE INTO analytics_events (event, props, created_at, sync_key)
    VALUES (${d.event as never}, ${(d.props ?? null) as never}, ${d.created_at as never}, ${key})`);
  ctx.counts.applied++;
  return 'applied';
}

async function applyDaily(ctx: ApplyCtx, ch: WirePullChange, pk: unknown[]): Promise<Outcome> {
  const [date, dev] = pk as [string, string];
  if (dev === ctx.deviceId) {
    ctx.counts.own++;
    return 'own';
  }
  if (ch.op === 'delete' || !ch.data) {
    await ctx.db.run(sql`DELETE FROM daily_activity_peers WHERE date = ${date} AND device_id = ${dev}`);
  } else {
    const d = ch.data;
    await ctx.db.run(sql`INSERT INTO daily_activity_peers
      (date, device_id, reviews_done, reading_ms, stories_finished, goal_met_at, xp, updated_at)
      VALUES (${date}, ${dev}, ${(d.reviews_done ?? 0) as never}, ${(d.reading_ms ?? 0) as never},
        ${(d.stories_finished ?? 0) as never}, ${(d.goal_met_at ?? null) as never}, ${(d.xp ?? 0) as never},
        ${(d.updated_at ?? ch.hlc) as never})
      ON CONFLICT (date, device_id) DO UPDATE SET reviews_done = excluded.reviews_done,
        reading_ms = excluded.reading_ms, stories_finished = excluded.stories_finished,
        goal_met_at = excluded.goal_met_at, xp = excluded.xp, updated_at = excluded.updated_at`);
  }
  ctx.touchedDates.add(date);
  ctx.counts.applied++;
  return 'applied';
}

/** `daily_activity` (what every reader uses) = own + Σ peers for each touched date. */
export async function recomputeDaily(db: DB, dates: Iterable<string>): Promise<void> {
  for (const date of dates) {
    await db.run(sql`INSERT INTO daily_activity (date, reviews_done, reading_ms, stories_finished, goal_met_at, xp, updated_at)
      SELECT date, SUM(reviews_done), SUM(reading_ms), SUM(stories_finished), MIN(goal_met_at), SUM(xp), MAX(updated_at)
      FROM (
        SELECT date, reviews_done, reading_ms, stories_finished, goal_met_at, xp, updated_at FROM daily_activity_own WHERE date = ${date}
        UNION ALL
        SELECT date, reviews_done, reading_ms, stories_finished, goal_met_at, xp, updated_at FROM daily_activity_peers WHERE date = ${date}
      ) GROUP BY date
      ON CONFLICT (date) DO UPDATE SET reviews_done = excluded.reviews_done, reading_ms = excluded.reading_ms,
        stories_finished = excluded.stories_finished, goal_met_at = excluded.goal_met_at, xp = excluded.xp,
        updated_at = excluded.updated_at`);
  }
}

// ------------------------------------------------------------------ apply page

export interface PageResult {
  applied: number;
  own: number;
  ignored: number;
  parked: number;
  merged: number;
  conflicts: Conflict[];
  /** Foreign-card ids whose schedule must be replayed (consumed by `rebuildDirtyCards`). */
  touchedDates: number;
}

/**
 * One pull page: ONE transaction with `applying = 1` (+ the cursor write, so a
 * crash replays the page rather than skipping it). Afterwards, with triggers
 * live again, merged-≠-remote rows are re-enqueued.
 */
export async function applyPage(
  ctx: ApplyCtx,
  changes: WirePullChange[],
  nextCursor: number,
): Promise<PageResult> {
  const { db } = ctx;
  ctx.parents.clear();
  ctx.touchedDates.clear();
  ctx.requeue = [];
  ctx.postDeletes = [];
  ctx.conflicts = [];
  ctx.counts = { applied: 0, ignored: 0, own: 0, parked: 0, merged: 0 };
  await loadIdMap(ctx);

  await db.run(sql`BEGIN`);
  try {
    await db.run(sql`UPDATE sync_control SET applying = 1`);
    await db.run(sql`PRAGMA defer_foreign_keys = ON`);
    let maxHlc = 0;
    for (const ch of changes) {
      if (ch.hlc > maxHlc) maxHlc = ch.hlc;
      await applyChange(ctx, ch);
    }
    await retryParked(ctx);
    await recomputeDaily(db, ctx.touchedDates);
    // Hybrid clock: later local edits must outrank everything already seen.
    await db.run(sql`UPDATE sync_clock SET last = MAX(last, ${maxHlc})`);
    await writeCursor(db, nextCursor);
    await db.run(sql`UPDATE sync_control SET applying = 0`);
    await db.run(sql`COMMIT`);
  } catch (e) {
    await db.run(sql`ROLLBACK`);
    throw e;
  }

  // Triggers are live again: converge the other phones on what we merged.
  for (const r of ctx.requeue) await touchRow(db, r.tbl, r.pk);
  for (const d of ctx.postDeletes) {
    const spec = SPEC_BY_LOCAL.get(d.tbl);
    if (spec) await db.run(sql`DELETE FROM ${q(d.tbl)} WHERE ${pkWhere(spec, d.pk)}`);
  }

  return {
    ...ctx.counts,
    conflicts: ctx.conflicts,
    touchedDates: ctx.touchedDates.size,
  };
}

async function touchRow(db: DB, tbl: string, pk: unknown[]): Promise<void> {
  const spec = SPEC_BY_LOCAL.get(tbl);
  if (!spec) return;
  const c = spec.pk[0]!;
  await db.run(sql`UPDATE ${q(tbl)} SET ${q(c)} = ${q(c)} WHERE ${pkWhere(spec, pk)}`);
}

export async function readSetting<T = unknown>(db: DB, key: string): Promise<T | null> {
  const r = await one<{ value: string }>(db, sql`SELECT value FROM settings WHERE key = ${key}`);
  if (!r) return null;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return null;
  }
}

export async function writeSetting(db: DB, key: string, value: unknown): Promise<void> {
  await db.run(sql`INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${JSON.stringify(value)}, ${Date.now()})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
}

async function writeCursor(db: DB, cursor: number): Promise<void> {
  await writeSetting(db, 'sync.cursor', cursor);
}

// ----------------------------------------------------------------------- push

export interface PushBatch {
  changes: WirePushChange[];
  /** Outbox entries this batch covers: delete (tbl, pk, id <= maxId) after a 2xx. */
  acks: { tbl: string; pk: string; maxId: number; hlc: number }[];
  dropped: number;
}

export async function pendingCount(db: DB): Promise<number> {
  return (
    (await one<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM (SELECT 1 FROM sync_outbox GROUP BY tbl, pk)`))
      ?.n ?? 0
  );
}

/** Coalesce the outbox (latest op per (tbl, pk) wins) into one wire batch. */
export async function collectPush(db: DB, deviceId: string): Promise<PushBatch> {
  const heads = await all<{ id: number; tbl: string; pk: string; op: string; hlc: number }>(
    db,
    sql`SELECT o.id, o.tbl, o.pk, o.op, o.hlc FROM sync_outbox o
        WHERE o.id = (SELECT MAX(id) FROM sync_outbox WHERE tbl = o.tbl AND pk = o.pk)
        ORDER BY o.id LIMIT ${MAX_PUSH_CHANGES}`,
  );
  const batch: PushBatch = { changes: [], acks: [], dropped: 0 };
  let bytes = 0;
  for (const h of heads) {
    const spec = SPEC_BY_LOCAL.get(h.tbl);
    if (!spec) {
      batch.acks.push({ tbl: h.tbl, pk: h.pk, maxId: h.id, hlc: h.hlc });
      continue;
    }
    const localPk = JSON.parse(h.pk) as unknown[];
    let change: WirePushChange;
    let wirePk = h.pk;
    if (spec.name === 'daily_activity_own') wirePk = JSON.stringify([localPk[0], deviceId]);
    else if (spec.name === 'analytics_events') wirePk = JSON.stringify([`${deviceId}:${localPk[0]}`]);

    let row: Row | null = null;
    if (h.op !== 'delete') row = await selectRow(db, spec, localPk);
    if (!row) {
      change = { tbl: serverTable(spec), pk: wirePk, op: 'delete', hlc: h.hlc };
    } else {
      const data: Row = { ...row };
      if (spec.name === 'analytics_events') {
        delete data.id;
        delete data.sync_key;
      }
      change = { tbl: serverTable(spec), pk: wirePk, op: 'upsert', data, hlc: h.hlc };
    }
    const size = JSON.stringify(change).length;
    if (wirePk.length > MAX_PK_BYTES || (change.data && size > MAX_DATA_BYTES)) {
      batch.dropped++; // would 400 the whole push; never retry-loop on it
      batch.acks.push({ tbl: h.tbl, pk: h.pk, maxId: h.id, hlc: h.hlc });
      continue;
    }
    if (batch.changes.length > 0 && bytes + size > MAX_PUSH_BODY_BYTES) break;
    bytes += size;
    batch.changes.push(change);
    batch.acks.push({ tbl: h.tbl, pk: h.pk, maxId: h.id, hlc: h.hlc });
  }
  return batch;
}

/** Only after a 2xx: drop the covered outbox entries (newer edits to the same row stay). */
export async function ackPush(db: DB, acks: PushBatch['acks'], deviceId: string): Promise<void> {
  await db.run(sql`BEGIN`);
  try {
    for (const a of acks) {
      const spec = SPEC_BY_LOCAL.get(a.tbl);
      // The server now holds our version: it is the clock a remote twin must beat.
      if (spec && isGated(spec)) await setGate(db, a.tbl, a.pk, a.hlc, deviceId);
      await db.run(sql`DELETE FROM sync_outbox WHERE tbl = ${a.tbl} AND pk = ${a.pk} AND id <= ${a.maxId}`);
    }
    await db.run(sql`COMMIT`);
  } catch (e) {
    await db.run(sql`ROLLBACK`);
    throw e;
  }
}

// ------------------------------------------------------------------ FSRS replay

const SCHEDULE_COLS = [
  'due_at', 'stability', 'difficulty', 'elapsed_days', 'scheduled_days',
  'learning_steps', 'reps', 'lapses', 'state', 'last_review_at',
] as const;

/**
 * Replay a card's full merged review log from a fresh card with the live
 * scheduler — exactly what `gradeCard` does one review at a time (same
 * `getReviewScheduler().next`, same last-review fallback), so replaying a
 * log produced by gradeCard reproduces the stored schedule.
 */
export function replayCard(
  createdAt: number,
  log: { rating: number; reviewed_at: number }[],
): Pick<Row, (typeof SCHEDULE_COLS)[number]> | null {
  const usable = log.filter((l) => l.rating >= 1 && l.rating <= 4);
  if (usable.length === 0) return null;
  const scheduler = getReviewScheduler();
  let card: FsrsCard = createEmptyCard(new Date(createdAt));
  let lastAt = createdAt;
  for (const l of usable) {
    const res = scheduler.next(card, new Date(l.reviewed_at), l.rating as Grade);
    card = res.card;
    lastAt = l.reviewed_at;
  }
  return {
    due_at: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as State,
    last_review_at: card.last_review ? card.last_review.getTime() : lastAt,
  };
}

/**
 * Rebuild every card that gained foreign review_log rows. Runs with triggers
 * ON: a changed card is re-enqueued so the other phone converges. Idempotent —
 * an unchanged replay writes nothing, which is what lets two phones go quiet.
 */
export async function rebuildDirtyCards(db: DB): Promise<number> {
  const dirty = await all<{ card_id: string }>(db, sql`SELECT card_id FROM sync_dirty_cards`);
  let rebuilt = 0;
  for (const { card_id } of dirty) {
    const card = await one<Row>(db, sql`SELECT * FROM cards WHERE id = ${card_id}`);
    if (card) {
      const log = await all<{ rating: number; reviewed_at: number }>(
        db,
        sql`SELECT rating, reviewed_at FROM review_log WHERE card_id = ${card_id} ORDER BY reviewed_at, id`,
      );
      const next = replayCard(card.created_at as number, log);
      if (next && SCHEDULE_COLS.some((c) => (next[c] ?? null) !== (card[c] ?? null))) {
        await db.run(
          sql`UPDATE cards SET ${list(SCHEDULE_COLS.map((c) => sql`${q(c)} = ${next[c] as never}`))} WHERE id = ${card_id}`,
        );
        rebuilt++;
      }
    }
    await db.run(sql`DELETE FROM sync_dirty_cards WHERE card_id = ${card_id}`);
  }
  return rebuilt;
}

export type { NaturalKey };
