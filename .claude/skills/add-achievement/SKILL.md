---
name: add-achievement
description: Add a new achievement to Samson. Use when adding, editing, or removing an achievement, badge, or unlock condition — including calendar-triggered and hidden achievements. Covers the migration, predicate, humor tier, and test that must ship together.
---

# Adding an achievement

Achievements are database rows with SQL predicates, never hardcoded checks.
Adding one is a migration plus a test — no application logic changes. The
rendering code branches on the generic columns (`tier`, `hidden`), never on a
slug, so a new row needs nothing in `src/` or `app/`.

## Steps

### 1. Write the row

Insert into `achievements` via a new migration:

| Column        | Notes                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| `slug`        | stable, lowercase, never reused after release                                          |
| `name`        | the joke or reference. See naming rules below.                                         |
| `description` | shown after unlock                                                                     |
| `predicate`   | SQL boolean over the user's logged data                                                |
| `tier`        | `volume`, `consistency`, `comeback`, `pr`, `recovery`, `variety`, `hidden`, `calendar` |
| `humor_level` | `clean`, `cheeky`, or `crude`                                                          |
| `hidden`      | if true, the definition is withheld until the user earns it — ADR 0017                 |
| `source_hint` | optional playful nod to the reference, shown on the detail screen                      |

### 2. Write the predicate

Predicates run server-side against logged workout data only. They must be:

- **Deterministic** — same data, same result, always
- **Verifiable from logs** — "logged 3 sessions" works, "trained with good
  form" does not
- **Not gameable** — an empty-bar rep spam must not unlock a volume badge.
  Apply the same plausibility checks the challenge validator uses.

For `calendar` tier, evaluate against the **user's local date** derived from
their stored IANA timezone. Never `now()` in server time.

```sql
-- INVARIANT: calendar achievements use the user's local date — see CLAUDE.md #9
-- WHY: New Year's Eve is a different absolute moment per timezone; server-date
--      evaluation silently fires on the wrong day for every non-server user.
```

### 3. Name it

- Twist the reference toward lifting rather than quoting it verbatim. "I Am
  the One Who Lifts" is both funnier and safer than the original line.
- Short phrases are fine. Character art, logos, and trademarked slogans are
  not.
- Set `humor_level` honestly. Anything trading on a body part or sexual
  reading is `crude` and ships behind the opt-in tier — default is `cheeky`.
- Puns do not survive translation. If the strings table gains a locale,
  achievement names need separately authored copy, not machine translation.

### 4. Test it

Every achievement ships with a test in the same commit asserting:

1. It unlocks for a fixture user who meets the condition
2. It does **not** unlock for a near-miss fixture (one rep short, one day off)
3. It fires exactly once — re-running evaluation does not duplicate the event
4. For `calendar` tier: it fires on the correct local date for a fixture user
   in a non-server timezone
5. For `hidden`: the definition is absent from the client payload while it is
   LOCKED, and present for the holder once earned. Both halves — ADR 0017
   narrowed the criterion, and a test for only the first half would pass on a
   version that never showed the badge to anyone.

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
