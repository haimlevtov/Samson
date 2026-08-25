# Phase 1 — Deterministic substrate

## Context

Phase 0 is committed on `phase-0-foundations`: schema, gateway, ledger, CI, and
executable invariants. Three of its four acceptance criteria are verified; the
live gateway call is blocked on an OpenRouter key and the PR has not been opened,
so CI has never run. Neither blocks this phase.

Phase 1 builds every number the app will ever show. Invariant #1 says the LLM
never computes one, so this is where correctness actually lives — an e1RM that
drifts or a tonnage that silently counts bodyweight is a wrong number the coach
will then confidently narrate.

PLAN.md is explicit about what is on the critical path here, and it is not the
part that looks important: **the seeder**. Without 8+ weeks of plausible history
there is no way to develop or evaluate the phase 2 planner, and real history
takes months to accumulate. It looks like throwaway work and it is not.

### Decisions taken before planning

- **Free Exercise DB only** (873 exercises, Unlicense/public domain). The ingest
  is built source-agnostic so wger can be added in phase 5, where content fill
  belongs and where its CC-BY-SA attribution work can be paid for deliberately.
- **Full logging UI including the rest timer**, as the build list literally reads.

### A gap in the phase 0 schema

There is **no table linking a user to the equipment they own**. `equipment_tags`
is a catalogue and `exercise_equipment` joins exercises to tags, but nothing says
"this user has a barbell". Invariant #5 — the planner selects only from a
pre-filtered candidate list, filtered in SQL — cannot be implemented without it.
PLAN.md's phase 0 table list omitted it as well, so this is a genuine gap rather
than something skipped.

A `user_equipment` migration fixes it, carrying an optional `max_load_kg` so the
"home-gym user with capped dumbbells" archetype is expressible rather than
approximated.

---

## Build order

Stage 1 has no infrastructure dependency at all and everything else is checked
against it, so it lands first.

### 1. Metrics engine — `src/metrics/`

Pure functions over plain arrays. No Supabase types, no I/O, no clock except one
passed in. This is what makes "near-total unit coverage, runs in milliseconds"
achievable rather than aspirational.

| Module | Contents |
|---|---|
| `e1rm.ts` | Epley: `w × (1 + reps/30)`. **Returns null above ~12 reps** rather than a confident wrong number — Epley drifts badly in that range, and a null the UI can hide beats a figure the coach will quote. |
| `tonnage.ts` | Session, weekly, and by muscle group via `exercises.primary_muscle` / `secondary_muscles`. |
| `adherence.ts` | Completed ÷ planned over a window, with `status = 'rest'` counting as adherent — invariant #4, rest days maintain streaks. |
| `pr.ts` | Best e1RM and best weight-at-reps per exercise, **computed from set history, not stored**. A stored PR is a cache that can disagree with the log. |
| `acwr.ts` | 7-day acute ÷ 28-day chronic, uncoupled. Thresholds stay config, not constants buried in a formula. |

**Bodyweight decision, to be documented in `tonnage.ts`:** tonnage counts external
load only, so a bodyweight pull-up contributes zero. The alternative — imputing
`users.bodyweight_kg` — would silently rewrite historical tonnage whenever a user
updates their weight, because phase 0 stores one current value rather than a
series. Zero is wrong in a stable, explainable way; imputation is wrong in a
moving one.

Tests: table-driven cases plus property assertions (tonnage is monotonic in reps,
e1RM is monotonic in weight, adherence stays within 0..1). Adds
`@vitest/coverage-v8` as the only new dev dependency.

### 2. Catalogue ingest — `scripts/fetch-catalogue.ts`

Fetches Free Exercise DB, normalises, and writes `data/exercises.snapshot.json`,
**committed to the repo**.

WHY a snapshot: `npm run seed` has to finish in under a minute from an empty
schema and has to work on stage. A live fetch makes the demo depend on GitHub
being reachable, which is a bad trade for data that changes a few times a year.

**Equipment normalisation** is the real artifact here — it is what lets a second
source be merged later without rework:

```
e-z curl bar → ez-bar        kettlebells    → kettlebell
bands        → resistance-band   exercise ball → stability-ball
body only    → bodyweight    cable          → cable-machine
null / other → other
```

**`movement_pattern`** derives `push`/`pull` from `force` and `isolation` from
`mechanic`, and is left **NULL where not confident**. A curated override list
covers the ~25 compound lifts the planner actually programs, which is where
`squat`/`hinge`/`carry` come from. The existing CHECK constraint has no `static`
value and none is added: NULL beats a wrong label on 104 stretching entries.

### 3. Seeder — `scripts/seed.ts`, `npm run seed`

Deterministic PRNG (mulberry32, ~10 lines, no dependency) from a fixed constant,
so a run is reproducible and "looks plausible" stays a stable judgement between
sessions.

The five archetypes PLAN.md names, each 8+ weeks:

1. **Beginner** — clean linear progression
2. **Plateaued** — e1RM flat for 6+ weeks, the case the planner must notice
3. **Returning from a layoff** — a gap, then reduced loads
4. **Home gym, capped dumbbells** — drives `user_equipment.max_load_kg`
5. **Half adherence** — misses roughly half of planned sessions

`local_date` comes from each user's own timezone, not the server's — invariant #9,
and the only way phase 5's calendar achievements can be tested honestly. Runs
with the service role, which is allowed in `scripts/` and asserted absent from
`src/` by the existing invariants test.

### 4. Logging UI

- **Auth**: email + password on `@supabase/ssr` cookie sessions, with middleware
  refresh. Sign in, sign up, sign out. None of this exists yet.
- **Session flow**: `/workouts` list → `/workouts/[id]` with set entry for
  weight, reps, RPE, and a warmup flag.
- **Rest timer**: client countdown seeded from `sets.rest_seconds`, surviving
  re-render. **The cue at zero is isolated behind one call site**, because phase 3
  replaces it with a precomputed persona audio clip.
- **Exercise picker filtered by `user_equipment` in SQL** — invariant #5's first
  real use, and the reason stage 2's normalisation matters.
- All writes go through server actions on the request-scoped RLS client from
  `src/db/client.ts:createUserClient`. No service role on any request path.

---

## Files

New: `src/metrics/*`, `scripts/fetch-catalogue.ts`, `scripts/seed.ts`,
`data/exercises.snapshot.json`, a `user_equipment` migration, `app/(auth)/*`,
`app/workouts/*`, `middleware.ts`.

Reused: `createUserClient` and `Db` from `src/db/client.ts`, generated types from
`src/db/types.ts`, and the fixture pattern in `tests/db/helpers.ts`.

## Verification

| Acceptance criterion | Proof |
|---|---|
| Metrics engine has near-total unit coverage and runs in milliseconds | `npm test -- --coverage` on `src/metrics/`, with the suite's own runtime asserted |
| `npm run seed` produces a demoable database in under a minute from an empty schema | `npm run migrate && time npm run seed` |
| Every synthetic user's metrics look plausible on manual inspection | Open each of the five seeded users in the running UI |

Plus the phase 0 suites stay green: `npm run test:db` for RLS, and the invariants
test, which will now also cover the `user_equipment` table.

## Notes

- The migration means regenerating `src/db/types.ts`; the CI `db` job fails on
  stale types, which is the intended reminder.
- If time compresses, the inspection views are worth more than the entry forms —
  they are what an acceptance criterion actually depends on.
- Docker must be running for stages 2–4. Stage 1 needs nothing.
