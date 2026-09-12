# ADR 0029 — Equipment is a Settings question, and it carries a ceiling

**Status:** accepted
**Date:** 2026-09-12

> Written before the code it governs, in its own commit.

## Context

**Nothing under `app/` or `src/` writes `public.user_equipment`.** `scripts/seed.ts`
does, and so does one `tests/db/` fixture; no application code does. Confirmed by
grep, and on the hosted project, where the only rows belong to the five seeded
archetypes. There is no UI for it anywhere.

_An earlier draft of this sentence said "written by exactly one thing since phase
0", which the test fixture falsifies. The claim that matters is the one about
application code._

That is not a cosmetic gap. `availableExercises` returns an **empty list** for a
user with no rows, and invariant #5 says the planner selects only from that
pre-filtered list. So:

- **A user who is not one of the five demo accounts can never be given a plan.**
  Rework PR 8b renders an explicit state for it rather than spending a model call
  (ADR 0027 §5), which stops the gap presenting as a failed plan — and leaves the
  user with nothing they can do about it.
- The exercise picker shows them nothing either, for the same reason.

The rework plan already placed this correctly: equipment is _"a separate question
feeding a different place, not a planner input"_. Filtering happens in SQL before
the model sees anything, so equipment is a fact about the user, and facts about
the user live in Settings.

## Decision

**A picker on `/settings`, over the shared equipment catalogue, and it collects
the load ceiling.**

### 1. The ceiling is collected, and that is the decision worth arguing

`user_equipment.max_load_kg` is nullable, and **null means no ceiling**. It is
read by `load_ceiling`, one of the six deterministic rules in
`src/planner/rules.ts`:

> _the minimum of the non-null ceilings: if any implement the movement needs is
> capped, that cap binds. Yossi's dumbbells stop at 30 kg regardless of what else
> is in the room._

A picker that collected only which tags a user owns would leave every real user's
equipment uncapped, and **that rule would never fire for anybody outside the
seed**. The failure would be silent and exactly the one `docs/PRD.md` §2 names
for the equipment-limited segment — _"Never prescribe something he physically
cannot do"_ — so the rule would still pass its tests, still appear in the report,
and protect nobody.

**It is optional per item, not required.** Blank means null means no ceiling,
which is the column's own semantics and the right default: most gear in most
rooms has no meaningful cap, and a required field would make people invent one.
The input appears only once an item is selected — twelve number boxes nobody
needs is how a form gets abandoned halfway.

**But "optional" is not "anything goes", and the first implementation got that
wrong.** It read an unparseable value as null — which means NO CEILING, so a
mistyped cap silently removed the protection. `<input type="number">` makes that
reachable without any crafted request: the browser sanitises a value it cannot
parse to an **empty string**, so "30 kg" arrives as blank. Two fixes, both taken
from what this repo already does for the biometrics:

- The field is `type="text"` with `inputMode="decimal"`, so the raw value reaches
  the server instead of being blanked by the browser.
- The grammar is `measurementField` from `src/diet/biometrics.ts` — blank is
  null, and anything else that is not a number to at most **two decimal places**
  is a parse failure. Two places because the column is `numeric(6, 2)` and
  PostgreSQL rounds to scale BEFORE the CHECK runs, so `0.001` would otherwise
  be stored as `0.00` and violate `> 0` — after the delete below had already
  run. `docs/specs/diet.md` §1: "two gates are defence in depth only while they
  agree."

### 2. Delete first, then insert — and the order is a safety decision

Saving is a replace: rows the user deselected go, rows they selected arrive. The
two statements are not a transaction through PostgREST, so one of them can land
without the other, and the order decides which way a half-save fails.

- **Insert then delete**, failing after the insert: the user keeps equipment they
  just removed. The planner may then prescribe a lift they cannot do — the exact
  harm `load_ceiling` and the equipment filter exist to prevent.
- **Delete then insert**, failing after the delete: the user has less equipment
  than they chose, or none. The planner offers fewer candidates, or 8b's
  `no-equipment` state tells them plainly.

So: delete first. A half-save leaves the user under-equipped and informed rather
than over-equipped and unaware, which is the same direction every other safety
default in this project points.

**And everything that can fail happens before it.** The tag ids are resolved and
the numbers validated first, so the only statement after the delete is one whose
inputs are already known good. FOUND IN REVIEW: the id lookup used to sit after
the delete behind a non-null assertion, which made "the caller filtered the
selection against these same tags" a comment rather than a mechanism — and the
tests call this function directly.

### 3. The catalogue is read, never written

The picker offers the **shared** tags — `equipment_tags` where `user_id is null`.
`src/catalogue/equipment.ts` is the vocabulary the seed writes and
`tests/db/equipment.test.ts` pins the two against each other, so the count is
asserted rather than recited in a comment. A user may own private tags by RLS (`equipment_tags_write`), and
nothing in the app creates them; offering a "something else" text field would put
a user-authored string into a catalogue the planner's candidate join reads, for a
feature nobody asked for.

### 4. One migration, and the first draft of this section said none

**The RLS half needs nothing**, and that was verified rather than assumed:

| Policy                | Migration        | Why it is enough                                                                                                   |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `equipment_tags_read` | `20260824150203` | `for select to authenticated using (user_id is null or user_id = auth.uid())` — the shared rows are readable       |
| `user_equipment_own`  | `20260825071917` | `for all to authenticated`, `user_id = auth.uid()` on **both** `using` and `with check` — own rows, read and write |

**The CHECK half does.** FOUND IN REVIEW: this section concluded "no migration"
from the two policies, and had not looked at the column.
`check (max_load_kg > 0)` does not exclude `NaN` — `'NaN'::numeric > 0` is TRUE,
measured against this project and recorded in `20260908100100` — and it bounds no
magnitude, so `numeric(6, 2)` admits **9,999.99**.

The NaN direction fails closed by luck: `Math.min(NaN, 30)` is `NaN` and
`heaviest <= NaN` is false, so `load_ceiling` raises a finding. 9,999.99 fails
**open** — a real number that simply never binds, which is a ceiling quietly
removed.

`scripts/seed.ts` is the only thing that has ever written this column, and the
picker starts writing it in the same PR, so this is the last moment the
constraint can be tightened without a backfill — the identical argument
`20260909120000` made for the four biometric columns. `20260912140000` adds
`max_load_kg is null or (max_load_kg > 0 and max_load_kg <= 1000)`.

Checked on hosted before writing it: 18 rows, one ceiling (30.00 — Yossi's
dumbbells, the archetype the rule exists for), no NaN, nothing that would
violate. Additive, so it goes to hosted before the merge —
`docs/plans/` records that order.

No table, no column, no RLS change, no `src/db/types.ts` regeneration (a CHECK
moves no column), and no Docker session.

## Consequences

- **A real user can be given a plan for the first time.** Every acceptance
  criterion about the planner has, until now, been provable only against seeded
  data.
- **The seed keeps writing `user_equipment` directly**, with the service role,
  because it creates five users and their rooms before anybody signs in. It is
  not a second writer of a thing the app owns; it is the fixture.
- **A user can save an empty selection**, and that is allowed rather than
  blocked. It is the honest way to say "I have nothing", it is the state every
  non-seeded user is already in, and 8b explains what it costs. Refusing it would
  mean the only way out of the empty state is to claim gear you do not have.
- This ADR does not give equipment a spec. The contract is the two tables and the
  rule that reads them, and a spec restating a CHECK constraint is a second place
  for it to be wrong.
