import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

export const DATABASE_NAME = 'sumrak.db';

/**
 * The one on-device database connection. `enableChangeListener` powers
 * drizzle's `useLiveQuery` if later tickets want it. FK enforcement is ON —
 * content tables cascade-delete from `packs`; user tables cascade within the
 * user group only (never into content). WAL keeps reads snappy while the
 * importer writes.
 */
export const expoSqlite = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });
expoSqlite.execSync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

// Concrete ExpoSQLiteDatabase type (useMigrations needs it); assignable to
// the shared SumrakDB handle the repositories accept.
export const db = drizzle(expoSqlite, { schema });
