import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Logic-layer unit tests only: they run in Node — DB tests against
// better-sqlite3 (same schema + same migration files as the device), pure
// feature logic (token chunking, session building) directly. Component/UI
// testing is not set up (and not needed) this early.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
