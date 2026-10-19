/**
 * Regenerate the outbox-trigger block of drizzle/0023_sync.sql from the sync
 * registry (T104). Run: `npx tsx scripts/gen-sync-triggers.ts` from apps/mobile.
 * Safe to run only BEFORE 0023_sync ships to a device; after that, a registry
 * change needs a new migration (the triggers.test regen-diff fails loudly).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spliceTriggerBlock } from '../src/features/account-sync/trigger-sql';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../drizzle/0023_sync.sql');
fs.writeFileSync(file, spliceTriggerBlock(fs.readFileSync(file, 'utf8')));
console.log(`wrote triggers into ${file}`);
