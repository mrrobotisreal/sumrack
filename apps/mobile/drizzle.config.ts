import { defineConfig } from 'drizzle-kit';

// Migration workflow (see README): edit src/db/schema/*, then
//   pnpm db:generate           # new numbered .sql migration + migrations.js
//   pnpm db:generate:custom    # empty .sql for hand-written SQL (FTS5 etc.)
// Never edit a committed migration — additive files only (roadmap §3).
export default defineConfig({
  dialect: 'sqlite',
  driver: 'expo',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
});
