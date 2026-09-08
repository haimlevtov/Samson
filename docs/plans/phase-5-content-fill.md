# Phase 5, part two — the content fill it was actually briefed to build

Planned 2026-09-08, before any of the code below. Five branches, five PRs, in
the order given.

> **The decision `plans/phase-5.md` left open is now made: rescheduled, not
> cut.** That record ends by saying the content-fill items "are marked
> compressible and parallelisable in the brief, so cutting is legitimate — but
> that decision has not been made and is not made here." It is made here. All
> five items ship.

## Why finish it rather than cut it

Cutting was the cheaper answer and it was available. Three things argue against
it.

**Four of the five items are the parts of the product a user actually meets.**
The phase that ran instead built surfaces; this one builds what goes on them.
`docs/PRD.md` §5.5 describes achievements "including hidden ones, whose
definitions are never sent to the client, and calendar-triggered ones that fire
on _your_ local date" and "progression trees for push, pull, legs and core" —
against one achievement and an empty table. The gap is between the spec and the
build, not between the plan and an ambition.

**Two of phase 5's three acceptance criteria are unreachable without it.** A
test that every evidence-table claim has a resolvable DOI needs an evidence
table; a calendar achievement firing on the right local date needs a calendar
achievement. Cutting the content would not close those criteria, it would
delete them.

**The schema already promised it.** `achievements.tier` enumerates eight tiers
and one is used. `users.humor_max_level` offers `crude` and no persona reaches
it. `progression_nodes` has been in the database since the first migration with
no rows and no reader. Each of those is a claim the schema makes that nothing
honours, which is the same failure in three places.

## What is deliberately still out

**The diet advisor stays in phase 6.** This phase builds the evidence table and
a page that reads it. It does not build maintenance-calorie arithmetic, the
clamped floor, or retrieval-driven answers from the coach — those are phase 6's
first acceptance criterion and they need their own adversarial suite.

**Nothing here awards XP on a new curve.** Achievements pay the flat 75 already
in `award_session_xp`; no tier multiplies it. See the volume-tier note below.

---

## PR 1 — this plan, and the decision in `PLAN.md`

**Branch `phase-5-content-fill-plan`.** Documents only.

`docs/PLAN.md` phase 5 currently carries a note saying the rescheduling decision
"has not been made". It gains the decision and a pointer here. This file commits
before any of the code it plans, which is the whole point of it existing —
`CLAUDE.md`, and the failure `plans/phase-5.md` records.

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
having a second definition in SQL means the badge and the chart can disagree
about the same set. PR-tier achievements are written against raw logged weight
and reps instead, and the migration says why.

**The volume tier pays once and is gated on plausibility.** Invariant #4 forbids
XP that _scales_ with volume, because scaling pays people to overtrain. A badge
is bounded — 75 XP, once, ever — so the tier is not a breach, but the argument
has to be written down rather than assumed, and the predicate has to exclude
implausible sets or a mistyped `200` for `20` buys the badge. The SQL mirrors
`MAX_PLAUSIBLE_WEIGHT_KG` and `MAX_PLAUSIBLE_REPS` from
`src/gamification/plausibility.ts`, pinned by a test so the two cannot drift.

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
else.** Not unlocking it silently is the worst of both — the definition stays
secret and the reward disappears. A `security definer` function returns the
definitions of hidden achievements **this user has already unlocked**, which
leaks nothing: they earned it, and knowing what you hold is not knowing what
exists. Locked hidden definitions never cross the network, which is the
criterion as written.

### Acceptance

- A `tests/db` case asserts a hidden achievement's definition is absent from
  every client-visible read, and present in the holder's own unlock list.
- A `tests/db` case creates two fixture users either side of the date line —
  one at UTC+14, one at UTC−11 — and asserts the calendar achievement fires for
  the one whose **local** date matches and not for the one whose **server** date
  does. The pair is the test; either alone passes with a server-date predicate.
- Per the skill: every achievement has a near-miss fixture, and a re-run
  inserts no second event.

---

## PR 3 — cumulative-tonnage comparisons

**Branch `tonnage-comparisons`.**

"You have lifted a bus" is the one place in the app where a number is allowed to
stop being a number. `totalTonnage` is already on Profile as a bare kilogram
figure that nobody has any intuition for.

**The objects are rows, the selection is code** — CLAUDE.md #7 and #1. A new
`tonnage_comparisons` table (slug, name, singular/plural forms, `mass_kg`, a
source note), and `src/metrics/comparisons.ts` picking the heaviest object the
user has passed at least once and reporting how many. Pure, unit-tested, no
database in the metrics directory as usual.

**Every mass carries a source note**, because a number in a database with no
provenance is indistinguishable from one somebody guessed. These are approximate
by nature — an elephant is a range, not a value — and the note says so rather
than implying a precision the figure does not have.

Surfaced on Profile beside the all-time tonnage figure it explains.

---

## PR 4 — the remaining personas

**Branch `remaining-personas`.** Follows `.claude/skills/add-persona/SKILL.md`.

Two rows, both justified from documents that already exist rather than invented
to fill a plural:

**The Sergeant** — `docs/PRD.md` §5.4 and `docs/PLAN.md` phase 3 both say "one
of the Sergeant or the Old Master". The Old Master shipped; this is the other
one, and it is the only persona named anywhere that does not exist.

**The Physio** — PRD §5.4 promises "a tone override forces a gentler register
when an injury or a run of missed sessions is flagged". There is no persona at
the gentle end: the Analyst is clean but analytic at intensity 2, and calm is
not the same as kind.

The Sergeant is also the **first row to reach `humor_level = 'crude'`**, which
`users.humor_max_level` has offered since phase 0 with nothing behind it. That
makes it the highest-risk persona in the app on both axes at once — intensity 5
and crude — so its `banned_phrases` list is the longest, and the PR states
plainly that the safety layer, not the row, is what holds.

Voice variants: en-GB 0 and 1 and en-US 0 are taken. The Sergeant takes en-GB 2
and the Physio en-US 1 — the rule in the skill that nothing enforces and the
`tests/db` case that catches it.

---

## PR 5 — progression trees

**Branch `progression-trees`.** ADR first, because this defines a contract that
does not exist.

`progression_nodes.unlock_criteria` is `jsonb not null default '{}'` and no row
has ever used it. Whoever fills it first defines the shape, and
`.claude/skills/add-progression/SKILL.md` says that is ADR-sized rather than
migration-sized.

**ADR 0017 — structured criteria, interpreted, never executed.** The obvious
thing to copy is `achievements.predicate`, which is SQL text run server-side —
and which ADR 0009 §3 restricts to `user_id is null` rows because executing a
user-authored one is privilege escalation for anyone who can sign up. A
structured jsonb that an evaluator _interprets_ has no such clause to forget.
The ADR argues that, fixes the shape, and says what a node that fails to parse
does (nothing, visibly).

Then: the four trees as rows (push, pull, legs, core), a reader in
`src/db/progression.ts`, a pure evaluator in `src/gamification/progression.ts`
measuring criteria against logged sets, and a surface at `/progression` reached
from Profile — a sixth tab would be the fault ADR 0012 was written to fix.

`tests/db` asserts the properties the skill names: every `exercise_id` resolves,
`level` equals the parent's plus one, no cycles, and a chain never changes tree.
The lookup-missed case is the one that bites — a `select` with no match inserts
a null rather than failing.

---

## PR 6 — the supplement evidence table

**Branch `supplement-evidence`.** ADR first: this is the project's first table
of **external claims**, and it needs a rule for what may go in it.

**ADR 0018 — one row, one claim, one DOI.** Rows carry a supplement, a single
claim, an evidence grade, a dose range in canonical units, interaction flags,
and a DOI that backs _that_ claim. No row summarises a literature; a row nobody
can check is worse than an absent row, because it looks checked.

Sources are NIH ODS fact sheets and ISSN position stands, per the brief. Grades
`A` to `D` are defined in the ADR, and **`D` rows are shipped on purpose** —
"the evidence does not support this" is the answer a user most needs and the one
a supplement table never gives.

### The DOI test, and where it is allowed to run

The acceptance criterion is that every claim has a **resolvable** DOI, which
means a network call. `verify.yml`'s unit job has no secrets and no network
dependency by design, and its comment says so: a change that needs one means
"something has grown a hidden dependency on the network — fix that rather than
adding the secret".

So the check is split, and both halves are real:

- **`npm test`** asserts every row has a syntactically valid DOI and that no
  claim is unbacked. Offline, always runs, catches an empty field.
- **`npm run verify:doi`** resolves each DOI against the DOI Handle API and
  fails on anything that does not return a registered handle. Its own CI job,
  which is allowed to reach the network and allowed to be red without blocking
  a merge that did not touch the table.

Syntactic validity is not resolvability, and pretending otherwise would be
exactly the verification theatre `docs/PLAN.md` warns about. The resolver runs
before the PR merges and its output goes in the outcome section of this file.

Surfaced at `/evidence`, linked from Coach. A table with no reader is the
`progression_nodes` mistake, and this phase is fixing that one.

---

## Verification

Each PR: `npm run verify`, `npm run build`, `npm run test:db` where a migration
is involved, and the browser at 375×812 for anything with a surface. Then the
standing workflow — branch, PR, reviewer subagents, merge only when green,
delete the branch.

| Item         | The check that matters                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Achievements | Two fixture users either side of the date line; a hidden definition absent from every client read       |
| Comparisons  | Property tests: never picks an object heavier than the total, count never zero when an object is picked |
| Personas     | No two personas of one language share a voice variant                                                   |
| Progression  | Every `exercise_id` resolves; `level` agrees with `parent_id`; no cycles                                |
| Evidence     | `verify:doi` resolves every DOI against the Handle API, with the output recorded                        |

## Outcome

_Filled in as each PR merges._
