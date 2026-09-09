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
    //
    // WHY src/diet joined it in phase 6: the same argument, one invariant along.
    //     CLAUDE.md #6 puts the calorie clamp here, and the clamp is the whole
    //     safety property of the diet advisor — an untested branch in it is a
    //     path by which a floor is not applied. It is the second module in the
    //     project whose output a user cannot sanity-check by looking at it.
    //
    // AI-NOTE: scoped to these two deliberately. Widening to all of src/ would
    //          drag in the Next.js app and the Supabase clients, whose coverage
    //          is not meaningful and would force the number back down.
    //
    //          Note the inward consequence as well: EVERYTHING added under
    //          src/diet/ now inherits 95/95/90/95. Phase 6 PR 4 puts schema.ts,
    //          prompts.ts and advice.ts there — a module of prompt constants and
    //          a retry loop with a correction path are exactly the shapes that
    //          drag branch coverage under a threshold, so budget for it rather
    //          than discovering it in CI.
    coverage: {
      provider: 'v8',
      include: ['src/metrics/**/*.ts', 'src/diet/**/*.ts'],
      exclude: [
        'src/metrics/**/*.test.ts',
        'src/metrics/index.ts',
        'src/metrics/types.ts',
        'src/diet/**/*.test.ts',
      ],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
