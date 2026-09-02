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
