import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema';

/**
 * The database handle every repository and the importer accept. On device
 * this is the expo-sqlite drizzle instance; in unit tests it's a
 * better-sqlite3 instance — both are 'sync'-mode drivers, and drizzle query
 * builders are thenable on both, so all repository code awaits uniformly
 * and runs unchanged in both environments. Transactions use explicit
 * BEGIN/COMMIT (see importer) rather than driver `.transaction()`, whose
 * callback sync-ness differs between the two drivers.
 */
export type SumrakDB = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
