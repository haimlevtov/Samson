# Rework — the Hub, the graphs, the demo data, and the Coach

Planned 2026-09-09, before any of the code below. Eight PRs: this plan, then
seven changes in the order given.

**This is a rework, not a phase.** Phase 6 was the last one and it is closed.
`rework-profile-hub-coach.md` is the precedent for the shape: a list of changes
that came from using the app rather than from `docs/PLAN.md`, planned together
because several of them touch the same surface.

## Status

| PR  | What                                                                                      | Branch                 | State                                                                |
| --- | ----------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| 1   | [This plan](#pr-1--this-plan)                                                             | `rework-plan`          | shipped 09-09                                                        |
| 2   | [The leaderboard ranks by level](#pr-2--the-leaderboard-ranks-by-level)                   | `leaderboard-level`    | shipped 09-09, [↓](#pr-2--the-leaderboard-ranks-by-level-2026-09-09) |
| 3   | [Challenges and quests the Hub can offer](#pr-3--challenges-and-quests)                   | `hub-challenges`       | shipped 09-09, [↓](#pr-3--challenges-and-quests-2026-09-09)          |
| 4   | [The graphs show their numbers](#pr-4--the-graphs-show-their-numbers)                     | `history-graph-values` | shipped 09-10, [↓](#pr-4--the-graphs-show-their-numbers-2026-09-10)  |
| 5   | [Templates and a full profile for the demo users](#pr-5--the-demo-users-are-furnished)    | `seed-furnishings`     | shipped 09-11, [↓](#pr-5--the-demo-users-are-furnished-2026-09-11)   |
| 6   | [Hear a coach before you pick one](#pr-6--hear-a-coach-before-you-pick-one)               | `persona-preview`      | planned                                                              |
| 7   | [A plan becomes a template](#pr-7--a-plan-becomes-a-template)                             | `plan-to-template`     | planned                                                              |
| 8   | [One box on Coach, and a plan you can ask for](#pr-8--one-box-and-a-plan-you-can-ask-for) | `coach-one-box`        | planned                                                              |

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

**`levelForXp` is monotonic non-decreasing in XP** — `docs/specs/xp-and-challenges.md`
states it as `x <= y implies levelForXp(x) <= levelForXp(y)`. So an XP ordering is
always **consistent with** a level ordering: it never puts a lower level above a
higher one. It is not the _same_ sequence, because level ties are broken by XP,
which is exactly the tie question below. The request is a display change, not a
sort change, and the view's `rank()` can stay as it is.

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

- **ADR 0016** says the view exposes "four values **and nothing else**" and names
  them. It gains an amendment: the four are unchanged, and `lifetime_xp` becomes
  an input to a derived figure rather than the figure a user reads.
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

So this is a seeding gap rather than a feature gap, and most of the fix is
running machinery that already exists. **Most, not all** — the first bullet
below was written on that assumption and measurement contradicted it.

- **The seeder assigns challenges.** After the history is written, generate a
  pool and assign from it, so every archetype has offered ones to accept and at
  least one already active. The validator's rejection reasons are phase 4's
  inspectability criterion, so seeding a rejected one too is worth doing —
  it is the only way that half of the Hub is ever seen.
- **The pool DOES need content, and this bullet has now been wrong twice.** Its
  first version asked for more content without saying what was missing. Review
  replaced it with "the gap is assignment, and only assignment", which reads as
  the more rigorous claim and is false. **Measured before writing any code**, by
  running each archetype's real generated history through the real validator:

  | Archetype      | Offered | Rejected | Why                                           |
  | -------------- | ------- | -------- | --------------------------------------------- |
  | `beginner`     | **0**   | 7        | all `below_current_ability`                   |
  | `plateaued`    | **0**   | 7        | all `below_current_ability`                   |
  | `home-gym`     | **0**   | 7        | all `below_current_ability`                   |
  | `returning`    | 5       | 2        | 2 sessions in the rolling week, streak broken |
  | `inconsistent` | 5       | 2        | same                                          |

  _The last two rows first read 4/3, "mid-layoff, so little to beat" — wrong on
  both counts, found by a reviewer re-running the measurement. The counts came
  from a miscount off the probe's own output; `inconsistent` has no layoff at
  all (adherence 0.5), and `returning`'s ended seven weeks before the window
  being measured. What actually clears the low bar for both is a rolling week
  holding two sessions and a streak of zero. CI's seed log agrees with 5/2._

  `20260902090200_challenge_pool.sql` does ship seven rows covering every kind
  the validator supports — that part was right. What neither version checked is
  **what they are calibrated against**: every target sits at or below what a
  consistent lifter already does in a rolling week, and `validateCandidate`
  rejects anything already met, correctly, as not a challenge. So three of five
  demo users would still open a Hub with an empty "Open to you" section — the
  exact complaint this PR exists to fix — after running the machinery the bullet
  said was sufficient.

  The pool has **one rung per kind, not a ladder**. This PR adds a harder tier
  in a migration (content lives in the database, CLAUDE.md #7), calibrated above
  every archetype's rolling week and verified offered on **all seven weekdays**,
  because a rolling window makes the seeded Hub depend on which day the seed ran.

- **`streak_days` cannot be made harder, and that is a spec limit rather than a
  calibration one.** `maxAchievable` bounds a streak challenge by
  `window_days`, the schema caps that at 14, and `evaluateChallenge` returns
  `min(currentStreak, window_days)` — so for a user whose streak is already 14
  days or longer, **every legal streak challenge is `below_current_ability`**.
  Three archetypes are at 51, 21 and 16 days, because a rest day keeps a streak
  (invariant #4). No row can fix that; it is recorded in the spec instead.

- **The seeder and the cron must not each have their own assignment loop.** The
  decision half — pool row plus history in, offered-or-rejected plus a window
  out — comes out of `scripts/generate-challenges.ts` into a pure function both
  call. It is the same reasoning that keeps `evaluateChallenge` shared between
  the batch and the Hub: two copies of "what gets offered" drift, and the one in
  the seeder would drift silently because nobody reads a demo database.

- **The active one is ACCEPTED, not inserted.** The seeder signs in as each
  archetype already, so it calls `accept_challenge` the way the app does —
  exactly the discipline `awardSession` follows for XP, and for the same
  reason: a demo whose state cannot be reproduced by using the app is worth
  very little.

- **Quests need no second mechanism, and the answer is already written down.**
  `docs/specs/xp-and-challenges.md`: _"A daily quest is a challenge with
  `window_days: 1`."_ The pool already carries daily rows. Nothing to
  investigate.

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
- **Profile data.** The four biometric COLUMNS have existed since the phase-0
  schema; what landed on 2026-09-09 in phase 6 PR 2 was the seeder filling them
  and the bounded CHECKs. So a profile viewed before re-running `npm run seed`
  looks emptier than it is. **The first step is to look rather than to guess:**
  open each seeded user's Profile and list what renders blank or as an em dash,
  then fill what should not be. This plan does not pre-judge the list.

### What looking found, and what it decided — 2026-09-11

**Profile shows nothing blank for any archetype.** Looked at by running the
page's own metric functions — `adherence`, `currentStreak`, `acwr`,
`tonnageByWeek`, `totalTonnage`, `exerciseBests` — over each archetype's
generated history, on seven consecutive seed dates. Every tile populates. XP,
level and badges come from the database rather than those functions, and CI's
seed log has shown non-zero XP and badges for all five since phase 4. **This is
not a browser pass**: `/profile` needs a session. It is the same data through
the same code, which is the next best thing and is stated as exactly that.

The biometrics are not on Profile at all — they are on `/settings` — and the
seeder has filled them since phase 6 PR 2. So the premise that the profile
"looks emptier than it is" does not survive measuring; what was empty for demo
users is the **Workout tab**, which had no templates.

**One real defect turned up and is not fixed here.** The "This week" tonnage
tile reads `[...tonnageByWeek(...).entries()].at(-1)`, and `tonnageByWeek` only emits weeks
that had sets — so for anyone who has not trained yet this week it prints last
week's figure under this week's label. It never triggers on seeded data (zero
of 35 archetype-days), which is why nobody has seen it; it bites real users. It
is a metrics fix with its own test, not seed data, so it is its own task.

**Templates are built from the programme, not from a logged session.** The app
already has `templateFromSession()` — "save this as a template" — and reusing it
would look like the one-definition choice. It is the wrong definition: it turns
what was DONE into a template, and ADR 0010's load-bearing rule is that a
prescription and a record are different things. `buildSets` drifts a rep off
later sets, so a template saved from a session would prescribe "1×5, 2×4"
because that is what happened. The programme is the archetype's prescription;
a template is a prescription. Programme to template is the faithful mapping.

- **One per rotation day, so three rather than "one or two".** The programme
  rotates through three sessions, and a template per session is the literal
  reading of "the barbell user gets its barbell days".
- **Weight is the most recent working weight the archetype actually logged for
  that lift.** A template prescribing `startingKg` would hand someone twelve
  weeks in their week-one loads. Bodyweight lifts are `null`, which the schema
  defines as no external load rather than zero.
- **Rest is left unprescribed.** The programme never specifies one, and the
  session grid falls back to its 120s default; inventing a figure the programme
  does not contain is worse than defaulting.
- **`source: 'user'`.** `coach` means imported from an accepted plan
  (`docs/specs/workout-templates.md` §1), and nothing seeded was. _This first
  said coach templates were "PR 7's surface" and seeding them "would pre-empt
  the thing PR 7 builds" — wrong, found in review: PR 7's own section says the
  import already ships, and PR 7 is one button._
- **Written through `createTemplate` as the signed-in archetype**, the same
  discipline as `award_session_xp` and `accept_challenge`: its Zod validation
  and compensating delete are the app's, and a seeded row the app itself could
  not have written is worth very little.

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

> **The first version of this section planned a feature that already ships, and
> that is worth leaving in the record rather than quietly replacing.** It
> proposed building the mapping from a plan session to a template, with "two
> things to decide rather than assume". Both were decided and shipped months
> ago:
>
> | What it proposed to build            | What already exists                                                                       |
> | ------------------------------------ | ----------------------------------------------------------------------------------------- |
> | The mapping                          | `src/templates/plan.ts` — `templateFromPlannedSession`, with `plan.test.ts`               |
> | The action                           | `createTemplateFromPlan` in `app/workout/actions.ts`                                      |
> | The surface                          | `PlanImportForm` in `app/workout/ImportForms.tsx`, on `/workout/new`                      |
> | "which session" — undecided          | Already a per-session picker, keyed by `weekNumber` + `dayIndex`                          |
> | "must fail loudly on a missing slug" | Already does — returns `{ ok: false, missingSlugs }`                                      |
> | —                                    | `docs/specs/workout-templates.md` §6 is the written contract, and the plan never cited it |
>
> Written from the request rather than from a grep. The same class of error as
> writing a summary from the previous summary, which this repo has recorded
> twice in two days.

**So the work is one entry point, not a feature.** The import lives on
`/workout/new`; the request is a button **on the coach's plan**. Render the same
control there, against the block already on screen, and reuse
`createTemplateFromPlan` unchanged.

### What is genuinely open, and both are small

- **Template ownership under RLS is asserted now — on the policy side.** _This
  first read "no `workout_template*` coverage at all", then "the insert side is
  still unasserted"; both are history._ PR #43 (migrations `20260911090000` and
  `20260911100000`) made `workouts_own` and `workout_template_items_own` refuse
  another user's template or custom exercise, on insert and on update, and
  `tests/db/rls.test.ts` tries each case. **Still open here:** nothing inserts a
  `workout_templates` row under another user's `user_id`. The owner-only policy
  covers it, but no test has tried, and this PR adds a second caller.
- **There is no unique constraint on template name**, so importing the same
  session twice produces two identical rows. Decide: an error, a rename, or
  allowed. Currently it is allowed by accident rather than by decision.

### Acceptance

- The button on `/coach` produces a template that starts a session correctly,
  through the same action `/workout/new` uses.
- `tests/db` covers the insert under RLS: a user can only write their own.
- The duplicate case is decided and stated, not left to accident.

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

**A questionnaire, then.** `ContextInput` in `src/planner/context.ts` takes
`goal`, `daysPerWeek`, `blockWeeks`, `injuredJoints`, `asOf`, `workouts`, `sets`
and `candidates`. The last four the app has. **The first four are the questions**
— and `blockWeeks` is one of them, which matters because this PR's own mitigation
is to cap it.

**Equipment is not one of them**, and an earlier version of this list said it
was. It never reaches `buildPlannerContext`: equipment filtering happens in SQL
before the model sees anything (invariant #5), and arrives as pre-filtered
`candidates`. Asking about it is still worth doing — nothing but the seeder ever
writes `user_equipment`, so a real user's is empty — but that is a **separate
question feeding a different place**, not a planner input.

A `TrainingBlock` is capped at **8 weeks** (`src/planner/schema.ts`, with an
AI-NOTE explaining the bound is a deliberate cost control), and every seeded
block is 4. An earlier draft of PR 7 said "a twelve-week block has thirty-six
sessions"; both numbers were wrong, and the 12 was `block_weeks` on the planner
_input_ rather than the block.

**One archetype ships with no plan**, so the empty state and the questionnaire
are testable today. `scripts/seed.ts` writes one accepted `plan_runs` row per
user; the inconsistent archetype is the natural candidate — a user who misses
half their sessions is the one most likely not to have got round to it.

### Documents this changes, and the largest PR had no such section

**`docs/specs/coach-chat.md` §1 is the written contract for this exact surface,
and PR 8 contradicts it point by point.** It says "Four controls on `/coach`",
"the chat is a panel below it", "**Clear** … is the third control", "**Supplements**
is the fourth … it is the only route to `/evidence`", and carries a block-quoted
callout headed "**`Create a plan` is not this button, and the difference is
deliberate.**" The code comment this PR quotes cites that spec as its authority.

So:

- **`docs/specs/coach-chat.md`** — §1 rewritten for one box and a plan control;
  §5 and §6 extended if routing is a second call.
- **`docs/PRD.md`** — §5.3 (coaching, currently "Specified") and the diet and
  supplement entries at §5.7.
- **A home for the routing decision.** The plan calls it "the new thing, and it
  is the risk" and then proposes nowhere to record it. ADR 0015's
  does-not-guarantee table is the natural place — routing joins `on_topic` as a
  model's judgement about itself, a mitigation rather than a control.
- **`docs/specs/diet.md`** §4b, if the supplement question moves surface.

### One migration this PR may owe

**If routing is a separate call it is a new pipeline stage**, and
`llm_calls.stage` is a CHECK constraint rather than an enum —
`20260907160000_llm_calls_chat_stage.sql` records that exact trap, where the
unit suite passed and the first live message failed. It does not break "Docker
exactly once": a CHECK change moves no column and needs no types regeneration.
One call returning both a route and an answer owes nothing.

### Acceptance

- Every state renders: no plan, questionnaire in progress, generating, failed,
  and a plan.
- The seeded planless user shows the questionnaire, and the other four show
  their plan.
- Every guarantee from ADR 0015, 0023 and 0024 still has a test that fails when
  it is removed.
- `npm run verify`, `npm run build`, `npm run test:db` if a stage was added,
  browser at 375×812 in both themes.
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

**Seven of the eight PRs above have something to look at in a browser** — every
one except this plan, and PR 5 explicitly requires opening each seeded Profile.
Five of them change markup. If the pass stays unrun the same class of defect will
keep shipping, so it is worth clearing before PR 2 rather than after PR 8.

---

## Outcome

### PR 2 — the leaderboard ranks by level, 2026-09-09

The plan's finding held: **no migration, no SQL, no Docker.** `levelForXp` is
monotonic non-decreasing, so the view's existing `order by lifetime_xp desc`
already produces a level ordering, and `tests/db/leaderboard.test.ts` passes
untouched — which is the proof the boundary did not move.

**What review changed, and it is the whole reason this PR was worth reviewing.**

**I dressed a display change up as a privacy improvement, and it is not one.**
The first version's settings copy said other people see "not your XP", and the
ADR amendment claimed §2's privacy argument was _strengthened_. Both false, for
the reason ADR 0016 §1 states in as many words: **the view is the security
boundary, not the render.** `grant select on public.leaderboard to authenticated`
still covers `lifetime_xp`, and this repo's own db suite asserts one user
reading another's exact total straight from PostgREST — deliberately, as the
boundary's intended behaviour. Changing which column the Hub prints revokes
nothing.

Two reviewers found it independently, which is the signal that it was not a
close call.

**The weakened inference caveat was wrong too, and it contradicted a paragraph
written from an earlier review finding.** `rank` is a strict total order over
exact XP and it _is_ printed, so any gain crossing a neighbour's total moves a
visible number — more often than a level-up, not less. And the arithmetic behind
"a level moves a handful of times a year" was wrong on its own terms: at the
spec's own perfect week it is about twelve, and the spec says "around level 10
after a season" in as many words.

The copy is now true, and ADR 0016 keeps the error as a heading rather than
deleting it, along with what closing the exposure would actually cost — both
options need the curve in SQL, which is the second definition this change exists
to avoid.

**Smaller things review caught:**

- `LeaderboardRow.lifetimeXp` was carried with a comment calling it "the
  tiebreak". It is not — the tiebreak is computed in Postgres before the row
  leaves. Nothing consumed the field, and it is the one that would serialise
  every listed user's exact total into the page HTML the day the table becomes
  sortable. Dropped. That is a smaller blast radius, not a fix.
- The test stub was cast `as never`, which is assignable to everything and so
  verified nothing about the stub at all. Now `as unknown as` a real parameter
  type, and it captures the select list — so a column added to the query fails a
  unit test rather than only the Docker-dependent one.
- **Three of five new tests could not fail for anything this PR changed**, and
  duplicated `src/gamification/level.test.ts` — which already proves
  monotonicity over 5,000 generated inputs, beside the curve it is about.
  Deleted, with a comment saying where the property lives and why that is the
  right place for it to fail.
- Four documents still described the board as showing XP: `docs/PRD.md` §5.6,
  `docs/specs/mobile-interface.md`'s card-stacking exemption, the comment in
  `app/hub/page.tsx` arguing that exemption, and `app/globals.css`'s note on
  `.lb-xp`. `xp-and-challenges.md` said "two surfaces read the curve" when
  `src/chat/facts.ts` makes three.

**Not verified:** the browser pass at 375×812 in both themes. `/hub` needs a
session, and a password is not something this agent types. The plan says this
should be cleared **before** PR 2 rather than after PR 8, and it has not been —
so the debt this PR was supposed to start paying down is instead one PR larger.

### PR 3 — challenges and quests, 2026-09-09

**`npm run seed` now fills all three of the Hub's buckets for all five demo
users.** CI's own log, which is the verification rather than a claim about it:

```
beginner      3 offered / 1 active / 7 rejected
plateaued     3 offered / 1 active / 7 rejected
returning     8 offered / 1 active / 2 rejected
home-gym      3 offered / 1 active / 7 rejected
inconsistent  8 offered / 1 active / 2 rejected
```

Seed took 5s against the 60s budget; `npm run test:db` passes 209 tests, and
`npm run verify` 1043 across 46 files.

**The plan's own PR 3 bullet was wrong, and had already been corrected once into
a different wrong answer.** "The gap is assignment, and only assignment" was
false: three of five archetypes were offered NOTHING, because every pool target
sat at or below a consistent lifter's rolling week and `validateCandidate`
rejects what a user already does. Measuring before writing is what caught it —
the bullet had been reasoned about twice and measured zero times.

**What shipped:** four pool rows above the top archetype's week, one shared
`assignFromPool` used by both the cron and the seeder, and a seeder that accepts
one challenge through `accept_challenge` as the signed-in archetype rather than
inserting `status: 'active'`.

**What review changed.**

- **Two rows of this document's own measurement table were wrong**, found by a
  reviewer re-running it. `returning` and `inconsistent` are 5 offered / 2
  rejected, not 4/3 — a miscount off my own probe output, which CI's seed log
  then contradicted in plain sight. The "Why" column was wrong too:
  `inconsistent` has no layoff at all. Corrected in place, with the error kept.
- **The migration's calibration numbers came from one date.** The weekly hard-set
  peak is 23, not the 20 I wrote; a single reading is not a margin when
  `generateHistory` drops days by `chance(rng, adherence)`. Re-measured as
  maxima over 28 consecutive seed dates.
- **The spec claimed weekly rows are stable across weekdays.** They are not, for
  the same reason. That paragraph would have told the next author to skip the
  weekday re-check the migration says is mandatory.
- **"Verified on all seven weekdays" was asserted in three places and tested in
  none** — in a PR whose whole design rationale was a pure function that makes
  exactly that assertable. `tests/db/challenges.test.ts` now sweeps it.
- **The seeder wrote challenge windows from a UTC date** and
  `accept_challenge` judges them against the user's local one (CLAUDE.md #9).
  West of UTC that made a challenge acceptable a local day early; east of it,
  after 21:00 UTC, a daily row was born closed. Fixed at source with a shared
  `localDateIn` — which turned out to be a _third_ definition of "today there",
  so `src/db/server.ts` and the cron now delegate to one.
- **Two of my twelve unit tests could not fail for anything this code owns**,
  which is the class PR 2's Outcome above records deleting. Deleted, with a note
  saying where the property belongs.
- **The cron logged `display_name`** — user-authored personal data — for every
  user into a retained Actions log, and my new error message added a carrier.
  Now the id prefix.
- **My new `throw` aborted the batch mid-run**, after settlement had paid XP for
  earlier users, so one bad row denied everyone after it that week's challenges.
  Collected and reported at the end instead.
- Also: the migration's serial collided with 0036; `.insert(rows as never)`
  disabled type checking on `user_id` in a service-role write; two db tests used
  the service role to assert a boundary the service role bypasses; a test name
  claimed to prove something nothing records; and README, FRAMING's
  invented-content list and the plans index were all stale.

**The one judgment call, flagged rather than buried:** `weekly-eight-hard-sets`
pays 110 and the new `weekly-twenty-five-hard-sets` pays 140, and a user may
hold both — so more sets can mean more XP, which is the shape invariant #4
exists to forbid. The ruling, written into the spec beside the existing volume-
tier argument: what #4 forbids is XP that _scales_, and each challenge pays flat
at a threshold, is opt-in, and is clamped by the weekly ceiling. The honest
limit is recorded with it — a stepped ladder is still weakly monotonic in
volume, and the rung above 25 would need a second look.

**Not verified:** the browser pass at 375×812. `/hub` needs a session. This is
the third consecutive PR to leave that debt, and PR 3 is the one that puts real
content on the surface it would check.

### PR 4 — the graphs show their numbers, 2026-09-10

The chart labels **up to three points** — first, last and heaviest — plus an
axis value wherever those leave one of the extremes unnamed. ADR 0014 amended
first, in its own commit.

**The plan asked for "a value at top and bottom" of the axis and that is not
what shipped.** Built that way first: a 44-unit left gutter holding the maximum
and the minimum. Three separate measurements killed it. It cost 11% of the axis
on every chart — enough to push `MAX_PLOTTED_SESSIONS` past the dot spacing it
was derived from, in a change nowhere near that constant. At 320px every tick
rendered clipped: "142.5 kg" is 45px of ink in a 29px box. And on a history that
only rises — the commonest shape there is — the first and last points ARE the
extremes, so the gutter spent that width printing the two numbers the end labels
already carry. Ticks now appear only where the labels leave a gap, which in
practice means a deload's trough or a peak whose label was dropped. The plan's
intent — the line has a scale, not just a shape — is met by the labels.

**The browser pass ran, and it is the reason three of these are here.** The real
component was rendered to a static page and every label's box AND ink measured
at 320, 375, 760 and 1100px, in both themes: no overlaps, no clipping, nothing
outside the plot. Two defects came out of it that no amount of reading would
have found:

- **A rising history drew the last label straight through the line and three
  dots.** Both ends printed below their points; which side is free is a fact
  about the data. `ProgressionLabel` carries a `side` now.
- **At a wide width the chart read as a poster with captions** — inside the
  1000px shell a dot was 18px beside an 11px figure. Capped at 560px from 760px
  up, and recorded in `docs/specs/mobile-interface.md`.

**What review changed, and one finding was a real bug.**

- **The collision guarantee did not hold.** The ADR claimed that printing the
  heaviest above its point and the ends below theirs separated them. The `side`
  rule above breaks exactly that: on a rising history the last label is above
  its point too, so a peak a kilogram over the final session, near the end of
  the axis, lands on the same line of text. The check is two-dimensional now —
  close along the axis AND close in weight — with the case in the suite. My
  browser pass had not caught it because none of my cases had that shape.
- **Every axis tick was clipped at 320px**, raised as speculative and true. My
  own measurement had missed it: I compared element rectangles, and the text
  was overflowing its box. The check now compares `scrollWidth` to
  `clientWidth`.
- **`MAX_PLOTTED_SESSIONS` had a MEASURED derivation the diff falsified** —
  "300 units of axis" when the gutter had left 266. It carries an AI-NOTE now
  tying it to the axis width.
- **The 18% gap rule's own arithmetic was wrong twice over**: 21% by dividing by
  the chart rather than the axis, and then "18% of clear air" between boxes a
  quarter wide, which touch. It has an honest job now — a centred label needs
  half its width of axis either side or it hangs outside the plot — and a test
  that pins it in both directions.
- **A test asserted `progressionRange`'s private 10% pad** from inside another
  function's describe, so changing that fraction would have reddened a correct
  test with a misleading message.
- Also: a stale clipping rationale in `globals.css`; a `0.72rem` one-off where
  the sheet uses `0.75rem`; a hand-copied `11%` gutter width that did not equal
  the 13.75% gutter it named; `var(--lift-label-x)` with no fallback, which
  would drop a future label onto its own dot rather than degrade; and no
  AI-NOTE on the TypeScript union that `globals.css` has to mirror by hand.

**One reviewer finding was wrong and the code says so.** A test was called
redundant with the one above it; breaking the implementation showed it catches a
bug the other misses — an axis reading the ends rather than the extremes. Kept.

**Not verified:** the chart on its real route. `/history/[id]` needs a session,
so what was measured is the real component rendered to a page with the real
stylesheet, not the page itself.

### PR 5 — the demo users are furnished, 2026-09-11

**Every demo user now opens a Workout tab with three templates**, one per
session of their rotation. CI on the first push seeded them in 5s and ran
`tests/db/seeded-templates.test.ts` green against the stored rows. That suite
has not run locally, and against the hosted project it fails until hosted is
re-seeded.

**The Profile half turned out to be nothing**, measured rather than assumed: the
page's own metric functions over every archetype on seven seed dates, all
populated. Not a browser pass — `/profile` needs a session. One correction to
the section above: `tonnageByWeek` leaves out weeks with zero tonnage, not only
weeks with no sets, so a week of only bodyweight or warm-up sets reads as empty
too. The "This week" defect is split out as its own task.

**What review changed. Each of the three reviewers found something the other two
did not.**

- **A template prescribed a lift its user's equipment cannot do.** The home-gym
  programme carries `chair-squat`, which the catalogue tags `machine`; home-gym
  owns dumbbells, bands and a floor. The test checked "is in the programme"
  under a comment claiming the history already respected the equipment. It did
  not. `templatesFor` now leaves out-of-grant lifts out through `outOfGrant`,
  and the test pins the list at exactly `home-gym: chair-squat`, so a new
  mismatch fails loudly. **The programme itself is not fixed here:**
  `chair-squat` is the root of the legs progression tree, so a bodyweight-only
  user can never start that tree through the app — and the seeded home-gym
  lifter progresses on a lift he could never log. Three candidate fixes, and a
  content decision, so it is its own task.
- **Nothing tested the decision the templates are built on.** Swapping sets and
  reps, prescribing one set, and dropping a rep from every lift — the "1×5, 2×4"
  drift itself — all stayed green. A contract test now holds lifts, sets and reps
  to the programme. "Heaviest ever" sat inside a range assertion and removing
  the date sort changed nothing; a hand-built history now pins "the top set of
  the most recent session" and catches both.
- **The db test repeated a false security claim**, found by two reviewers: "RLS
  rejects a template id belonging to anyone else". It does not — `workouts_own`
  checks only `user_id`, and a foreign key is not subject to RLS. The same claim
  is in `app/workout/actions.ts`, and `workout_template_items` has the same gap.
  The test now says what it proves. The policy fix is its own migration and PR,
  because this project gives a cross-user boundary change its own review.
- **The test's cleanup ignored its own failure.** Against hosted, a stray
  in-progress session would become that demo user's active one and capture the
  next Start anybody pressed. The delete is checked, no session may be active
  before or after, and it runs for all five archetypes rather than one.
- **The fallback for a lift never logged was uncapped and untested.** Clamped to
  the ceiling on every path now; a synthetic archetype proves the clamp, because
  no shipped entry starts above it.
- **The seeder's mapping was never tested offline** — the test rebuilt the draft
  by hand. One `toTemplateDraft` now, called by both.
- **The reason given for `source: 'user'` was wrong**: PR 7 builds a button, not
  the import. Corrected above, with the error kept.
- Also: `SeedTemplateItem` derives from the Zod-inferred type; two comments that
  contradicted each other on zero loads reconciled; the sort's stated reason
  corrected; ADR 0010's "two places" amended; the spec's broken paragraph fixed;
  bodyweight lifts derived from the programme instead of three hard-coded names;
  the db ceiling test can no longer pass with zero checks.

**Broken fourteen ways; all fourteen now go red.** Two stayed green on the first
run, and only one of them was a gap. `reps: entry.reps` appears in the history
generator as well as in `templatesFor`, so the rep-drift break patched the
generator and tested nothing — re-run against an anchor that exists exactly
once, and the harness now refuses an anchor that matches twice. The other was
real: no shipped rotation day empties out, so the empty-template filter was
never exercised, and without it the seed would fail at the write. It has a test.

**Not verified:** a browser pass on `/profile` or `/workout`, which need a
session. The equipment acceptance is now met against the catalogue tag — what the
app itself checks — where the first version checked programme membership and
called that equipment.
