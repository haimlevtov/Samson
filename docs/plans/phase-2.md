# Phase 2 — Planner and critic

## Context

Phases 0 and 1 are complete and pushed. Every number the app shows is now
deterministic code with tests, and `npm run seed` builds five archetypes with
8–16 weeks of plausible history. That history exists for exactly one reason: it
is the only way to develop the planner without waiting months for real data.

PLAN.md calls this the highest-unknown phase and schedules it early **so that if
it does not work there is still time to change course**. It is also the phase
that decides definition-of-done (c) — "it coaches" — together with phase 3.

The arrangement is the **evaluator-optimizer** pattern: the planner produces, the
critic judges, the planner revises until the work passes.

### The constraint that shapes this plan

There is no `OPENROUTER_API_KEY` in `.env.local`, and it is not being added this
phase. That does **not** block the build, because phase 0 made every LLM call
injectable — `callLLM(options, deps)` takes `fetch`, a clock and a ledger as
arguments. The loop takes `callLLM` itself as a dependency, so the entire
evaluator-optimizer machine is unit-testable against a scripted fake model with
no key, no network and no database.

What it does block is **measurement**, and that split is stated honestly here
rather than discovered at the end:

| Acceptance criterion                                                                             | This phase                  |
| ------------------------------------------------------------------------------------------------ | --------------------------- |
| Golden cases produce a schema-valid plan within the retry cap                                    | ✅ against a scripted model |
| Property assertions hold across all cases                                                        | ✅                          |
| Every rule has a test that fails a violating plan; the two rejection sources are never conflated | ✅                          |
| Cache hit rate measured and recorded                                                             | ❌ **needs a key**          |
| Cost per plan generation recorded per model tried                                                | ❌ **needs a key**          |

The offline run proves the _machinery_ — loop control, rule enforcement,
rejection routing, escalation, ledger writes. It proves nothing about whether a
real model writes good training. Claiming otherwise would be exactly the
verification theatre Lesson 8 names, so the phase-2 Outcome section will record
those two criteria as **unmet**, not skipped.

### A gap in the schema, same class as phase 1's

There is **no table for generated plans**. `llm_calls` records calls, not
verdicts — and a rule rejection is not a call at all, so it can never appear
there. Without a new table the acceptance criterion "the two rejection sources
are never conflated in the ledger" is unimplementable.

A `plan_runs` migration fixes it, carrying the accepted block, the loop count,
and a `rejections` array where every entry is tagged `rules` or `critic`.

---

## Build order

### 1. `docs/adr/0004-planner-critic.md` — before any agent runs

PLAN.md requires the coordination design written first, and it is the phase's
first artifact deliberately: a coordination standard invented after the code
bends to fit the code. Names the pattern; each agent's role, input, output and
boundary; how work passes between them; what happens on failure; what the
arrangement costs and buys.

Decisions it records:

- **Rules run before the critic.** Cheap deterministic gates first — the same
  ordering as PLAN.md's merge gate. A plan violating a numeric cap is
  definitively bad, and paying a model to re-derive what arithmetic already
  knows is waste.
- **The critic runs on a different model** — already encoded in
  `src/llm/models.ts`: planner is `anthropic/claude-sonnet-5`, critic is
  `google/gemini-2.5-flash`. A critic sharing the planner's weights shares its
  blind spots.
- **Handoffs carry structure, never prose.** Rejections are arrays of
  `{ code, detail, ... }`, fed back as JSON. Flattening to prose loses the shape
  and the next stage guesses it back — occasionally wrong, always silently.
- **Escalate rather than repeat.** The gateway already retries schema failures
  with the validation error attached. What it cannot do is change model: its
  `models` array is an OpenRouter fallback that triggers on transport errors, not
  on a schema-invalid response. So the _loop_ escalates, passing an explicit
  stronger `models` override on the final iteration.

### 2. `src/planner/schema.ts` — Zod first

Single source of truth for both the LLM structured output and runtime validation,
per CLAUDE.md conventions. `z.infer` for every type; no hand-written duplicates.

- `plannerInputSchema` — metrics summary, goal, available days, equipment with
  ceilings, injury flags, and the candidate exercise list
- `trainingBlockSchema` — weeks → sessions → prescribed sets, each referencing a
  candidate `exercise_id`
- `criticVerdictSchema` — `{ approved: boolean, reasons: [{ code, detail, severity }] }`

### 3. `src/planner/rules.ts` + `docs/specs/planner-rules.md`

Pure functions over `(block, context)`, returning `RuleFinding[]`. Run on every
plan regardless of what the critic says.

| Rule                     | Gate                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| `weekly_volume_increase` | Week-over-week tonnage increase within cap                                     |
| `acwr_band`              | Projected ratio not in `danger` — reuses `acwrBand` from `src/metrics/acwr.ts` |
| `deload_cadence`         | A deload week present by week 5                                                |
| `equipment_available`    | Every `exercise_slug` appears in the candidate list                            |
| `load_ceiling`           | No prescribed weight above `user_equipment.max_load_kg`                        |
| `injured_joint`          | No exercise loading a flagged joint                                            |

**AI-NOTE for the implementer:** if a rule can be written as a comparison
against a number, it belongs here. Only genuinely holistic judgement goes to the
critic.

**Test authorship is separated for this module.** I write `rules.ts` and the
spec; a subagent writes `src/planner/rules.test.ts` **from `docs/specs/planner-rules.md`
alone**, never seeing the implementation. This is the Lesson 7 gap FRAMING.md
records — tests written by reading the code cannot catch a rule that is
self-consistently wrong. The spec states each rule's contract in input/output
terms and names the boundary values, and nothing else.

### 4. `src/planner/loop.ts` — the evaluator-optimizer

```
generatePlan(input, deps) →
  for iteration 1..3:
    block   = callLLM(stage:'planner', schema: trainingBlockSchema)
    findings = checkRules(block, context)          ← deterministic, always
    if findings → record 'rules' rejection, feed back as JSON, continue
    verdict = callLLM(stage:'critic', schema: criticVerdictSchema)
    if !approved → record 'critic' rejection, feed back as JSON, continue
    return accepted
  return exhausted
```

`deps` is `{ callLLM, plans, now }` — same injection discipline as
`GatewayDeps`, so the whole loop runs in the unit suite with a scripted model.
Candidates come from `availableExercises` in `src/db/exercises.ts`, which already
filters equipment **in SQL** (invariant #5) and is the same function the phase 1
picker uses.

### 5. `plan_runs` migration + `src/db/plans.ts`

```sql
create table public.plan_runs (
  id, user_id, status text check (status in
    ('accepted','rejected_rules','rejected_critic','exhausted','failed')),
  iterations int, block jsonb, rejections jsonb not null default '[]',
  input_hash text, created_at
);
```

RLS on, `user_id` on every row, policies matching `llm_calls` (invariant #10).
`src/db/plans.ts` exposes a `PlanRunStore` interface with one Postgres
implementation — mirroring how `LedgerClient` keeps the gateway database-free.
Regenerate `src/db/types.ts`; the CI `db` job fails on a stale diff.

### 6. `src/planner/prompts.ts` — static-first

Invariant content first so the cache prefix holds and `prompt_prefix_hash`
becomes meaningful; user-specific data last. Untrusted text — `workouts.notes` —
is passed as user-role content and never interpolated into `system`.

### 7. Golden set + offline eval

`tests/planner/golden.ts` builds 30 cases as **5 archetypes × 6 scenario
variants** (goal × days available × injury flag), reusing `generateHistory` and
`mulberry32` from `src/seed/` so cases are reproducible. Property assertions, not
expected plans.

`scripts/eval-planner.ts` (`npm run eval:planner`) runs the set. Offline with a
scripted model by default — the CI-safe path. A `--live` flag exists and is
wired, and stays unrun until a key exists.

---

## Files

New: `src/planner/{schema,rules,loop,prompts,context,index}.ts`,
`src/planner/rules.test.ts` (separate author), `src/db/plans.ts`,
`tests/planner/golden.ts`, `tests/unit/planner-loop.test.ts`,
`scripts/eval-planner.ts`, `docs/adr/0004-planner-critic.md`,
`docs/specs/planner-rules.md`, a `plan_runs` migration, `docs/plans/phase-2.md`.

Reused rather than rebuilt: `callLLM` + `GatewayDeps` (`src/llm/gateway.ts`),
`STAGE_MODELS` (`src/llm/models.ts` — `planner` and `critic` already defined),
`availableExercises` + `userEquipment` (`src/db/exercises.ts`), `acwr` /
`acwrBand` / `tonnageByWeek` (`src/metrics/`), `generateHistory` + `ARCHETYPES`
(`src/seed/archetypes.ts`), `createUserClient` (`src/db/client.ts`).

Token budgets per stage go in `src/llm/config.ts`, not at call sites.

## Verification

| Criterion                                            | Proof                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Schema-valid plan within the retry cap, all 30 cases | `npm run eval:planner` — offline, scripted model                                               |
| Property assertions hold                             | Same run: volume within cap, no unavailable equipment, deload by week 5, injured joints absent |
| Every rule fails a violating plan                    | `npm test` — `rules.test.ts`, written from the spec by a separate author                       |
| Rejection sources never conflated                    | `planner-loop.test.ts` asserts a rules rejection never writes a `critic` entry and vice versa  |
| Cache hit rate / cost per model                      | **Not met.** Recorded as unmet in the Outcome section.                                         |

Plus the existing suites stay green: `npm run typecheck && npm run lint && npm test`,
and `npm run test:db` for the new table's RLS.

## Notes

- Materialising an accepted block into `workouts`/`sets` rows is **out of scope**.
  Phase 2's criteria are generation and validation; delivery is phase 3's persona
  layer. `plan_runs.block` holds the JSON until then.
- Docker is not needed. The hosted Supabase project takes the migration via
  `npm run db:push`, per the leave-nothing-running rule in CLAUDE.md.
- If the loop fails to converge on the golden set, that is the phase working as
  designed — it is scheduled early precisely to surface that while there is time.

---

## Outcome — 2026-09-01

**Three of five acceptance criteria met. Two are not, and they are named rather
than quietly dropped.**

| Criterion                                                                                        | Status                     |
| ------------------------------------------------------------------------------------------------ | -------------------------- |
| Golden cases produce a schema-valid plan within the retry cap                                    | ✅ 30/30, offline          |
| Property assertions hold across all cases                                                        | ✅                         |
| Every rule has a test that fails a violating plan; the two rejection sources are never conflated | ✅                         |
| Cache hit rate measured and recorded                                                             | ❌ **unmet — needs a key** |
| Cost per plan generation recorded per model tried                                                | ❌ **unmet — needs a key** |

`npm run eval:planner --live` is written, wired and unrun. It signs in as each
seeded archetype, runs the same thirty cases against real models, and reads the
cache and cost figures back out of `llm_calls`. It needs `OPENROUTER_API_KEY`
in `.env.local` and nothing else. Until it runs, the last two rows above stay
red and no report may claim otherwise.

### What was verified, and what that verification is worth

377 tests pass; typecheck, lint and format are clean.

- **The six rules are jointly satisfiable on all thirty histories.** This is the
  phase's central risk retired. Had the volume cap, ACWR guard, deload
  requirement, load ceilings and injury exclusions been mutually unsatisfiable
  for any archetype, that user could never have been given a plan and no amount
  of prompting would have fixed it.
- **A block breaking every rule is rejected by arithmetic before the critic is
  consulted** — 360 rules rejections, zero critic rejections, across
  `--naive`. That is the ordering ADR 0004 specifies, shown rather than
  asserted.
- **The rejection sources never merge.** A rules finding never acquires a critic
  vocabulary code and vice versa, exhaustion names the gate that failed, and a
  budget denial is recorded as `failed` rather than as a rejection.

**What none of it proves is that a model writes good training.** The stub
planner satisfies the rules by construction. Reporting the green table as
evidence of planner quality would be precisely the verification theatre the
merge gate section of `docs/PLAN.md` warns against.

### The separated test author

`src/planner/rules.test.ts` was written by a subagent working in a git worktree
at `ece24c6` — a commit containing the spec and the schema but not
`rules.ts`. The separation was structural: the implementation was not on disk
to read.

All 55 cases passed on the first run. Read honestly that says the spec was
precise enough for two readers to build the same thing, not that the tests are
exhaustive — the author was explicit about which fixtures deliberately do not
discriminate, and those are now recorded under "Known gaps" in the spec.

Three findings came out of it that reading my own code would not have produced:
the rule functions were never named in the spec, only their codes; week identity
was stated under one rule and relied on by four; and the `JOINT_LOADING`
vocabulary was checked against nothing, so a typo would have silently stopped
protecting a joint rather than erroring.

### Deviations from the plan

1. **`plan_runs` was applied to hosted via the Supabase MCP server, not
   `npm run db:push`.** The CLI is not linked and there is no `SUPABASE_DB_URL`
   in `.env.local`. Applied as version `20260901115234`.
2. **Local migration filenames now match applied remote versions.**
   `user_equipment` was stamped `20260825080000` locally and
   `20260825071917` remotely; a `db push` would have tried to apply it twice.
3. **`src/db/types.ts` was hand-edited rather than regenerated wholesale.** The
   committed file predates the wrapper format the current generator emits, so a
   full regeneration would have produced a large unrelated diff. The
   `plan_runs` block is the generator's own output, inserted in the file's
   existing style. CI regenerates and diffs, so this is verified there and
   nowhere else.
4. **`CandidateExercise` gained an `equipment` field.** `load_ceiling` needs
   per-item ceilings, and a rule that reaches back into the database is no
   longer a pure function over the plan.
5. **The eval harness gained `--naive`.** Without it the offline run only ever
   sees compliant plans and never exercises rejection, retry or escalation.
6. **Escalation guarantees no downgrade rather than an upgrade.** ADR 0004 calls
   for a stronger model on the last iteration; every slug in `models.ts` was
   verified against the provider's model list for structured-output support, and
   inventing an unverified one would fail every escalated call at routing time.
   `ESCALATION_MODELS` therefore drops the cheap fallback rather than adding a
   higher tier. Recorded in `models.ts` so the phase report cannot claim a
   cascade saving it did not measure.

### Found on the way, none of it phase 2's doing

- `npm run lint` and `npm run format:check` had been failing since the
  superpowers skills landed in `b84f0f4` — 125 lint errors from vendored `.js`
  under `.claude/skills`, and 48 unformatted vendored markdown files. Both
  tools now ignore `.claude` and `.agents`.
- An AI-NOTE in `schema.ts` named the model provider, which trips the
  invariants grep for CLAUDE.md #2. The grep cannot tell a comment from a fetch,
  and that bluntness is the point — the comment was reworded, not the check.
- `tests/planner/golden.ts` used `__dirname` under `"type": "module"`.
  Vitest shims it; `tsx` does not, so the suite passed while the eval script
  failed on the same line.

### Still open

- The two measurement criteria above.
- **The block schema enumerates every set individually**, so a four-week block
  runs to a few thousand output tokens. A `{ count, reps, weight_kg }` grouping
  would cut that by roughly three. Not changed mid-phase because the rules tests
  were already being authored against this shape. Revisit before phase 3, with
  the measured cost in hand.
- **The critic has never rejected a real plan.** Every critic rejection so far
  is scripted. Whether the closed vocabulary in `schema.ts` matches what a
  model actually wants to say is unknown until the live run.
- Phase 0's live gateway call is still unrun and the phase 0 and 1 PRs were
  never opened, so CI has still never executed.
