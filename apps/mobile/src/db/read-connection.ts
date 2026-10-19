import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { openDatabaseAsync, type SQLiteBindValue, type SQLiteDatabase } from 'expo-sqlite';

import { DATABASE_NAME } from './client';
import { createReadQueue } from './read-queue';

/**
 * The background read connection (T99). drizzle's expo-sqlite driver runs
 * every statement through the *Sync* API on the JS thread, so the heavy
 * dashboard aggregations froze the UI for their whole run — the Stats tap
 * could not even paint its screen. This second connection is opened with
 * the async API, whose statements execute on expo-sqlite's native worker:
 * the JS thread stays free while SQLite grinds. WAL (client.ts) lets it
 * read concurrently with the main connection's writes.
 *
 * Read-only by contract — writes stay on the main drizzle handle so there
 * is one writer. Queries are drizzle `sql` fragments compiled with the
 * main handle's dialect, so repositories keep one copy of their SQL.
 */
let connection: Promise<SQLiteDatabase> | null = null;

function open(): Promise<SQLiteDatabase> {
  connection ??= openDatabaseAsync(DATABASE_NAME, { useNewConnection: true }).catch((e) => {
    connection = null; // let the next read retry the open
    throw e;
  });
  return connection;
}

// Same dialect config as client.ts's drizzle() (no casing) — compiles the
// `sql` fragments identically without reaching into drizzle internals.
const dialect = new SQLiteSyncDialect();

export const readQueue = createReadQueue();

/** Run one compiled `sql` read on the background connection. */
export async function readAll<T>(query: SQL): Promise<T[]> {
  const conn = await open();
  const compiled = dialect.sqlToQuery(query);
  return conn.getAllAsync<T>(compiled.sql, compiled.params as SQLiteBindValue[]);
}
