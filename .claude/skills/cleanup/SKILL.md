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

## Phase 1 — Determine scope

- Named file → that file. Named directory/feature → its files **plus** the parent page/route
  that composes them.
- A PR → `gh pr diff N` (also run `gh pr checks N`). A branch / no scope given →
  `git diff main...HEAD --name-only`; if that's empty, ask rather than guess.
- Skip `docs/plans/**` and docs prose for code checks — but see Doc coupling below.

## Phase 2 — Scan

**Delegate first when the scope is a diff/PR or more than ~5 source files:** dispatch the
project reviewer subagents in parallel and fold their findings into the plan — the routing in
the agents in `.claude/agents/` are: `convention-compliance-reviewer` (any `src/`+`scripts/` TS),
`performance-reviewer` (data-layer/rendering/backend), `resilience-reviewer` (`src/db`,
`app/api`, `scripts` — failure-path ownership, async lifecycle),
`docs-sync-reviewer` (any coupled-doc surface), `security-reviewer` (`app/api`,
`src/db, src/llm`, `supabase/`), and `bias-semantics-reviewer` (`src/metrics/`,
`src/llm/config.ts` — threshold/rule coherence). For small scopes, check directly:

**Dead code & hygiene**
- Unused imports/symbols, unreachable code, commented-out blocks left behind
- `console.log` debug leftovers (the sanctioned log surfaces are the `[data:OUTAGE]` /
  `[data]` prefixes and script CLI output), TODO/FIXME with no tracked task
- Non-functional UI (a button with no handler, dead placeholder code)

**Design-system duplication** (inventory: `.interface-design/system.md` → Component patterns)
- Hand-rolled equivalents of existing primitives: a raw styled `<a>`/`<Link>` where
  `TextLink` fits (external links with `target` are the sanctioned exception — copy the
  focus-ring classes), re-implemented load-more buttons, duplicated prose helpers
  (`Em`/`List`/`Li` already have a known-drift chip — don't re-flag, reference it)
- Hardcoded colors: hex is not lint-blocked here, but `rgba(...)` literals slip
  through the regex — both belong in `app/globals.css` tokens (the single `:root` block)
- Depth strategy is borders-only: any new `shadow-*` or `backdrop-blur` is a finding

**Stack conventions**
- Tunables belong in `src/llm/config.ts` — a script or component re-declaring a constant
  locally is a finding (the `voyage-3` backfill bug class)
- Scripts: `import "server-only"` guard, `process.loadEnvFile(".env.local")`, an `npm run`
  entry in package.json, and a README mention
- DB access goes through `src/db/training.ts` — new direct `.from()` calls outside it and
  the known script exceptions (see `docs/maps/data-map.md`) need a reason
- External fetches carry `AbortSignal.timeout`; client data fetches render an explicit
  error/retry state, never a dead end

**Cross-file duplication**
- The same visual section or logic pattern in 2+ files in scope → propose ONE shared
  extraction, not per-file fixes

**Doc coupling**
- If the scope touches schema, queries, pages, pipeline stages, scripts, env vars, AI call
  sites, thresholds, or components — verify the coupled doc changed in the same diff, per
  CLAUDE.md → Documentation Map (README, `docs/maps/*.md`, `.interface-design/system.md`,
  spec supersession notes, `.env.example`, `docs/pre-launch-requirements.md`). A missing
  update is a finding.

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
- Verify with `npm run check` (tsc + vitest) and `npx eslint src scripts`; `npm run build`
  when routes/pages changed.
- Committing routed paths trips the SSDD review gate — reviewers must have run against the
  exact staged diff (see CLAUDE.md → Review gate). Stage by path (`git add -A` is
  guard-blocked); re-check `git status --short` before any commit that follows agent
  activity.
