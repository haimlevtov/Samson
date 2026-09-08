# Phase 5, part two — the content fill it was actually briefed to build

Planned 2026-09-08, before any of the code below. Six PRs: this plan, then one
per content item, in the order given.

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

**ADR 0021 — one row, one claim, one DOI.** Rows carry a supplement, a single
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

### PR 5 — progression trees, 2026-09-08

Four trees, twenty nodes, a reader, a pure evaluator and a surface. The table
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

**Two things the migration got wrong first, both silent.** A single
`INSERT ... SELECT` sees the table as it was at statement start, so every parent
lookup returned null and the trees arrived flat — and `parent_id` is nullable,
so nothing errored. Inserting one level at a time fixes it. And half the slugs
an author would guess do not exist: the catalogue has no `push-up`, no
`pistol-squat`, no `hollow-hold`. Every slug was checked before being written,
and `tests/db` asserts every `exercise_id` resolved.

**The core tree opens two rungs where the others open one**, because
`public.sets` has no duration column and a plank cannot have criteria. Asserted
in a test rather than left as a surprise, and recorded in the ADR as a schema
gap whose fix is a column — not a criterion pretending reps are seconds.

**Found while surveying the catalogue for this PR:** `tests/db/rls.test.ts` had
been leaking a shared exercise and a shared hidden achievement on every run
since phase 0. 29 and 8 of them on hosted, so `evaluate_achievements` was
running 39 predicates per workout completion, 28 of them junk, against a
64-subtransaction ceiling. Fixed, and the rows deleted; 39 system achievements
are now 11.

21 unit cases on the evaluator, 10 database cases on the rows. 867 unit tests,
156 database cases, `verify` and `build` clean. Checked at 375×812: four trees,
5 of 20 unlocked for a user with no bodyweight history, one "next" per tree, no
horizontal overflow.

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
