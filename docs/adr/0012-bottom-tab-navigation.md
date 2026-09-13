# ADR 0012 — Five tabs at the bottom, and what lives behind each

**Status:** accepted, phase 5 — ownership table superseded by [ADR 0013](0013-profile-and-hub.md)
**Date:** 2026-09-05

## Context

`docs/specs/mobile-interface.md` put bottom tab navigation out of scope, and
said exactly when to come back to it:

> Bottom tab navigation, gestures, offline queueing, and installability. There
> are two screens; a tab bar for two screens is furniture. Revisit when phase 4
> adds the achievement wall and phase 3 adds the coach.

Both landed. So did templates. There are now six destinations, and navigation is
a **row of chips repeated in every page header, each page linking to a different
subset of the others**:

| Page         | Links to                   |
| ------------ | -------------------------- |
| `/workouts`  | Progress, Templates, Coach |
| `/progress`  | Training, Coach            |
| `/templates` | Coach, ← Sessions          |
| `/coach`     | ← Sessions                 |

Nothing links to everything. `/coach` is a dead end with one way out.
`/workouts` calls `/progress` "Progress" and `/progress` calls `/workouts`
"Training". A user cannot learn what this app contains by looking at it, and the
chips cost a header row on every screen to fail at it.

## Decision

**A fixed bottom tab bar with five tabs**, on every signed-in screen. Ordered
right to left as the product owner specified them, which is left to right on
screen:

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ History  │  Coach   │   Hub    │ Workout  │ Profile  │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

Bottom, not top, for the reason §0 of the interface spec gives: the thumb is
there, and the other hand is holding a barbell.

### The harder half — what belongs behind each

A tab bar is only worth its 60px if each tab owns something. Today's pages do
not divide cleanly, so they are re-cut:

| Tab         | Route      | Owns                                                         |
| ----------- | ---------- | ------------------------------------------------------------ |
| **History** | `/history` | Past sessions, and nothing else                              |
| **Coach**   | `/coach`   | Unchanged                                                    |
| **Hub**     | `/hub`     | XP, streak, badges, challenges, training load, bests         |
| **Workout** | `/workout` | Templates. Picking one is what starts a session              |
| **Profile** | `/profile` | Who you are and the settings that change how the app behaves |

_Amended 2026-09-13: Workout also logs today as a rest day, the other answer to
"what am I doing today" — [ADR 0034](0034-logging-a-rest-day.md)._

**Every tab is its own route, named after itself.** `/workouts` and
`/templates` were the names those pages happened to grow up with, and a tab bar
makes the mismatch visible: four tabs matched their label and two did not. A
session is `/history/[id]` — the same folder renamed with its parent, because a
session detail belongs to the list it is reached from.

**Hub is also the landing page.** Signing in, or opening the app cold, goes
to `/hub` rather than to the session list. Coming back after two days, the
first question is "where am I up to" — the streak, the XP left this week, what
challenge is running — not "what did I do in March". `/` and the sign-in
redirect both point there.

Three moves fall out of that table:

- **`/progress` is deleted.** Its content is what Hub means. Keeping both would
  give one page two names, which is the disease this ADR is treating.
- **History loses everything that is not history** — the four stat tiles, the
  weekly tonnage chart, the best-e1RM table, "Start workout" and "Sign out" all
  leave. What remains is the session list, at `/history`, with the session
  screen at `/history/[id]` under it.
- **Every per-page chip row is deleted.** That is the entire point.

## Why not

**Keep `/progress` and have Hub link to it.** Then the tab bar has a tab that is
a redirect, and the app still has two names for one page.

**A hamburger or a top bar.** A tap to reveal the taps, at the end of the screen
the thumb cannot reach, on a device held one-handed in a gym.

**Four tabs, folding Profile into Hub.** Settings and rewards have nothing to do
with each other; the only thing they share is that neither is training.

## Consequences

- **`/profile` is the first place any `users` column is editable.** Display
  name, timezone and humor level are written through a Zod-validated server
  action. RLS scopes the update to the caller's own row — CLAUDE.md #10.
- **`unit_preference` is deliberately absent from that form.** The column
  exists and `currentUser()` reads it, but nothing in the app converts anything:
  every screen renders kilograms. A toggle that changes no displayed number is a
  lie the interface spec §4 exists to prevent. It goes in when display
  conversion does.
- **No leaderboard.** "Top player" needs to read other users' XP, which
  invariant #10 forbids without a deliberate exception — a security-definer view
  exposing display name and XP total and nothing else. That is its own decision
  and its own migration, so it is recorded in `docs/PLAN.md` under phase 6
  rather than smuggled in here.
- **Two things now live at the bottom of the session screen.** The pinned rest
  bar (ADR 0011) sits directly above the tab bar rather than under it, and the
  page's bottom padding clears both. Rest stays rank 1; it does not get covered
  by furniture.
- The bar is hidden on `/sign-in`. Tabs that all redirect to the page you are
  already on are not navigation.
- `BadgeReveal` and the session screen's chart icon pointed at `/progress` and
  now point at `/hub`. (`BadgeReveal` moved again with ADR 0013, which took the
  badge shelf to Profile, and again with the Quest Log redesign, whose sheet links
  to the badge's card on `/badges`.)
