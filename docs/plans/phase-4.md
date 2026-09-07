# Phase 4 — Gamification vertical slice

Branch: `phase-4-gamification`, off `main` after PR #5 merges.

## Context

Phases 0–3 are merged and CI-green. The app logs training, computes metrics,
generates a validated plan, and speaks it in a persona's voice. What it does not
do is **reward any of it** — and "a game loop that makes training stick" is the
half of `docs/FRAMING.md`'s prototype definition of done that no phase has
touched.

The unusual thing about this phase is how much already exists:

- **The entire schema is built.** `20260824150248_gamification.sql` created
  `achievements`, `achievement_events`, `xp_events` and `challenges` in phase 0,
  with the columns this phase needs — `xp_events.week_start` stored rather than
  derived, `achievement_events` carrying `unique (user_id, achievement_id)`,
  `challenges.validation_reasons` present specifically for phase 4's
  inspectability criterion.
- **The RLS policies were written for this phase's hardest criterion.**
  `xp_events` and `achievement_events` have read-only policies and no write
  policy at all, so "no completion can be granted from the client" is already
  half-enforced. Nothing can write them today, including the app.
- **The XP inputs exist and are tested.** `adherence()` and `currentStreak()` in
  `src/metrics/adherence.ts` were built in phase 1 with comments naming phase 4
  as their consumer. `currentStreak` already counts planned days so scheduled
  rest maintains a streak — the brief's requirement, already satisfied.

So this phase is mostly **plumbing between things that exist**, which is what the
brief says: "This is about plumbing, not content."

### Decisions taken before planning

- **`fast-check` is added as a dev dependency**, through the
  `dependency-versioning` skill (7-day publish-age rule, framework envelope,
  verification gauntlet). The first acceptance criterion is literally "no
  sequence of sessions can breach the ceiling" — a generative claim. Shrinking a
  failure to a minimal counterexample is the difference between a caught bug and
  a seed number.
- **The whole phase ships as one PR.** The brief's framing is "one of each, end
  to end"; splitting it would leave a vertical slice with no bottom.
- **The weekly batch job is a GitHub Actions cron**, reusing the pattern in
  `.github/workflows/keepalive.yml` (already a daily cron at `17 6 * * *`). No
  new infrastructure, and the run is inspectable in the Actions log.

| Acceptance criterion                                         | This phase                     |
| ------------------------------------------------------------ | ------------------------------ |
| Property tests: XP monotonic, never exceeds the weekly cap   | ✅ offline, `fast-check`       |
| A rejected challenge is inspectable — the validator logs why | ✅ `validation_reasons`        |
| A badge visibly fires in the UI on unlock                    | ✅ browser-verified at 375×812 |
| No completion can be granted from the client                 | ✅ RLS + `test:db`             |

---

## The one real security decision

`achievements.predicate` is **SQL text in a table**, and evaluating it means
running dynamic SQL. The `achievements_write` policy lets any authenticated user
insert their **own** achievement row — so a naive evaluator running every
predicate inside a `SECURITY DEFINER` function would execute user-authored SQL
with the definer's privileges. That is a privilege-escalation hole, and it is
reachable today by anyone with an account.

**The evaluator only ever reads system-owned rows (`user_id is null`).** User
rows are content the user can see, never code the server runs. This gets an
executable test, not just a comment: insert a user-authored achievement whose
predicate would be destructive if run, and assert it never executes.

This is the substance of the phase's ADR.

---

## Build order

### 1. `docs/adr/0009-gamification-trust.md` and `docs/specs/xp-and-challenges.md`

Committed **first, in their own commit**, before any code — `CLAUDE.md`, the
artifact trail.

The ADR records three linked decisions:

1. **The weekly ceiling is a database trigger, not only application arithmetic.**
   A `before insert` trigger on `xp_events` refuses any row that would push
   `sum(amount)` for `(user_id, week_start)` past the cap. The TypeScript clamp
   is the policy; the trigger is the guarantee. Same shape as the planner: the
   prompt is the optimisation, the rules are the floor. In normal operation the
   trigger never fires, and a test forces it to.
2. **Predicates execute only for system-owned achievements** — the hole above.
3. **Completion is re-derived, never submitted.** The RPC takes a workout id and
   nothing else; every number it writes it computes from rows already in the
   database.

The spec is authoritative and written before the code, the way
`docs/specs/planner-rules.md` was: the XP formula, the diminishing-returns
curve, the ceiling, streak milestones, the challenge `spec` shape, and the
validator's rejection vocabulary.

### 2. `src/gamification/` — the arithmetic, pure and offline

Mirrors `src/metrics/`: plain shapes in, numbers out, no database.

- **`xp.ts`** — `sessionXp()`, `streakXp()`, `applyCeiling()`. Adherence-based
  only; there is deliberately no tonnage input, matching the `xp_events.source`
  check constraint that already omits one (CLAUDE.md #4). Diminishing returns
  are a declining per-session award within a week, so the 5th session earns less
  than the 1st without ever earning less than zero.
- **`plausibility.ts`** — the brief's "plausibility checks on submitted loads".
  Reuses `exerciseBests()` from `src/metrics/pr.ts`: a set far above the user's
  own established e1RM is implausible and does not count toward a challenge or
  an achievement. Rejections are reasons, not silent drops.
- **`challenge.ts`** — one validator over a `spec`, used by **both** daily quests
  and weekly challenges. The brief asks quests to reuse the challenge validator
  with a shorter window, so window length is a parameter and not a second code
  path.

`fast-check` properties, from the criterion's own words: XP is monotonic in
sessions kept; no generated sequence of sessions, statuses and dates produces a
weekly total above the cap; awards are never negative; the ceiling is reached
but never crossed.

### 3. Migration — the trigger, the RPCs, one achievement, a challenge pool

- The `xp_events` weekly-ceiling trigger.
- `award_session_xp(p_workout_id uuid)` — `SECURITY DEFINER`. Verifies the
  workout belongs to `auth.uid()` and is `completed`, re-derives adherence and
  streak from logged rows, inserts `xp_events`, evaluates system achievement
  predicates, inserts `achievement_events` (the existing unique constraint makes
  "exactly once" a database guarantee), and returns what fired.
- `search_path` pinned on every new function, matching
  `20260824150441_function_search_path.sql`.
- **One achievement**, via the `add-achievement` skill — its migration,
  predicate, humor tier, and the four tests the skill requires (unlocks on the
  condition, does not unlock on a near miss, fires exactly once, hidden
  definitions absent from the client payload).
- A starting pool of unassigned `challenges` rows (`user_id is null`).

### 4. `src/db/gamification.ts` and the wiring

- Reads for the UI: XP this week against the ceiling, lifetime total, unlocked
  badges.
- `app/workouts/actions.ts` — `finishWorkout()` calls the RPC after the status
  update, then redirects to `/workouts?unlocked=<slug>`.

  **Why a query parameter is safe here:** it selects which badge to _reveal_, and
  the page renders it only after finding a matching row in the user's own
  `achievement_events`. A forged parameter shows nothing, because the event has
  to exist. No schema change, no "seen" column.

### 5. Surfaces

- **`app/progress/page.tsx`** — XP this week against the ceiling, the streak,
  the badge shelf, active quests and challenges. Phone-first per
  `docs/specs/mobile-interface.md`, `min-width` queries only, 44px targets.
- **`app/workouts/page.tsx`** — the badge reveal, and XP alongside the streak it
  already renders.

### 6. `scripts/generate-challenges.ts` + `.github/workflows/challenges.yml`

Generates a pool, runs each candidate through the same `challenge.ts` validator,
writes the rejects with their `validation_reasons` rather than dropping them,
and assigns from what survives. A weekly cron, off the hour like the existing
keepalive.

---

## Files

**New:** `src/gamification/{xp,plausibility,challenge,index}.ts` + tests,
`src/db/gamification.ts`, `app/progress/page.tsx`,
`scripts/generate-challenges.ts`, `.github/workflows/challenges.yml`, migrations
for the trigger/RPCs/achievement/pool, `docs/plans/phase-4.md`,
`docs/adr/0009-gamification-trust.md`, `docs/specs/xp-and-challenges.md`.

**Modified:** `app/workouts/actions.ts`, `app/workouts/page.tsx`,
`app/globals.css`, `package.json`, `docs/PLAN.md`.

**Reused rather than rebuilt:** `adherence()` and `currentStreak()`
(`src/metrics/adherence.ts`), `exerciseBests()` (`src/metrics/pr.ts`),
`startOfWeek`/`addDays` (`src/metrics/dates.ts`), `createServerDb`/`currentUser`/
`localDateFor` (`src/db/server.ts`), the `FieldHint` and `format` helpers
(`src/ui/`), and the whole phase-0 gamification schema.

## Verification

| Criterion                      | Proof                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| XP monotonic, cap never broken | `npm test` — `fast-check` properties over generated session sequences                                                       |
| Ceiling cannot be breached     | `npm run test:db` — a direct insert past the cap is refused by the trigger, bypassing all application code                  |
| Rejected challenge inspectable | A test asserting a rejected candidate persists a non-empty `validation_reasons`, and the reason names the failing condition |
| Badge fires in the UI          | Browser at 375×812: finish a workout, see the badge reveal                                                                  |
| No completion from the client  | `npm run test:db` — a user session's direct insert into `xp_events` and `achievement_events` is refused by RLS              |
| User predicates never run      | `npm run test:db` — a user-authored achievement row's predicate is never executed by the evaluator                          |

Plus the standing gates: `npm run verify` (typecheck, lint, format, 499+ tests,
both eval modes), `npm run test:db`, `npm run build`.

## Notes

- The plan and both artifacts are committed **before** the code they govern, in
  their own commit.
- `npm run seed` gains XP and achievement history for the archetypes, so
  `/progress` is not empty on a fresh demo.
- Docker is not needed — the hosted project takes the migrations via
  `npm run db:push`, per the leave-nothing-running rule in `CLAUDE.md`.
- `fast-check` goes through the `dependency-versioning` skill before install,
  not after.

---

## Outcome — 2026-09-02

**All four acceptance criteria met.**

| Criterion                                                    | Status | Proof                                                        |
| ------------------------------------------------------------ | ------ | ------------------------------------------------------------ |
| Property tests: XP monotonic, never exceeds the weekly cap   | ✅     | `fast-check`, 10,000 generated cases on the ceiling property |
| A rejected challenge is inspectable — the validator logs why | ✅     | 14 rejections written with reasons; rendered on `/progress`  |
| A badge visibly fires in the UI on unlock                    | ✅     | Browser at 375×812, real data, whole path                    |
| No completion can be granted from the client                 | ✅     | `npm run test:db` — 28 at the time, 60 across the suite now  |

### What the phase actually cost

Very little, because phase 0 had already built for it. The whole gamification
schema existed, and its RLS policies were written with this phase's hardest
criterion in mind — `xp_events` and `achievement_events` had read-only policies
and no write policy at all, so "no completion can be granted from the client"
was half-enforced before a line of phase 4 was written. `adherence()` and
`currentStreak()` were built in phase 1 with comments naming phase 4 as their
consumer.

### Three things found by doing the work

**A privilege escalation, found while planning.** `achievements.predicate` is
SQL text in a table, and the phase 0 policy `achievements_write` lets any
authenticated user insert their own achievement row. An evaluator that ran every
predicate inside a `SECURITY DEFINER` function would have executed user-authored
SQL with the definer's privileges — reachable by anyone who could sign up.
Closed by scoping the evaluator to `user_id is null`, with a test that would
catch its removal. [ADR 0009](../adr/0009-gamification-trust.md) §3.

**A double-award, found in browser verification.** `award_session_xp` was
idempotent for achievements — `achievement_events` carries
`unique (user_id, achievement_id)` — but not for XP. A second call for the same
completed workout returned `{"awarded": 64}` again, reachable by a double submit
because the status update that precedes it is itself idempotent. Fixed as a
database guarantee (`xp_events.workout_id` plus a partial unique index) rather
than a check in the function, for the same reason the ceiling is a trigger.

**A false claim in a comment, found by a test.** Migration 20260902090000 said
`evaluate_achievements` was "NOT granted to authenticated". It was: Postgres
grants `EXECUTE` to `PUBLIC` by default and Supabase adds `authenticated`, and
the migration revoked only from `public` and `anon`. Since the function answers
"which achievements would fire", including hidden ones, it walked around the
`achievements_read_visible` policy. This is the **second** time on this project
that revoking from `public` has failed to revoke from a Supabase role — the
first was `20260901145239` for table grants.

### Found by review afterwards — 2026-09-02

A review of the finished branch produced fourteen findings that survived
verification. All are fixed; the pattern in them is worth more than the list.

**Three of the four acceptance criteria were met in the happy path and false in
general.** "No sequence of sessions can breach the ceiling" was enforced by a
`before insert` trigger, so an UPDATE walked past it — and `UPDATE` is granted
to `authenticated` on every table by `20260824150321`. The same check read
`sum(amount)` with no lock, so two concurrent writers each saw the same room
under the cap and each took it: a _sequence_ stayed inside the ceiling, a _pair_
did not. The criterion says "no sequence", and the code answered "no sequence
via the intended path" — the exact distinction ADR 0009 §2 draws in prose, and
then failed to implement.

**The engine and the database disagreed about the same week.** `award_session_xp`
required `status = 'completed'` to award while counting `('completed','rest')`
for position, so a rest day paid nothing and still pushed later sessions down
the curve — 0 + 80 where `weeklyAwards()` pays 100 + 80. The floor computed a
different number than the policy, which makes it not a floor.

**The one shipped achievement could not fire for most users.** Its predicate
anchored a seven-day window to `max(local_date)` over all workout rows with no
status filter, while counting only kept ones, so one skipped day — or any
future session the planner schedules — slid the window forward and left six kept
days inside it.

**Validation was decorative in four places.** `target_unreachable` never fired
for `distinct_exercises`, so a bodyweight user with two movements was offered
five. `reward_out_of_band` compared only against the 500 ceiling, unreachable
through a schema capped at 150, so a stale row carrying 300 validated clean. A
missing RPE threshold was reported as `reward_out_of_band`, which names the
wrong field in a column whose purpose is being read by a human. And `sessions`
counted workout rows rather than days, so "three sessions this week" was
finished in one afternoon.

**Two plausibility holes, both in the range the check exists for.** Warmups
counted toward challenges, so three empty-bar sets completed a three-movement
challenge with no typo required. And Epley returns null above twelve reps, so
`checkPlausibility` returned early and never judged a high-rep set at all —
400 kg for 15 was accepted, which is precisely the "400 instead of 40" it was
written to catch.

**The fix for the double-award introduced a latent bug of its own.** The
once-per-workout index was keyed on `(workout_id, source)`, which also covers
achievement rows, so a session unlocking two achievements collided on the
second. Because plpgsql rolls back a block's database work but keeps its
variables, the slug was already in `unlocked` — the badge would have fired while
the `achievement_events` row vanished. Latent only because one achievement
exists.

The through-line: nearly every finding is a guarantee that was stated correctly
in prose and implemented for the path someone had in mind. The migrations and
ADR 0009 §2 now carry the corrections inline rather than being edited to look
right.

### Measured, live

Signing in as the plateaued archetype and finishing a session awarded 64 XP —
the third kept day of the week, per the diminishing curve — plus 75 for the
unlock, and the banner fired. `/progress` showed 139 of 500. The challenge
generator produced genuinely different results per user: the plateaued archetype
had five weekly challenges rejected as `below_current_ability` ("already at 14
against a target of 8 before starting"), while the beginner was offered them.

### Known gaps

All four are now closed — three on 2026-09-02 after the review below, the last
by the branch this entry describes. The entries
are kept rather than deleted, because what was missed and when is part of what
this document is for.

- ~~**`schema-invariants.test.ts` does not run locally**~~ — **closed.** It reads
  `pg_catalog` directly, which PostgREST does not expose, so it needs a real
  Postgres connection and defaulted to `127.0.0.1:54322` — the local Docker
  stack this project otherwise avoids. Pointing `SUPABASE_DB_URL` at the hosted
  **pooler** runs it against the real database instead; the direct-connection
  host is IPv6-only and fails from most networks. `npm run test:db` now runs all
  five files, 60 tests, on a workstation with no Docker at all.

  Getting there cost three wrong diagnoses, which is the interesting part. The
  first message never appeared, because `new Client()` parses the URL eagerly
  and the construction sat outside the try. The second blamed the
  `[YOUR-PASSWORD]` placeholder for an unparseable URL — reproducing it showed
  brackets parse fine and fail at authentication with `28P01`. The third sent
  the reader after percent-encoding when the real value had been truncated at
  the `@` by a line wrap in `.env.local`, because dotenv keeps only what is on
  one line. Each is now its own branch with its own message, and each was
  reproduced deliberately rather than reasoned about.

- ~~**The seeder produces one rest day per week**~~ — **closed.** It emitted one
  rest day at offset 5, so a three-day archetype covered four days of seven and
  "Seven for Seven" could not fire for anyone; it had been verified during the
  phase by adding rest days to the dev database by hand, which was the tell.
  Every day a programme does not train is now a rest day. Four of the five
  archetypes reach kept runs of 30 to 58 days; `inconsistent` tops out at 6,
  which is correct for a 0.5-adherence archetype. Layoff weeks are deliberately
  left empty — filling them would hand `returning` an unbroken streak across the
  months it was away.
- ~~**Streak milestone XP is computed and tested but never written**~~ —
  **closed** by `20260902110000_streak_milestone_xp.sql`. The award is derived
  in the RPC, because XP can only be written by a definer function. That
  duplicates `currentStreak()` and the milestone constants in SQL, which
  `tests/db/gamification.test.ts` now pins — including the case where the two
  definitions could most easily diverge: `currentStreak` skips days with nothing
  scheduled, so an every-other-day programme reaches seven kept sessions across
  thirteen calendar days, and a calendar-day reading in SQL would have scored
  that 1 while the UI showed 7.
- ~~**Challenge completion is never paid out**~~ — **closed**, with the decision
  recorded as ADR 0009 §4. `src/gamification/settlement.ts` decides what is
  finished by calling `evaluateChallenge` — the same function the progress
  surface calls, so there is one definition — and applies the ceiling
  cumulatively across a batch, so four completions at once cannot jointly breach
  a cap that each of them individually fitted under.

  It runs in `scripts/generate-challenges.ts` rather than in `finishWorkout`,
  and the reasoning is the substance of the ADR: a definer function that paid
  out would have to re-derive completion in SQL — the second evaluator the spec
  warns against — or trust its caller, which lets any signed-in client be paid
  for work it did not do. A batch job has neither problem and exposes no
  endpoint. The idempotency guard is the status transition itself: the `UPDATE`
  filters on `status in ('offered','active')`, so a second run matches no row.

  **What it costs, recorded rather than glossed:** payout is not immediate. A
  challenge finished mid-session pays on the next batch run, so the completion
  cannot fire a banner the way a badge does. Buying that back honestly means the
  SQL re-derivation, pinned case by case against `evaluateChallenge` — not a
  trusted RPC.
