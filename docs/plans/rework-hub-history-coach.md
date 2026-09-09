# Rework — the Hub, the graphs, the demo data, and the Coach

Planned 2026-09-09, before any of the code below. Eight PRs: this plan, then
seven changes in the order given.

**This is a rework, not a phase.** Phase 6 was the last one and it is closed.
`rework-profile-hub-coach.md` is the precedent for the shape: a list of changes
that came from using the app rather than from `docs/PLAN.md`, planned together
because several of them touch the same surface.

## Status — planned

| PR  | What                                                                                      | Branch                 | State   |
| --- | ----------------------------------------------------------------------------------------- | ---------------------- | ------- |
| 1   | [This plan](#pr-1--this-plan)                                                             | `rework-plan`          | planned |
| 2   | [The leaderboard ranks by level](#pr-2--the-leaderboard-ranks-by-level)                   | `leaderboard-level`    | planned |
| 3   | [Challenges and quests the Hub can offer](#pr-3--challenges-and-quests)                   | `hub-challenges`       | planned |
| 4   | [The graphs show their numbers](#pr-4--the-graphs-show-their-numbers)                     | `history-graph-values` | planned |
| 5   | [Templates and a full profile for the demo users](#pr-5--the-demo-users-are-furnished)    | `seed-furnishings`     | planned |
| 6   | [Hear a coach before you pick one](#pr-6--hear-a-coach-before-you-pick-one)               | `persona-preview`      | planned |
| 7   | [A plan becomes a template](#pr-7--a-plan-becomes-a-template)                             | `plan-to-template`     | planned |
| 8   | [One box on Coach, and a plan you can ask for](#pr-8--one-box-and-a-plan-you-can-ask-for) | `coach-one-box`        | planned |

PR 8 carries two of the requested changes because they are the same surface and
would conflict as separate branches.

## Two things decided before planning, and who decided them

Both came back from the stakeholder on 2026-09-09 and both change what gets
built, so they are recorded here rather than inferred later.

1. **The Coach keeps one question box, and it answers everything** — training,
   diet and supplements. The chat panel and the supplement card go as separate
   surfaces; the stage underneath does not. ADR 0015's fencing, its refusal
   constants and its adversarial suite all survive the move.
2. **Plan generation gets built, with its limits accepted.** The questionnaire,
   the action and the planner wiring are real. What it cannot do is produce a
   plan without an API key, and it may exceed the function timeout on a long
   block — both stated in PR 8 rather than discovered.

---

## PR 1 — this plan

**Branch `rework-plan`.** Documents only, committed before the code it plans —
`CLAUDE.md`, and the reason `docs/plans/phase-5.md` had to be written as a record
instead.

---

## PR 2 — the leaderboard ranks by level

**Branch `leaderboard-level`.**

The Hub shows lifetime XP. It should show level.

### It needs no migration, and that is the finding

**`levelForXp` is monotonic in XP**, so ordering by level and ordering by XP
produce the **same sequence**. The request is a display change, not a sort
change, and the view's `rank()` can stay exactly as it is.

**The level is computed in TypeScript, from the `lifetime_xp` the view already
returns.** `src/gamification/level.ts` is the single definition of the curve —
`LEVEL_BASE_XP`, `LEVEL_GROWTH`, and the per-step rounding whose AI-NOTE explains
why a closed-form sum drifts. Reimplementing that in SQL would be a second
definition of one number, which is the failure this repo has recorded three times
(the badge and the progression chart disagreeing about a set; the seeder's
session count; `sessions_last_28_days`). So `src/db/leaderboard.ts` maps the rows
through `levelForXp` and the view is untouched.

No migration means no `src/db/types.ts` regeneration and **no Docker**.

### The one real decision: what a tie means

Level buckets XP, so a level-only ranking puts many users on one rank. Two
readings:

- **Keep the total order, show the level** — rank still comes from XP, the figure
  the user reads is their level. Fifteen people at level 7 still have fifteen
  different positions.
- **Rank by level, ties shared** — everyone at level 7 is rank 7.

**Proposed: the first.** A leaderboard exists to be a ladder, and one where a
third of the table shares a position stops being one. The level is what is
displayed and what the user cares about; XP remains the tiebreak, invisibly. If
the second is wanted, say so — it is a one-line change to `rank()` and it does
need the migration this PR otherwise avoids.

### Documents this changes

- **ADR 0016** exposes "four values, not two" and names them. It gains an
  amendment: the view still exposes those four, and `lifetime_xp` is now an
  input to a derived figure rather than the figure itself.
- `docs/specs/xp-and-challenges.md` carries the level curve and should say the
  leaderboard reads it.

### Acceptance

- `tests/db/leaderboard.test.ts` still passes unchanged — the view did not move.
- A unit test asserts the mapping: a row with N XP shows `levelForXp(N)`, and
  ordering is unchanged from the view's.
- Browser at 375×812, both themes.

---

## PR 3 — challenges and quests

**Branch `hub-challenges`.**

The Hub renders three buckets — offered, active, rejected — and for a demo user
all three are empty. **Nothing is broken: nothing has ever created a row.**
`scripts/generate-challenges.ts` is a GitHub Actions cron (`challenges.yml`), and
`npm run seed` does not call it.

So this is a seeding gap, not a feature gap, and the fix is mostly to run
machinery that already exists.

- **The seeder assigns challenges.** After the history is written, generate a
  pool and assign from it, so every archetype has offered ones to accept and at
  least one already active. The validator's rejection reasons are phase 4's
  inspectability criterion, so seeding a rejected one too is worth doing —
  it is the only way that half of the Hub is ever seen.
- **The pool needs content.** `20260902090200_challenge_pool.sql` ships one
  insert; the Hub is more interesting with a spread across the challenge kinds
  the validator supports. Content is rows — CLAUDE.md #7 — so this is a
  migration of INSERTs, which changes no column and needs no regeneration.
- **Quests** are the daily-window variant of the same validator (phase 4's
  build list). Check whether anything distinguishes them in the schema before
  assuming a second mechanism is needed.

### Acceptance

- `npm run seed` produces a Hub with offered, active and rejected challenges for
  every archetype.
- `tests/db` covers the seeded rows the way `evidence.test.ts` covers its own.
- Accepting one still works end to end — the `accept_challenge` RPC is phase 5's
  and is not being changed.

---

## PR 4 — the graphs show their numbers

**Branch `history-graph-values`.**

The exercise progression chart is a hand-rolled SVG line. The request is numbers
on it.

**There is already a decision here and it should be read before it is
overturned.** `src/ui/LiftChart.tsx` says: _"The reps live in this table rather
than as SVG text. Twelve labels inside a 320-unit viewBox collide at 375px, and a
scaled `<text>` element…"_ — so a table of dates and top sets sits below the
chart, and the collision problem is real at the width this app is built for.

So the work is not "add labels", it is **make the figures legible without
recreating the collision**:

- Label the **first, the last and the heaviest** point — three labels, not
  twelve, which is what the reader actually wants from a progression line.
- Give the y-axis a value at top and bottom, so the line has a scale rather than
  a shape.
- Keep the table. It is the accessible version and the one that survives a
  screen reader.

If that is still "just lines", the next step is a value on every point at a
breakpoint where they fit, and no labels below it — but start with three.

### Acceptance

- Browser at 375×812 **and** at a wide width, both themes, on a lift with many
  sessions, one with two, and one with a single point.
- No label overlaps another at 320px.

---

## PR 5 — the demo users are furnished

**Branch `seed-furnishings`.** Two requests, one file.

- **Workout templates.** `workout_templates` and `workout_template_items` have
  existed since `20260905090000` and the seeder writes neither, so the Workout
  tab's template list is empty for every demo user. Give each archetype one or
  two templates built from its own programme — the barbell user gets its
  barbell days, the home-gym user gets something it can actually do under a
  30 kg cap.
- **Profile data.** The four biometrics landed on 2026-09-09 in phase 6 PR 2 and
  the seeder fills them, so a profile viewed before re-running `npm run seed`
  looks emptier than it is. **The first step is to look rather than to guess:**
  open each seeded user's Profile and list what renders blank or as an em dash,
  then fill what should not be. This plan does not pre-judge the list.

### Acceptance

- `npm run seed` gives every archetype at least one template that starts a
  session correctly.
- `src/seed/archetypes.test.ts` asserts each template's items reference
  exercises that archetype's equipment allows — the `loadCeilingKg` case is the
  one that matters.
- A named list of what Profile showed empty, and what each fix was.

---

## PR 6 — hear a coach before you pick one

**Branch `persona-preview`.** A button per persona that speaks a sample line.

`src/ui/speak.ts` already wraps `speechSynthesis` with `canSpeak`, `primeVoices`,
`speak` and `stopSpeaking`, and `CoachConsole` already picks a voice per persona.
What does not exist is **anything for a persona to say** before a plan has been
delivered.

### This is the one PR that needs Docker, and it needs it once

A sample line is **content**, and CLAUDE.md #7 puts content in the database — so
it is a column on `personas`, not a constant in a `Record<string, string>` in
code. A new column means regenerating `src/db/types.ts`, which CLAUDE.md says
must come from a **local** stack and never from `--linked`.

So: one Docker session, announced before it starts, `npx supabase@2.116.0` (the
pin — the local CLI is 2.117.0, the version that turned every open PR red), and
`supabase stop && wsl --shutdown` in the same turn.

**The alternative was considered and rejected:** generating the line through the
persona stage would be in-character and needs an API key, which makes a preview
button that cannot preview. A stored line works offline, which is what a demo
needs.

### Acceptance

- Each of the five personas speaks something recognisably its own.
- `canSpeak` false renders the line as text rather than a dead button —
  `docs/specs/mobile-interface.md` §4.
- `stopSpeaking` on unmount, the trap `CoachConsole` already documents.

---

## PR 7 — a plan becomes a template

**Branch `plan-to-template`.**

A button on the coach's plan block that writes one of its sessions into
`workout_templates`, so the Workout tab can start it.

The plan block is `TrainingBlock` — weeks, sessions, exercises, set groups. A
template is a name plus ordered items with reps, RPE and rest. The mapping is
mechanical, with two things to decide rather than assume:

- **Which session.** A twelve-week block has thirty-six. Proposed: a button per
  session on the week the user is looking at, not one button for the block.
- **Exercise identity.** The block carries `exercise_slug`; template items
  reference `exercise_id`. The lookup must fail loudly for a slug with no
  catalogue row — the seeder learned this in phase 6 (`scripts/seed.ts` throws on
  a missing slug rather than returning `[]`).

### Acceptance

- A template created this way starts a session with the right exercises, sets
  and reps.
- `tests/db` covers the insert under RLS: a user can only write their own.
- Creating the same session twice does not silently produce two identical
  templates — decide and state whether that is an error or a rename.

---

## PR 8 — one box, and a plan you can ask for

**Branch `coach-one-box`.** The largest change, and the one carrying two
stakeholder decisions.

### The Coach tab, after

```
Coach
  Plan          — the accepted block, or the questionnaire if there is none
  Diet          — goal, the figures, and ONE question box
```

- **"Eating" becomes "Diet".**
- **"Stay where I am" becomes "Maintenance."**
- **The chat panel and the supplement card are removed as surfaces.**
- **The remaining box answers training, diet and supplement questions.**

### What survives, and it is most of the safety work

The stage is not deleted. A question is routed to one of three answers —
training, diet, or a supplement row — and every guarantee already written keeps
holding:

- ADR 0015's fencing, the code-owned refusal constants, and the rule that a
  `coach` turn in a transcript is a claim rather than a provenance.
- ADR 0024's empty allowed set and `/\p{N}/u` check for the diet answer.
- ADR 0023's retrieval-only shape for the supplement answer — the model picks a
  slug from an allowlist and code renders the row.

**The routing is the new thing, and it is the risk.** One box answering three
question types needs to decide which, and that decision is a model's. It gets
the same treatment as `on_topic`: recorded as a **mitigation, not a control**,
with the consequence of a wrong route being a wrong answer rather than an unsafe
one. Whether it is one call that returns a route plus an answer, or a router
call and then an answer call, is a cost/latency decision to make in the PR — one
call is cheaper and lets the model justify a route it has already committed to;
two is cleaner and doubles the spend.

### Generate a plan, when there is not one

`app/coach/page.tsx` currently explains why there is **no** button:

> A planner run is up to three planner+critic round trips at 25 to 120 seconds
> each, which does not fit in a serverless function, and making it fit means a
> job queue that `CLAUDE.md` puts out of scope. A button that dead-ends would be
> worse than this sentence.

**That reasoning has not changed. The decision to build anyway is the
stakeholder's, taken with the limits named**, and this section is where they are
written down so nobody rediscovers them:

- **It cannot produce a plan without an API key.** None has ever been configured
  on this project — the same gap four unmet acceptance criteria sit in.
- **It may exceed the function timeout.** `PLANNER_TIMEOUT_MS` is 120 s for one
  call and the loop allows three. Mitigations that do not need a queue: cap the
  block at fewer weeks for a first plan, and surface a partial failure as a
  state rather than a hang.

**A questionnaire, then.** Goal, days per week, equipment, injured joints — the
four things `buildPlannerContext` needs that the app cannot infer. Everything
else comes from the training log it already has.

**One archetype ships with no plan**, so the empty state and the questionnaire
are testable today. `scripts/seed.ts` writes one accepted `plan_runs` row per
user; the inconsistent archetype is the natural candidate — a user who misses
half their sessions is the one most likely not to have got round to it.

### Acceptance

- Every state renders: no plan, questionnaire in progress, generating, failed,
  and a plan.
- The seeded planless user shows the questionnaire, and the other four show
  their plan.
- `npm run verify`, `npm run build`, browser at 375×812 in both themes.
- **Stated rather than claimed:** generation is unverified end to end until a key
  exists.

---

## Verification

Each PR: `npm run verify`, `npm run build`, and the browser at 375×812 in both
themes for anything with a surface. `npm run test:db` where a migration is
involved.

**Docker exactly once, in PR 6**, for the one column that forces a
`src/db/types.ts` regeneration. Announced before it starts and stopped in the
same turn — `supabase stop && wsl --shutdown`.

| Change           | The check that matters                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| Leaderboard      | The view is untouched; the level is `levelForXp` and nothing reimplements it |
| Challenges       | A seeded Hub has all three buckets                                           |
| Graphs           | No label overlaps another at 320px                                           |
| Seed furnishings | A seeded template starts a session; the empty-Profile list is named          |
| Persona preview  | Five voices, and a text fallback where speech is unavailable                 |
| Plan → template  | RLS on the insert, and the duplicate case decided                            |
| One box          | Every guarantee from ADR 0015, 0023 and 0024 still has its test              |
| Plan generation  | Every state renders; the key gap is stated, not implied                      |
| Every PR         | Branch, PR, reviewer subagents, merge only when green, delete the branch     |

## The browser pass, still outstanding

Phase 6 PRs 2, 4 and 5 were merged without it, because `/coach` and `/settings`
need a session and this agent does not type passwords. Review found **a width bug
in one and a colour-only state in the other**, which is exactly what that pass
catches.

**Six of the eight PRs below have a surface.** If the pass stays unrun the same
class of defect will keep shipping, so it is worth clearing before PR 2 rather
than after PR 8.
