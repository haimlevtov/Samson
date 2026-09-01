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
| `equipment_available`    | Every `exercise_id` appears in the candidate list                              |
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

## Outcome

_Pending. Filled in when the phase meets its acceptance criteria, per the
Documentation coupling in `.claude/skills/cleanup/SKILL.md`._

**AI-NOTE:** this file was committed **before** any phase 2 implementation code,
deliberately. Phases 0 and 1 committed their plan in the same commit as the work
it planned, which cannot demonstrate the ordering the course grades. `git log
--diff-filter=A -- docs/plans/phase-2.md` should precede every `src/planner/`
commit. Keep it that way for later phases.
