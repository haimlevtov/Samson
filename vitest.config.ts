import { defineConfig } from 'vitest/config';

// WHY: unit tests must run with no API key and no database — see CLAUDE.md
//      "Tests must pass with no API key present" and the phase 0 acceptance
//      criterion that CI passes with no secrets configured.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
