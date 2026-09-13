---
name: add-achievement
description: Add a new achievement to Samson. Use when adding, editing, or removing an achievement, badge, or unlock condition — including calendar-triggered and hidden achievements. Covers the migration, predicate, humor tier, and test that must ship together.
---

# Adding an achievement

Achievements are database rows with SQL predicates, never hardcoded checks.
Adding one is a migration plus a test — no application logic changes. The
rendering code branches on the generic columns (`tier`, `hidden`, and — on
`/badges` and Profile's badge shelf — `humor_level`), and on a slug only to pick
an icon, with a default, so a new row needs nothing in `src/` or `app/`.

**Two optional touches since the Quest Log redesign** (ADR 0033 §3), both in
`src/ui/tiers.ts`: a badge draws a `medal` unless it has an icon there, keyed by
slug — add one if the badge deserves it. A new **tier** is not optional: it needs
a metal in the same file, and `src/ui/tiers.test.ts` fails until it has one.

## Steps

### 1. Write the row

Insert into `achievements` via a new migration:

| Column        | Notes                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| `slug`        | stable, lowercase, never reused after release                                          |
| `name`        | the joke or reference. See naming rules below.                                         |
| `description` | shown after unlock — the reward copy, written to the person who holds it               |
| `how_to_earn` | **required.** What to do to earn it, for somebody who does not — see §2b               |
| `predicate`   | SQL boolean over the user's logged data                                                |
| `tier`        | `volume`, `consistency`, `comeback`, `pr`, `recovery`, `variety`, `hidden`, `calendar` |
| `humor_level` | `clean`, `cheeky`, or `crude`                                                          |
| `hidden`      | if true, the definition is withheld until the user earns it — ADR 0017                 |
| `source_hint` | optional playful nod to the reference, shown on an earned card on /badges              |

### 2. Write the predicate

Predicates run server-side against logged workout data only. They must be:

- **Deterministic** — same data, same result, always
- **Verifiable from logs** — "logged 3 sessions" works, "trained with good
  form" does not
- **Not gameable** — an empty-bar rep spam must not unlock a volume badge.
  Apply the same plausibility checks the challenge validator uses.

For `calendar` tier, evaluate against the **user's local date** derived from
their stored IANA timezone. Never `now()` in server time.

**Any predicate that needs training ORDER — "the first set", "the nth session",
"since they started" — orders by `workouts.local_date`, never `sets.created_at`.**
That column defaults to `now()`, which is transaction time: a bulk write gives
every row in it one identical value, so it does not merely tie, it can be
constant across a user's whole history. `workout_id` is a random uuid and settles
nothing either. `twenty-percent-up` got this wrong twice and awarded a badge on a
coin toss both times — [ADR 0021](../../../docs/adr/0021-training-order-is-local-date.md).

A predicate that joins ANY table a user can own rows in — `workouts`,
`exercises`, anything with a `user_id` — must filter that table as well, not
just the table it starts from, `sets` or `workouts`. `user_id = $1` on that
first table is not enough: `evaluate_achievements` is `security definer`, so
the join sees every user's rows. It has happened twice: `workouts` (migration `20260908140000`) and
`exercises` (`20260911100000`, the `five-patterns` predicate). For a table that
also holds shared catalogue rows the filter is
`(e.user_id is null or e.user_id = $1)`.

```sql
-- INVARIANT: calendar achievements use the user's local date — see CLAUDE.md #9
-- WHY: New Year's Eve is a different absolute moment per timezone; server-date
--      evaluation silently fires on the wrong day for every non-server user.
```

### 2b. Write how to earn it

`/badges` lists every visible badge a user does not hold, and what it shows
under the name is `how_to_earn` — ADR 0017's 2026-09-12 amendment. It is
**required on every shared row** by `achievements_shared_rows_say_how_to_earn`,
so a migration that omits it fails when it is applied.

**It is not the description reworded.** `description` is past tense and written
to someone who has the badge. `how_to_earn` is an instruction to someone who
does not, and it must be **true to the predicate, not to the name**. When this
column was first filled, two of the eleven descriptions were not the condition:
`hundred-tonnes` never mentioned its thirty logged days, and `new-years-day`
said "trained" when a planned rest day earns it too.

Read the predicate, then write what it checks in words a lifter uses: the
window, whether rest days count, whether warm-ups count, and any minimum the
predicate enforces that the name does not suggest. Leave out the plausibility
limits — they are a guard, not a goal.

**Changing a predicate means changing its `how_to_earn` in the same
migration.** Nothing can test prose against SQL, so this is the one step where
the only check is you.

A hidden badge's `how_to_earn` never reaches anybody. While the badge is
locked it is a column on a row the policy withholds; once it is earned the
holder gets its name and description through `unlocked_achievements()`, which
does not return `how_to_earn` — by then it would be telling somebody how to do
what they have done. So write it as freely as any other, and do not widen that
function to carry it.

### 3. Name it

- Twist the reference toward lifting rather than quoting it verbatim. "I Am
  the One Who Lifts" is both funnier and safer than the original line.
- Short phrases are fine. Character art, logos, and trademarked slogans are
  not.
- Set `humor_level` honestly. Anything trading on a body part or sexual
  reading is `crude` and ships behind the opt-in tier — default is `cheeky`.
  It is a gate, not a label: `/badges` does not list an UNEARNED badge above
  the user's humour setting, and counts it instead.
- Puns do not survive translation. If the strings table gains a locale,
  achievement names need separately authored copy, not machine translation.

### 4. Test it

Every achievement ships with a test in the same commit asserting:

1. It unlocks for a fixture user who meets the condition
2. It does **not** unlock for a near-miss fixture (one rep short, one day off)
3. It fires exactly once — re-running evaluation does not duplicate the event
4. For `calendar` tier: it fires on the correct local date for a fixture user
   in a non-server timezone
5. For `hidden`: the definition — name, description and `how_to_earn` — is
   absent from the client payload while it is LOCKED, and the name and
   description are present for the holder once earned (`how_to_earn` stays
   absent; see §2b). Both halves — ADR 0017 narrowed the criterion, and a test
   for only the first half would pass on a version that never showed the badge
   to anyone.
6. If the predicate joins a table a user can own rows in: a row of theirs
   pointing at ANOTHER user's row does not count, and one pointing at their
   own does.
   Write the cross-user row with the admin client — the write policies refuse
   it now, which is the point, so it stands for a row written before they did.
   The `five-patterns` case in `tests/db/achievements.test.ts` is the pattern.

Use the seeder's synthetic users where one fits; add a fixture only if none
does.

### 5. Verify

```bash
npm run migrate && npm run test:db
```

## Do not

- Generate achievement names at runtime. They are authored once and stored.
- Add application code. If an achievement needs new logic, the predicate model
  is wrong — raise it rather than working around it.
- Grant an unlock from the client under any circumstances.
- Reuse a released `slug` for different criteria. Users already hold it.

## Two costs that only appear in bulk

Adding one achievement is free. Adding forty is not, and neither limit is
visible from a single migration.

**`evaluate_achievements` runs every unheld predicate on every completion.**
Migration 20260908090200 made it skip achievements the user already holds, so
the cost is proportional to what is still to earn rather than to how many exist
— but a large content fill still means a large number of full-history scans on
the session-completion path. Write predicates that can short-circuit (`exists`
beats `count(*) >= n`) and that lead with `user_id`.

**There is a ceiling at 64.** Each predicate is evaluated inside its own plpgsql
`begin ... exception` block, which is a subtransaction, and Postgres degrades
sharply past 64 subtransactions in one transaction (PGPROC subxid cache
overflow). With eleven system achievements there is headroom for roughly forty
more. Past that, the loop needs restructuring rather than one more row.
