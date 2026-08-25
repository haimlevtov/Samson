import { defineConfig } from 'vitest/config';

// WHY: unit tests must run with no API key and no database — see CLAUDE.md
//      "Tests must pass with no API key present" and the phase 0 acceptance
//      criterion that CI passes with no secrets configured.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],

    // WHY thresholds rather than a report nobody reads: PLAN.md phase 1 requires
    //     near-total coverage of the metrics engine, and invariant #1 puts every
    //     user-visible number in there. A threshold turns that from a claim into
    //     something CI fails on.
    // AI-NOTE: scoped to src/metrics deliberately. Widening this to all of src/
    //          would drag in the Next.js app and the Supabase clients, whose
    //          coverage is not meaningful and would force the number back down.
    coverage: {
      provider: 'v8',
      include: ['src/metrics/**/*.ts'],
      exclude: ['src/metrics/**/*.test.ts', 'src/metrics/index.ts', 'src/metrics/types.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
