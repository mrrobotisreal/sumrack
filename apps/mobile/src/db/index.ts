import { db } from './client';
import { createRepositories } from './repositories';

/**
 * On-device repository singleton — the entry point for all app code.
 * Components/services import { repos } (or the React Query hooks in
 * ./hooks) and never touch Drizzle directly (roadmap §3).
 *
 * Unit tests do NOT import this module (it opens the native database);
 * they build repositories against better-sqlite3 via createRepositories.
 */
export const repos = createRepositories(db);

export { db } from './client';
export { importPack, removePack } from './importer';
export type { Repositories } from './repositories';
