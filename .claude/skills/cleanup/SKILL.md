---
name: cleanup
description: >-
  Use this skill for code review and cleanup tasks. Invoke it when the user wants to inspect code
  quality, clean something up before merging, audit a component or folder for issues, or get a
  pre-merge review — of local changes, a branch, or an open PR. This covers any request that is
  about reviewing existing code rather than adding new functionality — "review this", "clean this
  up", "look for dead code", "flag anything that needs fixing", "code review before I merge",
  "review PR #N", or "have a look at [file/component/script]". Do NOT invoke for: adding
  features, fixing a specific known bug, explaining code, running tests or builds, or writing
  documentation.
---

Review code for REAL problems and present a cleanup plan. Never invent work — a clean file gets
"looks clean", not padding. Do NOT change anything until the user approves the plan (exception:
when the user already ordered a review-then-act workflow, e.g. "review each PR then merge", the
review verdict gates that action — no separate approval round).

> **AI-NOTE — this skill arrived from another repository and was retargeted for Samson.**
> Every rule below was checked against this codebase on 01/09/2026. If you are tempted to add a
> rule here, verify the thing it names actually exists first — the original version flagged a
> design system this project does not have. Samson's conventions live in `CLAUDE.md` and win
> over anything stated here.

## Phase 1 — Determine scope

- Named file → that file. Named directory/feature → its files **plus** the parent page/route
  that composes them.
- A PR → `gh pr diff N` (also run `gh pr checks N`). A branch / no scope given →
  `git diff main...HEAD --name-only`; if that's empty, ask rather than guess.
- Skip `docs/plans/**` and docs prose for code checks — but see Doc coupling below.

## Phase 2 — Scan

**Delegate first when the scope is a diff/PR or more than ~5 source files:** dispatch the
project reviewer subagents in parallel and fold their findings into the plan. The five agents in
`.claude/agents/` route as: `convention-compliance-reviewer` (any `src/`+`scripts/` TS),
`performance-reviewer` (data-layer/rendering/backend), `resilience-reviewer` (`src/db`,
`app/api`, `scripts/` — failure-path ownership, async lifecycle), `security-reviewer`
(`app/api`, `src/db`, `src/llm`, `supabase/`), and `docs-sync-reviewer` (see Doc coupling —
this project has no Documentation Map, so give it the three couplings below explicitly or it
will report their absence as its only finding). For small scopes, check directly:

**Invariant violations — check these first, they outrank style**

See `CLAUDE.md` for the numbered list. Note that #2 and #10 are already enforced
mechanically — `eslint.config.mjs` restricts OpenRouter literals and
`tests/unit/invariants.test.ts` greps the tree for both — so spend review attention on the
ones nothing catches automatically:

- **A model producing a number the user sees** (#1). e1RM, tonnage, XP, streaks, calories
  are deterministic code with tests. A figure originating in an LLM response is a bug.
- **`fetch` to OpenRouter outside `src/llm/gateway.ts`** (#2), or a gateway path that can
  return without writing an `llm_calls` row — including on failure and retry (#3).
- **XP or rewards scaled by volume** rather than adherence (#4).
- **A planner candidate list not pre-filtered in SQL** (#5).
- **The service role key under `src/` or `app/`** (#10). `scripts/` is the sanctioned
  exception; `tests/unit/invariants.test.ts` asserts the boundary.
- **`new Date()` arithmetic on stored dates.** Dates are canonical strings; `src/metrics/dates.ts`
  does string arithmetic on purpose, to avoid DST drift. Reintroducing `Date` math is a finding.
- **Display-layer unit conversion done at rest** (#8) — kg/cm/seconds are stored canonical.

**Dead code & hygiene**
- Unused imports/symbols, unreachable code, commented-out blocks left behind
- `console.log` debug leftovers. Script CLI output is sanctioned; `console.log` inside `src/`
  or `app/` is not.
- TODO/FIXME with no tracked task
- Non-functional UI (a button with no handler, dead placeholder code)
- Comments that restate the code, or that went stale against the code they sit on
  (`CLAUDE.md` → Comment style). `INVARIANT:` / `WHY:` / `AI-NOTE:` tags are load-bearing —
  never strip one; update it.

**Design system** — tokens live in the single `:root` block in `app/globals.css`
- Hardcoded colors are a finding: hex **and** `rgba(...)` literals outside `:root` belong in
  tokens. There is no lint rule catching either, so this needs eyes.
- **Shadows are sanctioned here.** `--shadow` and `--shadow-lift` are deliberate depth tokens.
  Using them is correct; a raw `box-shadow` literal that should have been a token is the
  finding, not the shadow itself.
- Duplicated markup: the same visual section in 2+ files in scope → propose ONE shared
  extraction in `src/ui/`, not per-file fixes. That directory is deliberately small
  (`FieldHint.tsx`, `format.ts`) — adding to it needs a second caller, not a hypothetical one.

**Stack conventions**
- Tunables belong in `src/llm/config.ts` — a script or component re-declaring one locally is
  a finding
- Zod schemas are the single source of truth. A hand-written TS type that duplicates a schema
  instead of `z.infer` is a finding.
- Scripts: `config({ path: '.env.local', quiet: true })` from `dotenv`, an `npm run` entry in
  `package.json`, and a header comment saying what it is for
- DB access from the app goes through `src/db/training.ts` and the request-scoped RLS client
  in `src/db/client.ts`. New direct `.from()` calls outside them need a reason.
- External fetches carry a timeout; client data fetches render an explicit error/retry state,
  never a dead end
- Schema changes are migrations only, never hand-applied

## Phase 3 — Plan

Present findings **before making any changes**, grouped by file:

```
## Cleanup Plan

### [filename]
- [ ] Issue — proposed fix (be specific: name the symbol, line, or pattern)

### Nothing to do
- [file] — looks clean
```

If there is genuinely nothing worth fixing, say so clearly and stop — no approval question.

When the plan HAS items, end with: **"Shall I apply all of these, or pick specific items?"**

## Phase 4 — Execute (only after approval)

- Apply ONLY approved items. No refactoring beyond them, no docstrings/comments/type
  annotations on code you didn't change, no placeholder files, no error handling for
  scenarios that can't happen.
- Verify, and quote the output rather than asserting it passed:

  ```
  npm run typecheck && npm run lint && npm test
  ```

  Add `npm run test:db` when RLS, policies, or migrations were touched, and `npm run build`
  when routes or pages changed.
- **Coverage is not evidence** (`docs/PLAN.md` → The merge gate). The threshold in
  `vitest.config.ts` records which lines ran, never whether anything was checked. Do not cite
  it as verification.
- Leave nothing running. If a dev server or Docker was started to check something, stop it in
  the same turn (`CLAUDE.md` → Local environment).

## Doc coupling

This project has no Documentation Map; the coupling is small enough to state directly. If the
scope touches one of these, the paired doc must change in the same diff:

| Change | Must also update |
| --- | --- |
| A migration in `supabase/migrations/` | `src/db/types.ts` regenerated — CI fails on a stale diff |
| A decision with a rejected alternative | A new ADR in `docs/adr/` |
| Work completing a phase | The Outcome section of `docs/plans/phase-N.md` |

A missing update is a finding.
