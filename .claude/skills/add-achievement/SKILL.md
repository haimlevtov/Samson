---
name: add-achievement
description: Add a new achievement to Samson. Use when adding, editing, or removing an achievement, badge, or unlock condition — including calendar-triggered and hidden achievements. Covers the migration, predicate, humor tier, and test that must ship together.
---

# Adding an achievement

Achievements are database rows with SQL predicates, never hardcoded checks.
Adding one is a migration plus a test — no application logic changes.

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
| `hidden`      | if true, the definition is never sent to the client                                    |
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
5. For `hidden`: the definition is absent from the client payload

Use the seeder's synthetic users where one fits; add a fixture only if none
does.

### 5. Verify

```bash
npm run migrate && npm test -- achievements
```

## Do not

- Generate achievement names at runtime. They are authored once and stored.
- Add application code. If an achievement needs new logic, the predicate model
  is wrong — raise it rather than working around it.
- Grant an unlock from the client under any circumstances.
- Reuse a released `slug` for different criteria. Users already hold it.
