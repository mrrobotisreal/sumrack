import { db } from './client';
import { readAll } from './read-connection';
import { createRepositories } from './repositories';

/**
 * On-device repository singleton — the entry point for all app code.
 * Components/services import { repos } (or the React Query hooks in
 * ./hooks) and never touch Drizzle directly (roadmap §3).
 *
 * Unit tests do NOT import this module (it opens the native database);
 * they build repositories against better-sqlite3 via createRepositories.
 * T99: the dashboard's aggregations read through the background connection
 * (read-connection.ts) so they never block the JS thread.
 */
export const repos = createRepositories(db, { dashboardReader: readAll });

export { db } from './client';
export { importPack, removePack } from './importer';
export type { Repositories } from './repositories';
