# Phase 5, part two — the content fill it was actually briefed to build

Planned 2026-09-08, before any of the code below. Six PRs: this plan, then one
per content item, in the order given.

> **Phase 5 is three documents, and this is the live one** — the longest Outcome
> in the repo, one entry per PR. The other two are
> [`phase-5.md`](phase-5.md), the record of what the phase became before this
> plan existed, and [`rework-1.md`](rework-1.md),
> the plan that governed its middle. [`README.md`](README.md) has the whole phase
> in one PR table.

## Status — complete

All five content items shipped, plus one PR that was not in the original six.

| PR  | What                                                                            | Branch                      | Shipped    | Outcome                                                     |
| --- | ------------------------------------------------------------------------------- | --------------------------- | ---------- | ----------------------------------------------------------- |
| 1   | [This plan](#pr-1--this-plan-and-the-decision-recorded-where-it-can-be-found)   | `phase-5-content-fill-plan` | 2026-09-08 | —                                                           |
| 2   | [Achievements across every tier](#pr-2--achievements-across-every-tier)         | `achievements-content`      | 2026-09-08 | [↓](#pr-2--achievements-2026-09-08)                         |
| 3   | [Cumulative-tonnage comparisons](#pr-3--cumulative-tonnage-comparisons)         | `tonnage-comparisons`       | 2026-09-08 | [↓](#pr-3--tonnage-comparisons-2026-09-08)                  |
| 4   | [The remaining personas](#pr-4--the-remaining-personas)                         | `remaining-personas`        | 2026-09-08 | [↓](#pr-4--the-remaining-personas-2026-09-08)               |
| 5   | [Progression trees](#pr-5--progression-trees)                                   | `progression-trees`         | 2026-09-08 | [↓](#pr-5--progression-trees-2026-09-08)                    |
| 6   | [The supplement evidence table](#pr-6--the-supplement-evidence-table)           | `supplement-evidence`       | 2026-09-09 | [↓](#pr-6--the-supplement-evidence-table-2026-09-09)        |
| 7   | [Progress in the demo database](#pr-7--the-demo-database-has-no-progress-in-it) | `seed-progress`             | 2026-09-08 | [↓](#pr-7--the-demo-database-has-progress-in-it-2026-09-08) |

**How to read this file.** Everything from the next heading down to the
[Outcome](#outcome) is the plan as written on 2026-09-08, amended in place only
where an amendment is marked as one. The status table above it was added
2026-09-09 and is a record, not part of the plan. Everything below it is the record of what actually happened, and where the
two disagree the Outcome is right — that is the point of keeping both.

PR 7 was added on 2026-09-08 from a direct product request, after PR 6 was
planned and before it was built, which is why the numbering and the dates
disagree.

> **`plans/phase-5.md` left the reschedule-or-cut question open. It is settled
> here as rescheduled — but the decision was not this document's to make, and
> pretending otherwise would misattribute it.**
>
> `docs/FRAMING.md` Q2 already carries the stakeholder's answer, given when
> `PLAN.md` filing the whole cultural layer under "safe to cut down if time runs
> short" was put to them directly: **"Phase 5 is not cut, only sequenced
> last."** `CLAUDE.md` names FRAMING.md as the document to read when a decision
> is disputed, and it was not read when `plans/phase-5.md` recorded that "that
> decision has not been made". It had been. What was genuinely open was
> narrower: whether the content survived a phase that spent itself on something
> else. It does. This plan schedules it.

## Why it is worth finishing, beyond having been promised

**Two of phase 5's three acceptance criteria are unreachable without it.** A
test that every evidence-table claim has a resolvable DOI needs an evidence
table; a calendar achievement firing on the right local date needs a calendar
achievement. Cutting the content would not close those criteria, it would delete
them.

**The specification is further ahead than the build, and the gap is invisible
from the app.** `docs/PRD.md` §5.5 is headed **Specified**, not Built, so it
promises nothing to a user that the product does not have — the PRD's own
convention is doing its job. But what it specifies is achievements "including
hidden ones, whose definitions are never sent to the client, and
calendar-triggered ones that fire on _your_ local date", plus "progression trees
for push, pull, legs and core", against one achievement row and an empty table.
Nothing is being claimed falsely; a great deal is simply missing.

**The schema promised it and nothing honoured it.** `achievements.tier`
enumerates eight tiers and one is used. `users.humor_max_level` offers `crude`
and no persona reaches it. `progression_nodes` has been in the phase-0 schema
(migration 0002) since the first day with no rows and no reader. Each of those
is a claim the schema makes that nothing answers, which is the same failure in
three places.

## What is deliberately still out

**The diet advisor stays in phase 6.** This phase builds the evidence table and
a page that reads it. It does not build maintenance-calorie arithmetic, the
clamped floor, or retrieval-driven answers from the coach — those are phase 6's
**second** acceptance criterion and they need their own adversarial suite.

**Nothing here awards XP on a new curve.** Achievements pay the flat 75 already
in `award_session_xp`; no tier multiplies it. See the volume-tier note below.

---

## PR 1 — this plan, and the decision recorded where it can be found

**Branch `phase-5-content-fill-plan`.** Documents only.

`docs/PLAN.md` phase 5 says "Rescheduling or cutting them is a decision nobody
has made yet"; `docs/plans/phase-5.md`'s first known-gap bullet — the first of
five — says "That decision has not been made and is not made here." Both gain
the decision, the FRAMING.md citation neither of them made, and a pointer here.

Two pre-existing errors in `README.md` are fixed in passing, because this change
edits the paragraph they sit beside: it says "Current phase: **2**", and that
`OPENROUTER_API_KEY` is "not yet" needed because "Nothing calls a model until
phase 2". Phases 0–5 have shipped and four LLM stages are live.

This file commits before any of the code it plans, which is the whole point of
it existing — `CLAUDE.md`, and the failure `plans/phase-5.md` records.

---

## PR 2 — achievements across every tier

**Branch `achievements-content`.** The largest of the five, and the one carrying
two of the three acceptance criteria.

`achievements.tier` allows `volume`, `consistency`, `comeback`, `pr`,
`recovery`, `variety`, `hidden` and `calendar`. Exactly one row exists, in
`consistency`. Every tier gets at least one, following
`.claude/skills/add-achievement/SKILL.md`: the row, the predicate, the humour
tier, and the tests, in one commit.

### Three constraints the predicates must satisfy

**No predicate computes an e1RM.** Epley lives in `src/metrics/e1rm.ts` and
having a second definition in SQL means the badge and the progression chart can
disagree about the same set. PR-tier achievements are written against raw logged
weight instead, and the migration says why.

**The volume tier pays once and is gated on plausibility.** Invariant #4 forbids
XP that _scales_ with volume, because scaling pays people to overtrain. A badge
is bounded — 75 XP, once, ever — so the tier is not a breach, but the argument
has to be written down rather than assumed, and the predicate has to exclude
implausible sets or a mistyped `200` for `20` buys the badge. The SQL mirrors
`MAX_PLAUSIBLE_WEIGHT_KG` and `MAX_PLAUSIBLE_REPS` from
`src/gamification/plausibility.ts`, pinned by a test so the two cannot drift. It
is deliberately weaker than the TypeScript check, which also rejects anything
past 1.5× the user's established best — that needs an e1RM, and the rule above
forbids one here. The migration states the residual gap rather than implying the
gate is the same one.

**Calendar predicates read `workouts.local_date` and nothing else.** That column
is resolved once at write time from `users.timezone` (migration 0003), so it is
already the user's local date. A predicate reaching for `now()`, `current_date`
or `started_at::date` is the bug CLAUDE.md #9 exists to prevent.

### The hidden-badge gap this closes

`src/db/gamification.ts` carries an AI-NOTE saying a held hidden badge joins to
nothing under `achievements_read_visible`, comes back null, "and phase 5 owns
deciding what a held hidden badge should look like". It is currently filtered
out, so a user who unlocks one is shown nothing at all.

The decision: **a held hidden badge is revealed to the holder, and to nobody
else.** Unlocking one silently is the worst of both — the definition stays secret
and the reward disappears. A `security definer` function returns the definitions
of hidden achievements **this user has already unlocked**, which leaks nothing:
they earned it, and knowing what you hold is not knowing what exists. Locked
hidden definitions never cross the network, which is the criterion as written.

### Acceptance

- A `tests/db` case asserts a hidden achievement's definition is absent from
  every client-visible read, and present in the holder's own unlock list.
- A `tests/db` case creates two fixture users either side of the date line —
  one at UTC+14, one at UTC−11 — and asserts the calendar achievement fires for
  the one whose **local** date matches and not for the one whose **server** date
  does. The pair is the test; either alone passes with a server-date predicate.
- Per the skill: every achievement has a near-miss fixture, and a re-run
  inserts no second event.

### Documents this falsifies, updated in the same PR

- `src/db/gamification.ts`'s AI-NOTE — the decision it defers is made here, and
  `CLAUDE.md`'s comment rules forbid leaving a stale one in place.
- `src/db/types.ts`, regenerated for the new function.

**Found by review, and added to this list rather than skipped.** Going from one
achievement to eleven falsifies more than the AI-NOTE:

- `docs/PLAN.md` phase 5's first acceptance criterion, and `docs/PRD.md` §5.5 —
  both said hidden definitions are "never sent to the client", unqualified.
- `src/gamification/plausibility.ts`'s AI-NOTE — "every reward path filters
  through this" stopped being true the moment a predicate read `sets` in SQL.
- `docs/specs/xp-and-challenges.md` — the same claim, plus the volume-tier
  argument, which had no written home.
- `.claude/skills/add-achievement/SKILL.md` — the `hidden` column's description,
  §4.5's test requirement, and a Verify step (`npm test -- achievements`) that
  never ran these tests at all.
- `docs/adr/0002` and `docs/adr/0009` — one whose consequence said the
  hidden-definition rule was "structural instead of something a future endpoint
  has to remember", and one carrying an open question addressed to this phase.
- `docs/plans/phase-4.md` — "latent only because one achievement exists".

---

## PR 3 — cumulative-tonnage comparisons

**Branch `tonnage-comparisons`.**

"You have lifted a bus" is the one place in the app where a number is allowed to
stop being a number. `totalTonnage` is already on Profile as a bare kilogram
figure that nobody has any intuition for.

**The objects are rows, the selection is code** — CLAUDE.md #7 and #1. A new
`tonnage_comparisons` table (slug, singular and plural forms, `mass_kg`, a
source note), and `src/metrics/comparisons.ts` picking the heaviest object the
user has passed at least once and reporting how many. Pure, unit-tested, no
database in the metrics directory as usual.

`vitest.config.ts` gates `src/metrics/**` at 95/95/90/95 coverage, so a new file
there is under a CI threshold rather than a preference. Worth knowing before
writing it, not after.

**Every mass carries a source note**, because a number in a database with no
provenance is indistinguishable from one somebody guessed. These are approximate
by nature — an elephant is a range, not a value — and the note says so rather
than implying a precision the figure does not have.

_Added while building, not planned:_ the note is explicitly **not** a citation.
PR 6's evidence table is where a claim needs a resolvable DOI, because a wrong
dose can hurt somebody and a whale being twenty tonnes out changes a joke. The
two tables' standards must not leak into each other, and the migration says so
in an AI-NOTE.

Surfaced on Profile beside the all-time tonnage figure it explains.

---

## PR 4 — the remaining personas

**Branch `remaining-personas`.** Follows `.claude/skills/add-persona/SKILL.md`.

**The Sergeant** — `docs/PRD.md` §5.4 and `docs/PLAN.md` phase 3 both say "one
of the Sergeant or the Old Master", and `docs/adr/0005-llm-safety.md` §1 already
states as fact that "the persona layer ships a Rival and a Sergeant". The Old
Master shipped; the Sergeant is named in three documents and exists in none of
them.

It is also the **first row to reach `humor_level = 'crude'`**, which
`users.humor_max_level` has offered since phase 0 with nothing behind it. That
makes it the highest-risk persona in the app on both axes at once — intensity 5
and crude — so its `banned_phrases` list is the longest, and the PR states
plainly that the safety layer, not the row, is what holds.

**The Physio** is an argued addition rather than a promised one, and the
distinction matters. PRD §5.4's tone override reads "regardless of which persona
is selected" — it is explicitly a cross-persona mechanism, so it is an argument
_against_ needing a gentle persona, not for one. The actual argument is that the
three shipped coaches sit at intensity 2, 3 and 4, and two of the three are
`cheeky`: choosing between them changes the jokes more than the register. A
coach at intensity 1 is the one register the product does not currently have,
and the returning and inconsistent seed archetypes are the users who would pick
it.

Voice variants: en-GB 0 and 1 and en-US 0 are taken. The Sergeant takes en-GB 2
and the Physio en-US 1 — the rule in the skill that nothing enforces and the
`tests/db` case that catches it.

### Documents this falsifies, updated in the same PR

Going from three personas to five falsifies a count in six places, and the skill
requires the last of them explicitly:

- `docs/PRD.md` §5.4 — "Three coach personas at launch"
- `docs/PLAN.md` phase 3 — "Ship three personas", and the drift criterion "for
  all three personas"
- `docs/adr/0006-persona-boundary.md` — "All three coaches converged on one",
  "three personas take three of the device's voices"
- `docs/adr/0005-llm-safety.md` §1 — becomes true rather than false
- `src/persona/schema.ts` — `SHIPPED_PERSONA_SLUGS` and its comment
- `.claude/skills/add-persona/SKILL.md` §2 — the current-allocation table

**Crude-tier copy has no gate on the achievement side, and this PR does not add
one.** `users.humor_max_level` is described in migration 0001 as gating "crude-tier
achievement and persona copy"; `src/persona/deliver.ts` clamps personas, and
nothing clamps achievements because no achievement is crude. PR 2 keeps every new
achievement at `clean` or `cheeky` so the gap stays closed, and the gap is
recorded here rather than discovered by the first crude badge.

---

## PR 5 — progression trees

**Branch `progression-trees`.** ADR first, because this defines a contract that
does not exist.

`progression_nodes.unlock_criteria` is `jsonb not null default '{}'` and no row
has ever used it. Whoever fills it first defines the shape, and
`.claude/skills/add-progression/SKILL.md` says that is ADR-sized rather than
migration-sized.

**ADR 0020 — structured criteria, interpreted, never executed.** The obvious
thing to copy is `achievements.predicate`, which is SQL text run server-side —
and which ADR 0009 §3 restricts to `user_id is null` rows because executing a
user-authored one is privilege escalation for anyone who can sign up. A
structured jsonb that an evaluator _interprets_ has no such clause to forget.
The ADR argues that, fixes the shape, and says what a node that fails to parse
does (nothing, visibly).

Then: the four trees as rows (push, pull, legs, core), a reader in
`src/db/progression.ts`, a pure evaluator in `src/gamification/progression.ts`
measuring criteria against logged sets, and a surface.

**The surface is `/progression-trees`, reached from Profile.** Two naming traps,
both worth stating:

- "Progression" is already taken. `docs/adr/0014-exercise-progression-chart.md`
  owns it for e1RM history at `/history/exercise/[id]`, which is a different
  idea entirely — how heavy a lift has become, not which skill unlocks next. A
  bare `/progression` would collide with vocabulary the app already uses.
- **This is a sub-route, not a sixth tab.** ADR 0012 settled on five tabs and
  rejected four; a sixth would reopen a decision rather than apply it. `/settings`
  is the precedent for a route Profile owns and the tab bar does not.

`tests/db` asserts the properties the skill names: every `exercise_id` resolves,
`level` equals the parent's plus one, no cycles, and a chain never changes tree.
The lookup-missed case is the one that bites — a `select` with no match inserts
a null rather than failing.

### Documents this falsifies, updated in the same PR

- `.claude/skills/add-progression/SKILL.md` — "Read this first: the table has no
  reader" and "do not describe progression trees as shipped" both stop being
  true. That file also carries a **pre-existing error** to fix while it is open:
  it says `docs/PLAN.md` lists the trees under phase 6, and PLAN.md lists them
  under phase 5.
- `docs/plans/phase-5.md`'s known-gaps bullet "`progression_nodes` has no rows
  and no reader".
- `docs/PRD.md` §5.5 — a new user-facing surface needs an entry, and CLAUDE.md
  says to read the PRD before designing anything a user will see.

---

## PR 6 — the supplement evidence table

**Branch `supplement-evidence`.** ADR first: this is the project's first table
of **external claims**, and it needs a rule for what may go in it.

**ADR 0021 — one row, one claim, one DOI.** _(Shipped as
[ADR 0023](../adr/0023-evidence-rows.md). 0021 and 0022 were written between
this plan and the work, and 0021 is now about training order — following the
number here leads to a real, unrelated document.)_ Rows carry a supplement, a single
claim, an evidence grade, a dose range in canonical units, interaction flags,
and a DOI that backs _that_ claim. No row summarises a literature; a row nobody
can check is worse than an absent row, because it looks checked.

Sources are NIH ODS fact sheets and ISSN position stands, per the brief. Grades
`A` to `D` are defined in the ADR, and **`D` rows are shipped on purpose** —
"the evidence does not support this" is the answer a user most needs and the one
a supplement table never gives.

### The DOI check, in three parts

The acceptance criterion is that every claim has a **resolvable** DOI, which
means a network call. `verify.yml`'s unit job has no secrets and no network
dependency by design, and its comment says so: a change that needs one means
"something has grown a hidden dependency on the network — fix that rather than
adding the secret". `vitest.config.ts` scopes that run to `src/**` and
`tests/unit/**` with "no API key and no database", and evidence rows are
database content — so the offline half cannot be a unit test over rows, and has
to be split again:

- **`npm test`** — a pure `isDoi()` in `src/` with its own unit tests. Format
  only, no rows, no network.
- **`npm run test:db`** — every row's DOI passes `isDoi()` and no claim is
  unbacked. Rows, no network.
- **`npm run verify:doi`** — resolves each DOI against the DOI Handle API and
  fails on anything that does not return a registered handle. Its own CI job,
  allowed to reach the network and allowed to be red without blocking a merge
  that did not touch the table.

**Resolvability is necessary and not sufficient, and the ADR says so.** Measured
while planning this: `10.3390/nu10111800` resolves perfectly and is a paper about
iron parameters in a population sample; `10.1249/MSS.0000000000002382` resolves
to head-impact biomechanics in college lacrosse. A resolver proves a DOI is
registered, never that it says what the row claims. The human check — read the
title, match it to the claim — is recorded in the ADR as the step no test
performs.

Surfaced at `/evidence`, linked from Coach. A table with no reader is the
`progression_nodes` mistake, and this phase is fixing that one.

### Documents this falsifies, updated in the same PR

- `docs/PRD.md` §5.7 — "Diet — Deferred (phase 6)" describes supplements as
  retrieval-only coach answers and no browsable page. The table and its page
  ship here while the advisor stays deferred, and the section has to say which
  half is which.
- `docs/PLAN.md` phase 5's acceptance criteria — the DOI criterion is met by
  three checks rather than the one it describes.

---

## PR 7 — the demo database has no progress in it

**Branch `seed-progress`.** Not in the original six; added 2026-09-08 from a
direct product request, and written here before the code as the ordering rule
requires.

### The problem, measured

The five seeded users have 79–93 workout rows each (measured 2026-09-08; the
seeder generates relative to today, so this range moves with the calendar) and:

|             |                                 |
| ----------- | ------------------------------- |
| XP          | **0**                           |
| Level       | 1, for all five                 |
| Badges      | **0**                           |
| Leaderboard | five people **tied at nothing** |

Every surface phase 4 and phase 5 built is therefore empty in the demo. The
level card reads 1, the XP meter reads 0 of 500, the badge shelf says "nothing
unlocked yet", and the leaderboard — the one place in the app where you see
another person — is five names against a column of zeroes.

The history is real; nothing has ever been _evaluated_ against it. `npm run seed`
writes workouts and sets with the service role and stops there.

### The decision, and the alternative rejected

**Award through the real path.** The seeder signs in as each archetype and calls
`award_session_xp` once per completed workout, in date order.

The alternative is to insert `xp_events` rows directly with the service role,
which is one statement instead of four hundred round trips. **Rejected**, and not
on style: ADR 0009 makes `award_session_xp` the only path that writes XP, derives
every figure from rows already in the database, and enforces the weekly ceiling
in a trigger. XP inserted directly would be XP that the rules did not produce —
a demo database whose numbers cannot be reproduced by using the app, which is
the one property a demo of a rules engine needs.

Going through the real path also means the rest arrives for free and correctly:

- **Badges** unlock from the ten predicates evaluating real history, not from a
  list of slugs somebody chose.
- **Levels** are read from lifetime XP by `levelForXp`, so they cannot disagree.
- **The leaderboard** becomes a genuine ranking, because it reads `xp_events`.

### The constraint

`npm run seed` is timed in CI against a **60-second budget** (PLAN.md phase 1),
and this adds one RPC per kept day. Sequential per user so the weekly ceiling and
the diminishing-returns curve see sessions in the order they happened; the five
users run in parallel. Measured, not assumed — and if it does not fit, the
awarding window shortens rather than the budget moving.

> **Corrected in review**, twice, and both corrections are the same mistake:
> counting workout ROWS rather than the thing being counted.
>
> "Roughly four hundred RPCs" was the total row count, 417. The first
> implementation awarded only `completed` sessions, which is **160** — and that
> was itself a bug, because `award_session_xp` awards `rest` identically and
> deliberately (CLAUDE.md #4, migration 20260902100000). Every kept day is now
> awarded: **365** calls across the five users, against 417 rows.

### What this is not

Not new content, not a new surface, and no schema change. If a badge does not
unlock for anybody, that is a fact about the predicates and the seeded history,
and the fix is a better fixture rather than a hand-written `achievement_events`
row.

### Addendum, written mid-PR: two of those three claims did not survive

Written after the work it describes and before it was committed, so the plan is
not quietly overtaken by its own implementation. Both changes below were
discoveries made by running the thing, not decisions available at planning time
— which is the honest reason this is an addendum rather than a revision.

**"Not new content" is now false, deliberately.** Awarding worked first time,
and reading the result back showed the progression trees at 5 of 20 rungs for
every user — because the seeded history is barbell work and the trees are
bodyweight progressions. Six bodyweight accessories were added to the two shared
programmes. The clause above still holds in the sense that mattered: nothing was
hand-written into `achievement_events`, and no threshold was moved. The fixture
got better, which is what that paragraph asked for.

Two of the six are prerequisites rather than accessories — an incline push-up
and a lying leg raise — added once the trees were read back a second time. A
tree only unlocks downward, so a rung whose parent wants an exercise nobody does
is unreachable no matter what is below it, and the surface rendered as a wall.
Their prescriptions are written to clear the rung they sit under. Stated plainly
because it is the kind of thing a plan should not let a reader discover on their
own: this is content authored to demonstrate the feature.

**"No schema change" is now false.** Adding those sets made `returning` lose a
badge, which should have been impossible — the predicate ignores unloaded sets,
and the pre-existing sets were proved byte-identical. Chasing it found
`twenty-percent-up` deciding "the user's first working set" by random uuid.
[ADR 0021](../adr/0021-training-order-is-local-date.md) and migration
`20260908130000` are the fix; there is no schema change in the DDL sense, but a
migration is a migration and the plan said there would not be one.

**The rule this came out of holds.** "If a badge does not unlock for anybody,
that is a fact about the predicates" — it was, and the predicate was wrong.

## Verification

Each PR: `npm run verify`, `npm run build`, `npm run test:db` where a migration
is involved, and the browser at 375×812 for anything with a surface. Then the
standing workflow — branch, PR, reviewer subagents, merge only when green,
delete the branch.

Every migration also means `src/db/types.ts` regenerated from a **local** stack
with the CLI version `verify.yml` pins, which is the one thing in this project
that reliably needs Docker. Started when needed, stopped in the same turn.

| Item         | The check that matters                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Achievements | Two fixture users either side of the date line; a hidden definition absent from every client read |
| Comparisons  | Property tests: never picks an object heavier than the total, count never zero when one is picked |
| Personas     | No two personas of one language share a voice variant                                             |
| Progression  | Every `exercise_id` resolves; `level` agrees with `parent_id`; no cycles                          |
| Evidence     | `verify:doi` resolves every DOI against the Handle API, with the output recorded                  |

A note on what those prove: a passing check is not evidence that the content is
_good_, only that it is consistent. `docs/plans/phase-2.md`'s Lesson 8 is the
standing warning against treating the two as the same thing.

## Outcome

**Newest first, by the date it shipped** — so PR 6 leads and PR 7 follows it,
because PR 7 was inserted into the sequence after PR 6 had been planned. The
[status table](#status--complete) is the same list in PR order.

Each entry records what shipped, what the review round changed, and where the
result departed from the plan above. They are longer than the plans they answer
to, which is deliberate: the plan is a guess and the outcome is evidence.

### PR 6 — the supplement evidence table, 2026-09-09

Shipped, and **this completes the five content items phase 5 was briefed to
build.** Thirteen rows at `/evidence`, reached from Coach: 3 graded A, 2 B, 5 C
and **3 D**, where the evidence does not support the popular claim.

All 13 DOIs resolve against the DOI Handle API — run 2026-09-09 against the
hosted project and again in CI against a fresh local stack, both `13/13`,
`0 unregistered, 0 unreachable`. `npm run verify:doi` prints each DOI beside its
source title, because the title is the part a person has to check and no machine
can.

The other two checks: `src/evidence/doi.test.ts` is 9 cases over the format,
including every shipped DOI and the URL forms that must be rejected;
`tests/db/evidence.test.ts` is 13 cases over the rows, including one that inserts
a row with an unusable DOI and asserts the reader drops it.

**The ADR's central argument is measured rather than asserted, which was not the
plan's doing.** The plan cited two DOIs that resolve to the wrong subject; while
assembling the rows, three more were guessed from plausible shapes and every one
of them resolved — to an obituary for a powerlifting historian, a review of
sprint training in football codes, and a paper on ferroptosis in carcinoma cells.
A row citing any of them would have looked checked. That is now the opening of
[ADR 0023](../adr/0023-evidence-rows.md) with the DOIs in it.

**What the criterion did not cover, recorded because nothing enforces it.** Every
claim was written from the source's ABSTRACT, fetched from PubMed, not from its
full text. That is more than a title match and less than a literature review, and
it means a row can cite a real paper on the right subject and still put its
conclusion more strongly than the paper does. The page says so where a user can
see it rather than only in the ADR.

One source was dropped for exactly that reason. The 2018 ISSN review update was
going to back three of the D rows, and its abstract turns out to conclude only
that it is "a foundational basis for determining efficacy" — it does not state
the negatives. Citing it would have been the failure this table is against, so
the D rows cite papers whose abstracts say the thing: no human study has measured
muscle protein synthesis from oral BCAAs alone; eight weeks of ZMA changed
nothing against placebo; a review of 52 studies found most "testosterone
boosters" fail to raise testosterone.

**Deviations from the plan**, all five of them.

1. The ADR is 0023, not the 0021 the plan reserved — two ADRs were written in
   between.
2. NIH ODS fact sheets are named as a source and carry no DOI, so rows cite the
   peer-reviewed work instead.
3. The table ships with a read policy and **no write policy at all**, following
   migration `20260908120100` rather than the catalogue pattern: the unique
   constraint is `nulls not distinct`, so a user-authored row could take a
   system slug, and these rows are health claims with citations attached.
4. **`dose` is prose, not "a dose range in canonical units".** The column holds
   "3–6 mg per kg bodyweight, 60 minutes before" and "No dose is recommended —
   eat the protein instead". A range with a schedule, a per-kilogram basis and a
   do-not-take case is not a number with a unit; canonicalising it would have
   meant dropping the caveats or writing a parser for something nothing computes
   with. CLAUDE.md #8 does not apply and the migration says so. _Added after
   review caught the migration claiming the opposite._
5. **`caution` is free text, not "interaction flags".** Same reason: what a
   reader needs about beta-alanine is that the tingling is harmless, which is a
   sentence rather than a flag.

Docker was started once, for the one thing that needs it — `src/db/types.ts`
regenerated from a **local** stack with the CLI version `verify.yml` pins. The
workstation's own CLI is 2.117.0, the version that changed the generator's output
and turned every open PR red; the file was generated with 2.116.0 via `npx`, and
carries no `__InternalSupabase.PostgrestVersion`, which is the tell for a
`--linked` regeneration. Stopped, with `wsl --shutdown`, in the same turn.

### PR 7 — the demo database has progress in it, 2026-09-08

Shipped. Measured on the hosted project, `npm run seed` in **27.3s** against the
60-second budget; CI times it against a local stack, where the round trips are
roughly twenty times cheaper.

|       |   XP | Level | Badges | Tree rungs |
| ----- | ---: | ----: | -----: | ---------: |
| Dan   | 5798 |     8 |      7 |       8/20 |
| Yossi | 5012 |     8 |      5 |       8/20 |
| Noa   | 4984 |     8 |      5 |       8/20 |
| Maya  | 4555 |     8 |      6 |       8/20 |
| Tom   | 3994 |     7 |      4 |       8/20 |

**The number that matters is not the size, it is the agreement.** The seeded
adherence XP equals what `weeklyAwards` in `src/gamification/xp.ts` — the
deterministic definition, invariant #1 — computes over the same history, exactly,
for three of five users. The other two are 45 and 26 XP lower, which is the
weekly 500 ceiling: `weeklyAwards` deliberately does not apply it and the RPC
does. Both users have weeks pinned at exactly 500. An exact match on all five
would have meant the ceiling was not working.

**Three things went wrong on the way, all found by review, all worth recording
because none was visible from the output.**

1. **The first implementation awarded 20–27% of the correct XP, and reordered the
   leaderboard.** It bulk-inserted a user's whole history and then awarded it.
   `award_session_xp` reads the week's kept-day count with no as-of bound — which
   is right when rows appear as they are lived — so against a pre-loaded week
   every session was charged the LAST one's discount: a seven-day week paid 26 XP
   four times where the engine says 100, 80, 64, 51. History is now written one
   session at a time, in date order, each kept day awarded before the next exists.
   The RPC was not changed: it is correct for the way the app writes, and the
   seeder was the thing lying about being a user.

2. **Every badge unlocked on the first call.** Same cause: `evaluate_achievements`
   tests the whole history, so with everything pre-loaded all eleven fired at
   once, stamped with the oldest session's date, their 75 XP each colliding with
   that week's ceiling — and `achievement_events` is once-only, so the XP past
   the ceiling was never paid. Badges now land on 4–7 distinct dates spread
   across months, which is both correct and the better demo.

3. **Rest days were not awarded at all.** `award_session_xp` awards `rest`
   identically and deliberately, and the pass filtered to `completed`, leaving
   most of each week's kept days unpaid while they still moved the curve — the
   exact defect migration 20260902100000 was written to fix, recreated one layer
   up.

**Also fixed, found by the same review round:** a user could attach a set to
another user's workout (`sets_own` checked `user_id` and nothing about
`workout_id`), which two predicates then read across the boundary — migration
`20260908140000`, reproduced before it was fixed and asserted in
`tests/db/rls.test.ts`. And `loadUnlockSets` was ordering by `workout_id` under
a comment claiming newest-first: a random uuid, the same defect as ADR 0021, one
file from the migration that fixes it.

**What is authored rather than observed.** Six bodyweight accessories were added
to the two shared programmes, two of them prerequisites whose prescriptions are
written to clear the rung above them. Recorded in `docs/FRAMING.md`'s
invented-content list, where the project keeps that kind of admission.

### PR 5 — progression trees, 2026-09-08

Four trees, twenty nodes, a reader, a pure evaluator and a surface. _Nineteen
since 2026-09-11: the legs tree lost a rung that nobody could open — ADR 0020's
amendment._ The table
had been in the schema since migration 0002 with no rows and no reader; this is
both, in one change, with the contract committed ahead of it.

**ADR 0020 was written before the code**, which the three ADRs before it in this
phase were not. The decision it records is a security one dressed as a data
one: the obvious implementation is SQL text in a column, exactly like
`achievements.predicate` — and `progression_nodes` carries the same catalogue
write policy, so a user can own a row, and executing one would be privilege
escalation available to anyone who can sign up. ADR 0009 §3 defends that with a
single `where user_id is null` clause and a test. Structured JSON has no
execution semantics to defend, so there is no clause for a future refactor to
drop.

**Three things the migration got wrong, all silent, and CI caught the worst.**

A single `INSERT ... SELECT` sees the table as it was at statement start, so
every parent lookup returned null and the trees arrived flat — `parent_id` is
nullable, so nothing errored. Inserting one level at a time fixes it.

Half the slugs an author would guess do not exist: no `push-up`, no
`pistol-squat`, no `hollow-hold`. Every slug was checked before being written.

And the one only CI could find: **a migration cannot depend on seeded data.**
The nodes resolved `exercise_id` by slug, which passed against hosted — where
the catalogue had been seeded weeks earlier — and produced twenty nulls on a
fresh stack, because the catalogue is loaded by `scripts/seed.ts` and
`npm run migrate` runs before `npm run seed`. The same migration was producing
different content in different environments, which is exactly the fault the
project's own comments warn about for UUIDs, reached by another road. It had
also **broken `npm run seed` outright**: the column is `ON DELETE RESTRICT` and
the seeder starts by deleting every shared catalogue row. Nothing read the
column, so it is null everywhere now, and the two tests that used to assert it
resolved now assert it does not.

**The core tree opens two rungs where the others open one**, because
`public.sets` has no duration column and a plank cannot have criteria. Asserted
in a test rather than left as a surprise, and recorded in the ADR as a schema
gap whose fix is a column — not a criterion pretending reps are seconds.

**Found while surveying the catalogue for this PR:** `tests/db/rls.test.ts` had
been leaking a shared exercise and a shared hidden achievement on every run
since phase 0, because `afterAll` deleted only the fixture users and a
`user_id is null` row belongs to nobody. At the moment of deletion there were
**29 achievements and 8 exercises** on hosted; the earlier reading that produced
the "39 system achievements" figure counted 28, one test run before. The counts
are unequal because the achievement fixture predates the exercise one. 39 system
achievements are now 11, which is the real number.

### What review changed, which was again most of it

**A raw NUL byte made `src/db/progression.ts` binary to git.** The sentinel for
an unparseable criterion was a `sets_at` naming an "impossible" exercise slug,
and the impossibility rested on one invisible character inside a string literal.
Two consequences, both worse than the first one looks:

- `git diff` rendered the entire reader — including its tenancy filter — as
  "Binary files differ". The one file in the change carrying a tenancy boundary
  was the one nobody could review, and no future change to it would be reviewable
  either.
- Strip the character with a formatter and the sentinel becomes the plain word
  "unparseable", which any authenticated session can create as an exercise slug
  and then satisfy — turning every malformed node into a free unlock.

`src/llm/safety.ts` carries an AI-NOTE saying control characters are written as
escapes and never embedded, for exactly this reason. It was written before this
file. The replacement is a `{ kind: 'never' }` schema variant the evaluator
refuses by construction, so no formatter can make it satisfiable.

**A CSS token that does not exist, and a browser check that could not see it.**
`.tree-rung` used `var(--line)`; the sheet's token is `--border`. An unresolvable
`var()` invalidates the whole `border` shorthand, so `border-style` fell back to
`none` and `.is-next` had no border left to colour — the "what to work on next"
affordance never drew. The browser pass read class names and text and found
everything correct. A rung is now a `.card`, which is the primitive it was
badly reimplementing.

**The page lit no tab.** `/progression-trees` was not in `OWNED_BY`, whose own
AI-NOTE says leaving a route out "lights no tab at all, which is the exact
failure `isCurrent` was written to prevent". It also kept the route out of the
orphan-link guard — so the page whose comment says "the link on Profile is the
only way in" was the one page nothing checked had a link.

**ADR 0020 claimed something false about its own code**: that there was "no
`user_id is null` filter a future refactor can drop". `loadProgressionTrees`
carries exactly one, and it was the only thing keeping user-authored rows out —
which mattered, because the slug uniqueness constraint is `nulls not distinct`,
so a user row could reuse a system slug and the evaluator keys its map by slug.
Corrected, and closed properly: migration `20260908120100` drops the write
policy, because ADR 0002's amendment says the write half needs a named feature
and node authoring is not one.

Smaller: a NaN weight satisfied the weight floor (`NaN < 20` is false, and
Postgres `numeric` accepts NaN); `weight_kg` accepted `0` and `null`, either of
which silently makes a bodyweight node unsatisfiable; `loadUnlockSets` had no
cap and no order, so past `max_rows` a rung could flip between locked and
unlocked across two page loads; the page mapped over a hardcoded tree list, so a
fifth tree would have rendered nowhere; and the reader cited `src/db/plans.ts`
as re-validating jsonb on read, which it does not do at all.

### Deviations from the plan, stated

- The evaluator shipped as `src/gamification/unlocks.ts`, not
  `progression.ts` as PR 5's section says — `src/metrics/progression.ts` already
  means something else, and ADR 0018 had noted the word was overloading.
  Argued in ADR 0020's Naming section.
- The criteria vocabulary grew a `weight_kg` floor and a `never` kind beyond the
  single `sets_at` the plan described.

24 unit cases on the evaluator, 13 database cases on the rows. 867 unit tests,
159 database cases (the runtime figure `npm run test:db` reports; the static
`it(` count is 156, the difference being parameterised cases), `verify` and
`build` clean.

A dead CSS rule was written and removed in the same session: `.tree-heading`
set `text-transform: capitalize` and `h2.section` already sets `uppercase` at
higher specificity, so it never applied. Uppercase is right anyway — it matches
every other section heading.

### PR 4 — the remaining personas, 2026-09-08

The Sergeant and the Physio, taking the roster from three to five.

**The Sergeant makes `docs/adr/0005-llm-safety.md` §1 true.** That ADR has said
since phase 2 that "the persona layer ships a Rival and a Sergeant"; the Old
Master shipped in its place, so the sentence described an intent for eight days.
It is also the first row to reach `humor_level = 'crude'`, which
`users.humor_max_level` has offered since the first migration with nothing
behind it — until now, choosing crude changed nothing for anybody.

**The Physio's justification is argued, not quoted, and the difference is
recorded.** The obvious citation is PRD §5.4's tone override, and it is the
wrong one: that applies "regardless of which persona is selected", so it is an
argument _against_ needing a gentle coach. The real argument is that the three
shipped coaches sat at intensity 2, 3 and 4 with two of three at `cheeky`, so
choosing between them changed the jokes more than the register.

**A test written for the Sergeant found a live bug in the Rival.**
`banned_phrases` were matched with `String.includes`, so a short word banned
every word containing it — and the Rival has banned `weak` since phase 3, which
therefore also banned **weakness**. "Your weakness is the lockout" is ordinary
coaching language, and `deliverPlan` has no fallback by design (ADR 0006), so a
delivery containing it was rejected, retried, rejected again, and the user got
an error instead of the block the critic had already approved.

`src/llm/safety.ts` had already reached the same conclusion for the general
scanner and written it down — "`fat` and `weak` are ordinary coaching
vocabulary", which is why it matches second-person constructions instead of bare
words. The persona layer had the lesson available and had not applied it. The
matcher now uses word boundaries, with the trade stated: `quit` no longer
catches "quitter", and a list that wants both lists both.

**`SHIPPED_PERSONA_SLUGS` was a constant nobody read.** The skill says to keep
it in step because "it is what tests and fixtures enumerate"; nothing enumerated
it — it appeared in its own declaration and one doc comment. `tests/db/personas.test.ts`
now asserts it equals the shipped rows, which is what makes updating it matter.

### What review changed, and the habit it exposed

Three reviewers, and between them they found that **the fix itself was wrong in
three ways and the comment describing it was wrong in one.**

- **The matcher let plurals through.** `quitters` and `princesses` both escaped
  lists banning the singulars — measured, not guessed — and plural is the
  natural register for the idiom the Sergeant's list exists to catch. It now
  matches a phrase and its plural.
- **It did not see punctuation.** Every persona bans `no pain no gain`, and a
  model writes "no pain, no gain". The most-repeated ban in the table did not
  fire on its own canonical form.
- **It did not strip invisible characters**, where `scanOutput` does and says
  why. `qui<U+200B>tter` walked through.
- **Its own migration comment described the matcher this same commit deleted**,
  and instructed the next author to keep applying the rule that had just been
  removed.

Normalising both sides — lowercase, strip invisibles, collapse punctuation —
closes the first three at once instead of adding three special cases.

**The recorded trade-off was itself wrong.** The docs said the cost was "`quit`
no longer catches quitter", which is free, because `quit` is on nobody's list.
The real cost was `weakling`: substring matching had been catching it by
accident via the Rival's `weak`, and `src/llm/safety.ts` does not catch "you are
a weakling" either. Both rows now list it, and the ADR states the cost with the
example that bites.

**Two of the Physio's phrases could never fire.** `it is probably nothing` and
`you will be fine` were authored as full sentences; a model writes contractions.
Those were the two dangerous-advice entries on the coach whose whole character
is not being dismissive about pain. Replaced with the fragment that carries the
meaning.

**Growing the adversarial suite found a hole in the scanner it was testing.**
ADR 0005 §5 requires that suite to grow every phase, and this is what it is for:
`DEMEANING` consumed `such a ` in its intensifier group while its noun
alternatives carried their own article, so **"you are such a failure" did not
match** while the plain form did. Fixed, with both forms pinned.

**And a fence label was never sanitised.** `fenceUntrusted` cleaned its value
and interpolated its label raw — and `src/persona/prompts.ts` builds that label
from `personas.name`, a column a user can write on a row they own. A name
carrying the fence token closed the fence early and wrote into the region the
preamble tells the model to trust. One line, and it fixes every caller.

**The habit worth naming:** this is the third ADR in this phase written after
its code at a reviewer's prompting. [ADR 0019](../adr/0019-banned-phrase-matching.md)
says so in its own first paragraph. Three times is not an accident — the lesson
is that "changing how a check behaves" is a decision even when the change is
four lines.

Eleven database cases, ten unit cases on the matcher, four on the persona layer
in the adversarial suite. 846 unit tests, 146 database cases, `verify` and
`build` clean. Checked at 375×812: all five coaches render on `/coach`,
selection works, no horizontal overflow.

Documents updated: `docs/PRD.md` §5.4, `docs/PLAN.md` phase 3 and its drift
criterion, `docs/adr/0005-llm-safety.md` §1, `docs/adr/0006-persona-boundary.md`
(the voice allocation is now three en-GB coaches, and a device needs three
installed en-GB voices before they sound like three people),
`src/persona/schema.ts`, and `.claude/skills/add-persona/SKILL.md`.

### PR 3 — tonnage comparisons, 2026-09-08

Fourteen objects from a domestic cat to the Eiffel Tower, and `compareTonnage`
in `src/metrics/comparisons.ts` picking the **heaviest object the user has
actually passed**. Not the closest-fitting one: the sentence has to shrink as
the user grows, and closest-fitting tells a five-year lifter they have moved
thirty-one thousand cats, which is arithmetically perfect and reads as noise.

Three decisions worth their lines:

- **Null is a real answer.** Below the lightest object there is no comparison,
  because "about half a cat" is both wrong and a strange thing to say to
  somebody three sets into their first session.
- **Two authored forms per row, not a pluraliser.** "a double-decker bus" and
  "the Statue of Liberty" do not take the same article, and "rhinoceroses" is
  not a suffix rule. A pluraliser in code would be a second thing to get wrong
  about a row that is already content.
- **The source note is not a citation, and the migration says so in an
  AI-NOTE.** PR 6's table is where a claim needs a DOI.

Twelve unit cases, five of them generated properties — never picks an object
heavier than the total, never reports a count below one, never claims more mass
than was lifted, returns null only below the lightest row, and never moves down
the ladder as the total grows. Ten `tests/db` cases on the rows themselves,
including one that asserts **no step in the ladder is more than twentyfold**:
the largest count a user can be shown at any rung is the ratio to the next one,
so a hundredfold gap would print "ninety-nine pianos", which is a bare number
wearing a costume.

### What review changed, again

**A grant to `anon` that had been there since phase 0.** The security reviewer
asked whether the new table inherits the right privileges; it does — and
measuring it turned up that `anon` held `TRUNCATE`, `REFERENCES` and `TRIGGER`
on all eighteen tables. Migration 0006 revokes four verbs of the seven Supabase
grants, and `schema-invariants.test.ts` filtered its assertion to the same four,
so the test written to prove "anon holds nothing" could not see the three it
held. TRUNCATE is the one that matters: no policy filters it, because a policy
cannot make a TRUNCATE affect fewer rows. Nothing could reach it — PostgREST has
no TRUNCATE verb — which is the same shape as migration 0011's finding, and the
same reason to fix it rather than file it. ADR 0003 amended; the test now
asserts over every privilege type.

**`check (mass_kg > 0)` did not exclude `NaN`.** PostgreSQL orders NaN above
every non-NaN numeric so that it can be indexed, so `'NaN'::numeric > 0` is
true — measured against hosted, not assumed — and PostgREST will cast the JSON
string `"NaN"` into the column. Nothing rendered it, because `compareTonnage`
guards with `Number.isFinite`; what was wrong was the stated guarantee, which
that guard's own comment cited. Now `> 0 and < 1e10`.

**A write policy with no feature behind it.** The table copied the ADR 0002
catalogue policy pair, and the ADR justifies the write half by a named future
feature: user-authored custom exercises. There is no equivalent here, so the
pair granted `INSERT` on a joke ladder to every authenticated session, and
PostgREST is a path whether or not the UI has a button. Dropped, grant revoked,
ADR 0002 amended with the rule that the write half needs a feature — and with
the negative test no catalogue table had: that a session cannot insert a row
with a null `user_id`, which is the escalation from self-only row to content
served to everybody.

**The worked example in the migration was wrong.** It said 140,000 kg is "about
a double-decker bus"; run through the shipped rule against the shipped rows it
is one Space Shuttle orbiter, and a bus would have been eleven. Three separate
"five-year lifter" figures in the same PR disagreed by 21×, none of them from
running anything. All replaced with computed ones. This is the one number in a
file that a reader checks.

**And this decision was missing its ADR, which is PR 2's lesson repeated.**
[ADR 0018](../adr/0018-tonnage-comparisons.md) now carries heaviest-passed over
closest-fitting, and says plainly that the plan stated only the chosen rule, so
the rejection was made at the keyboard rather than recorded first.

Smaller: the page lowercased `source_note` to fit mid-sentence and turned two
rows into "a modern london double-decker" and "a european supermini"; the db
test hand-rolled the reader's query instead of calling it, so the shipped
column list and `Number()` coercion were asserted nowhere; a comment cited
`mobile-interface.md` for a claim that document does not make; and the table
carried an index on a fourteen-row column nothing seeks on.

817 unit tests, 135 database cases, coverage 98.8% statements / 97.3% branches
on `src/metrics`, `verify` and `build` clean. Checked at 375×812 against hosted:
39,480 kg all time reads "about a humpback whale", and the Tonnage hint carries
the row's range.

**Found while checking, and deliberately not fixed here:** opening a FieldHint
in the right-hand column pushes the page sideways — `scrollWidth` goes 375 → 418
with the Adherence bubble open, 43px past the edge. `docs/specs/mobile-interface.md`
requires it of wide content specifically rather than in general, but a page that
scrolls sideways on a phone is against everything that document is for. It is
pre-existing, it reproduces on hint copy this PR never touched, and it belongs
in its own change.

> **Closed 2026-09-09**, in the change it was parked for —
> [ADR 0022](../adr/0022-popover-clamping.md), branch `hint-bubble-viewport`.
> Two things in the paragraph above turned out to be wrong, and both are worth
> keeping visible. It is not "the right-hand column": at 375 px `.grid.cols-4`
> is two columns with the first two children spanning both, and the tiles that
> do sit right carry no hint — it is the LABEL length pushing the button right,
> "Adherence · 4 wks" landing its hint at x=158. And the spec no longer
> "requires it of wide content specifically": §3 now states the general rule,
> which is the right resolution of the hedge this paragraph was making.

### PR 2 — achievements, 2026-09-08

**Ten** rows, one in every tier the schema has allowed since phase 0, taking the
system total to eleven. Every one of the ten has the near miss and the
fires-once re-run the skill asks for, plus four cases about the set as a whole.

### What review changed, which was most of it

Four reviewers ran and every one of them found something the tests did not.

**The volume badge did not honour the promise the PRD makes by name.** §5.5 says
"an empty bar spammed for reps must not unlock a volume badge", and fifty sets
of 20 kg for 100 reps is a hundred tonnes with every set inside the plausibility
bounds — `checkPlausibility` waves it through too, because 20 kg is not 1.5× of
anything. A load floor was the obvious fix and is the wrong one:
`plausibility.ts` refuses absolute strength claims on principle, and a floor is
one. **The gate is time.** Thirty distinct logged days, which claims nothing
about how strong anybody is and costs a faker thirty days of adherence — the
only thing the app pays for anyway.

**Rule 2 in the migration header was false about its own file.** It stated the
plausibility bounds as universal; `groundhog-set` and `five-patterns` carried
none. Both now carry the nonsense bounds, and the header says which rows are
gated and why `five-patterns` deliberately still counts a bodyweight set with no
external load at all.

**"The first working set" had no defined answer.** `twenty-percent-up` picked it
with `array_agg(... order by created_at)`, and `created_at` defaults to
transaction time — so every set written by one INSERT ties, and the seeder
writes them in batches. Two evaluations over identical data could disagree,
which is the first thing the skill's §2 forbids. Now ordered by a total order.

> **Superseded, PR 7.** A total order was the narrower answer: the added keys
> were `workout_id, set_index`, and `workout_id` is a random uuid. The result was
> stable within one database and still arbitrary, so the badge kept being decided
> by a draw. See [ADR 0021](../adr/0021-training-order-is-local-date.md).

**`users.timezone` was unvalidated input to a definer function.** The column is
bare text; its validation lived only in Zod at the app boundary, and
`users_update_own` lets a session PATCH the row straight past it. One bad value
gave two unrelated symptoms — `before-the-birds` silently never firing, because
`evaluate_achievements` swallows the error, and `accept_challenge` throwing,
because it does not. A trigger now validates against `pg_timezone_names`, fixing
both call sites at once.

**The evaluator re-ran predicates for badges the user already held.** Every one
of them, on every completion, forever — and the two most expensive are the ones
earned early and kept for life. Skipping held rows is behaviour-preserving for a
reason worth stating precisely: it is the `achievement_events_once` **constraint**
that makes a second unlock impossible, not the predicates being monotone. Two of
them are not.

**And the decision itself was missing its ADR.** The reasoning lived in a
migration header. Reviewers on two different lenses said the same thing
independently, and the project's own doc coupling agrees: a decision with a
rejected alternative belongs in `docs/adr/`. [ADR 0017](../adr/0017-held-hidden-achievements.md)
now carries it, and says plainly that it was written after the migration.

**The date-line test was proved load-bearing rather than assumed to be.** The
`new-years-day` predicate was temporarily swapped for a server-date one against
the hosted project and the suite re-run: the Kiritimati assertion failed with
`expected [ 'before-the-birds' ] to include 'new-years-day'`, and passed again
once the predicate was restored. A test for a timezone bug that would also pass
with the bug present is worth nothing, and this one would not have been.

**Adding achievements broke a test that had been accidentally right.**
`gamification.test.ts`'s "does not award the same workout twice" counted _all_
`xp_events` rows for the week and expected one. It got two — an adherence award
and an achievement award — because the fixture user now clears
`three-weeks-away`. The index that guarantees the property was narrowed to
`source = 'adherence'` on purpose in migration 20260902095100, so the assertion
is now narrowed to match it. Until there were ten more achievements, the unfiltered
count happened to be the same number.

It also makes live the path migration 20260902095100 was written for and called
"latent rather than live": a session that unlocks two achievements at once.

801 unit tests, 120 database cases, `verify` and `build` clean. Checked in the
browser at 375×812 with a hidden badge granted to a seeded user and revoked
afterwards — it renders with its full definition and both chips, which is what
the reader change exists to make possible.
