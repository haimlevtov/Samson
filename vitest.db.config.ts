import { defineConfig } from 'vitest/config';

// WHY: these tests need a real Postgres with RLS, so they are kept out of the
//      secret-free unit run and given a longer timeout for stack startup.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
