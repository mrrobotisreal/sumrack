import { defineConfig } from 'vitest/config';

// DB-layer unit tests only: they run in Node against better-sqlite3 (same
// schema + same migration files as the device). Component/UI testing is not
// set up (and not needed) this early.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/db/**/*.test.ts'],
  },
});
