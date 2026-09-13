# ADR 0034 — A rest day is logged on the Workout tab, for today only

**Status:** accepted
**Date:** 2026-09-13

> Written before the code it governs, in its own commit.

## Context

`rest` has been a first-class workout status since migration 0003, "because a
scheduled rest day maintains a streak". Everything downstream already honours it:

- `award_session_xp` pays a rest day exactly what a training day earns at the
  same position in the week (migration `20260902100000`), and evaluates
  achievements on it (`20260902100100`).
- `adherence()` and `currentStreak()` in `src/metrics/adherence.ts` count it as
  kept.
- Five achievement predicates count it. `ten-rest-days` counts nothing else;
  `first-full-week`, `twenty-of-twenty-eight`, `new-years-day` and `one-year-on`
  accept `rest` or `completed`.

**Nothing in the application writes it.** Only `scripts/seed.ts` does.
`20260902100000` said so at the time, and left it deliberately: "giving the user a
way to log a rest day is a UI decision for the phase that adds it". No phase
added it. So a real user can never earn `ten-rest-days`, and the rest-day half
of the other four is out of reach. The badge catalogue made the gap visible when
it started showing `how_to_earn` ([ADR 0017](0017-held-hidden-achievements.md)'s
2026-09-12 amendment). That card says "Take ten rest days as planned" and there
is no way to do it.

Three facts shape the decision.

1. **The app has no schedule.** An accepted plan is weeks of sessions, not
   sessions pinned to dates. "Planned rest" (PRD promise 2, the XP spec's first
   consequence) therefore cannot be derived from anything. A rest day exists
   because the user says today is one. That is the same trust a finished session
   already carries: the app believes the user trained because they pressed
   Finish.
2. **`workouts_own` is `for all`.** Any signed-in session can already insert a
   workout with any status on any date through the API. ADR 0009 does not try to
   stop a user writing their own log. It stops the log from paying more than the
   rules allow: the award is a definer function, and the weekly ceiling is a
   trigger.
3. **A rest day costs nothing to log.** A session at least has to be started
   and finished. A rest button that could be pressed ten times would earn the
   badge in a minute and walk the week down the XP curve to its ceiling.

## Decision

### 1. On the Workout tab, beside "Start an empty workout"

The Workout tab answers "what am I doing today". Picking a template starts a
session (ADR 0012), and starting an empty one is rank 2 in
`docs/specs/mobile-interface.md` §2. **Resting is the other answer to the same
question**, so it sits in Quick start as a secondary button, **Rest today**.

- **Not History.** ADR 0012 gives History "past sessions, and nothing else", and
  it is rank 3 browsing: nobody opens it to decide what to do. It is also a list
  of dates, so a write there would invite a date field, and backdating is what
  §2 below rules out.
- **Not Hub.** ADR 0013 made Hub about other people.
- **Not Profile.** Profile shows the streak a rest day keeps. It shows what you
  have earned; it is not where you do the thing that earns it.
- **Not while a session is running.** The spec gives that whole section to
  Resume, and Rest today follows Start out of it for the same reason.

### 2. Today only, in the user's local date

The server action takes **no date**. It computes `localDateFor(users.timezone)`
itself (CLAUDE.md #9), the same way `startWorkout` does. A rest day for a past
date is a claim nobody can check, and it would put `ten-rest-days` and the
calendar badges one form away. Pressing at 00:05 logs the new day, because that
is the day it is where the user lives.

### 3. One rest day a day, and the database says so

A partial unique index: `(user_id, local_date) where status = 'rest'`.

- **Why the database and not the action.** The action reads, then writes, so a
  double press races it. The API skips the action entirely. Without the index,
  ten presses are ten rest days, which is §3 of the context.
- **A duplicate is not an error to the user.** The action treats the unique
  violation as "today is already a rest day" and lands on that day's receipt.

### 4. Not on a day that already has a session

If today has a `completed` or `in_progress` workout, the action refuses, and the
tab says why in place of the button: a day you trained is not a day off.

**The reverse is allowed.** Starting a session on a day already logged as rest
is the plan changing, and the rest day stays. The ledger is append-only, and a
reward it has paid is not taken back. The cost is bounded: §3 allows one rest row
that day, the weekly ceiling bounds the XP, and a streak — which counts rows —
gains one, exactly as it does for two sessions in a day today.

**This rule lives in the action, not the database.** The API can already write a
`completed` row beside anything, so a constraint here would guard a door that
stands open next to it. It is the same self-reported log ADR 0009 bounds rather
than polices.

### 5. The write goes through RLS, and the award through `award_session_xp`

The action runs on the request-scoped client. `user_id` comes from the verified
session; `status` is `'rest'`; `started_at`, `ended_at` and `notes` stay null.
Then it calls `awardSessionXp(db, id)`: the same definer path `finishWorkout`
uses, which takes a workout id and nothing else (ADR 0009 §1). **No new RPC, no
insert into `xp_events`.** The award already pays rest and already evaluates
achievements.

An award that fails is logged by name and bounded message
([ADR 0028](0028-what-a-failure-may-say.md)) and not thrown. The day is saved,
exactly as `finishWorkout` reasons it.

### 6. It lands on the receipt, where a badge fires

`/history/[id]/kept` (the Quest Log's finish moment) takes a `rest` workout as
well as a `completed` one. It says **"Rest day kept"**, shows what the day earned
and the week against its cap, and drops "Review the session", since there is no
session to review. `?unlocked=` fires a badge there as it does for sessions, so
the tenth rest day shows `ten-rest-days` on the screen it lands on. Which
statuses get a receipt, and what it is titled, is a tested helper in
`src/ui/finish.ts`.

### 7. No undo, on purpose

A mistaken press logs a rest day, and §4 still lets the user train that day.
Deleting the row is not offered. If it were, `xp_events.workout_id` is `on delete
cascade`, so the XP would go with it and pressing again would pay once more, not
twice. That makes an undo safe to add later. It is left out now because nothing
asked for it.

### 8. The catalogue says where

`ten-rest-days`'s `how_to_earn` names the button. A card that says how to earn a
badge, and only now can be followed, should also say where.

## What this does not guarantee

- **That a rest day was planned.** There is no schedule to check it against
  (context §1). It is the user's word, as a finished session is.
- **That the API follows §2 or §4.** A session can still insert a rest row for
  another date, or beside a session. §3 still holds there, and so do the award's
  ceiling and its one-award-per-workout index.

## Consequences

- `20260902100000`'s note that nothing in the application creates a `rest`
  workout is no longer true. Migrations are history, so this ADR is where that
  is recorded.
- ADR 0012's Workout row gains the rest day. `docs/specs/mobile-interface.md`
  gains it in the Workout ranking and three states in §4. The PRD's rewards
  section says where a rest day comes from.
- **Tests.**
  - `tests/db/rest-days.test.ts`, through the user's own client:
    - a rest day inserts under RLS and not for someone else;
    - it awards once however often the award runs;
    - a second rest row that day is refused;
    - the tenth rest day unlocks `ten-rest-days`;
    - a session on a rest day is still allowed.
  - Unit tests for the tab's decision and the receipt's title.
- `src/db/types.ts` does not change: an index and a content update add no column
  and no function.
