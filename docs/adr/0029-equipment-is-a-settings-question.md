# ADR 0029 — Equipment is a Settings question, and it carries a ceiling

**Status:** accepted
**Date:** 2026-09-12

> Written before the code it governs, in its own commit.

## Context

`public.user_equipment` has been written by exactly one thing since phase 0:
`scripts/seed.ts`. There is no UI for it anywhere — confirmed by grep across
`app/` and `src/`, and on the hosted project, where the only rows belong to the
five seeded archetypes.

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
The input appears only once an item is selected — seven number boxes nobody needs
is how a form gets abandoned halfway.

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

### 3. The catalogue is read, never written

The picker offers the **shared** tags — `equipment_tags` where `user_id is null`,
twelve of them. A user may own private tags by RLS (`equipment_tags_write`), and
nothing in the app creates them; offering a "something else" text field would put
a user-authored string into a catalogue the planner's candidate join reads, for a
feature nobody asked for.

### 4. No migration

Verified rather than assumed, which is the whole reason this section exists:

| Policy                | Migration        | Why it is enough                                                                                                   |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `equipment_tags_read` | `20260824150203` | `for select to authenticated using (user_id is null or user_id = auth.uid())` — the shared rows are readable       |
| `user_equipment_own`  | `20260825071917` | `for all to authenticated`, `user_id = auth.uid()` on **both** `using` and `with check` — own rows, read and write |

No schema change, no RLS change, no `src/db/types.ts` regeneration, and no Docker
session.

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
