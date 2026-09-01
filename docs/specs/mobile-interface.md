# Specification — the phone-first interface

The four things Lesson 5 requires of an interface specification: the user flow,
the information hierarchy, the interaction model, and the feedback including its
bad states.

FRAMING.md records that none of these were written before the UI was built, and
that the answer to the constraints question was **phone-first, working on the
web too**. What shipped is a 1000px desktop shell with tables. This document is
the missing step, written before the rework rather than reconstructed after it.

---

## 0. The situation being designed for

Not a desk. A gym: standing, one hand, phone in the other, forty seconds of rest
before the next set, sweat on the screen, possibly a locked phone between sets.

Three consequences that drive every decision below:

1. **The primary action must be reachable by a thumb** without re-gripping. That
   means bottom of the screen, not top.
2. **The screen will be locked and reopened mid-session.** Nothing may live only
   in memory.
3. **Reading is expensive, tapping is cheap.** Between sets the user is out of
   breath. A number they have to hunt for is a number they skip.

---

## 1. User flow

```
sign in ──► /workouts ──► [Start workout] ──► /workouts/[id] ──► log set ──┐
                │                                    ▲                     │
                │                                    └─── rest ◄───────────┘
                │                                             │
                └──── tap a past session ──► /workouts/[id]   └──► [Finish]
                                             (read-only)              │
                                                                      ▼
                                                                 /workouts
```

The loop that matters is the inner one: **log set → rest → log set**. It runs
five to thirty times per session and is the only flow that happens under
physical load. Everything else is browsing.

Design consequence: the inner loop gets the bottom of the screen and never
requires scrolling. Browsing can scroll as much as it likes.

## 2. Information hierarchy

Ranked by what the user needs _at the moment they look_. Rank 1 is visible
without scrolling on a 375×812 screen; rank 3 may be below the fold.

### During a session — `/workouts/[id]`

| Rank | What                                   | Why                                                                |
| ---- | -------------------------------------- | ------------------------------------------------------------------ |
| 1    | **Rest remaining**                     | The only thing that is time-critical. It decides when to stand up. |
| 1    | **Log set** — the action               | The reason the screen is open.                                     |
| 2    | Weight, reps for the set being entered | Filled every single time.                                          |
| 2    | Which exercise is selected             | Changes rarely; must be confirmable at a glance.                   |
| 3    | RPE, rest length, warm-up flag         | Optional or defaulted.                                             |
| 3    | Sets already logged                    | Reference, consulted between exercises rather than between sets.   |
| 4    | Session elapsed time, tonnage, finish  | End-of-session concerns.                                           |

### Browsing — `/workouts`

| Rank | What                                                  |
| ---- | ----------------------------------------------------- |
| 1    | Start workout                                         |
| 2    | Adherence, streak — the retention numbers, per PRD §3 |
| 3    | This week's tonnage, acute:chronic                    |
| 4    | Weekly tonnage chart, best e1RM, session history      |

**A consequence worth stating:** the four stat tiles are currently equal in
weight. They are not equal in rank. Adherence and streak are the mechanic the
product retains people with (invariant #4); tonnage and ACWR are diagnostics.

## 3. Interaction model

**Sizes.** Every interactive target is at least **44×44 px**. A visually smaller
control gets its target from padding or a pseudo-element, not from shrinking the
hit area. This currently fails in three places: buttons are ~37 px tall, chips
~31 px, and the "?" hint is **16×16 px**.

**Text inputs are 16 px minimum.** Below that, iOS Safari zooms the viewport on
focus and does not zoom back. This is not a preference; it is the difference
between a usable and an unusable form on an iPhone.

**Numeric fields declare their keyboard.** `inputMode="decimal"` for weight and
RPE, `inputMode="numeric"` for reps and rest. Already correct; must stay.

**The set form is thumb-ordered**, not desk-ordered: exercise, then weight and
reps side by side (the two always filled), then RPE and rest side by side, then
the warm-up toggle, then the action. Weight and reps share a row because they
are entered as a pair and the keyboard covers half the screen anyway.

**Rest starts on its own** when a set is logged. Reaching for a second button is
the step people skip when out of breath. Already true; must stay.

**The exercise stays selected** after logging. The next set is almost always the
same lift.

**Breakpoints are `min-width`, not `max-width`.** Phone is the base stylesheet;
wider screens are the enhancement. A `max-width` override is a desktop design
apologising, and it is how the current sheet is written.

**Safe areas are respected.** Bottom-anchored content clears
`env(safe-area-inset-bottom)` so it is not under the home indicator.

**Tables become cards below 760 px.** Seven columns of `white-space: nowrap`
cannot be made to fit 375 px, and horizontal page scroll is the single most
common phone-layout failure. Each row becomes a card with its column name as a
label.

## 4. Feedback, and its bad states

Every state below must render something. "Nothing happens" is the failure this
section exists to prevent.

| State                         | What the user sees                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Set logging**               | The button reads "Logging…" and is disabled. It does not vanish or move.                                                               |
| **Set logged**                | The rest timer starts counting immediately — that _is_ the confirmation, and it is the thing they need next.                           |
| **Rest finished**             | The timer turns green and a cue fires. Isolated behind one call site for phase 3 to replace with a persona clip.                       |
| **No exercise picked**        | "Pick an exercise first." Inline, next to the action, not at the top of a scrolled page.                                               |
| **Log failed**                | The server's message, inline, and **the form keeps its values**. Retyping a weight while out of breath is the worst possible recovery. |
| **Search matches nothing**    | "Nothing matches. Only equipment you own is listed." — names the reason, since an empty list otherwise reads as a broken app.          |
| **User owns no equipment**    | Explains that no equipment is recorded and what fixes it. Never an empty picker with no explanation.                                   |
| **No sets logged yet**        | "Nothing logged yet." rather than an empty table with headers.                                                                         |
| **Metric not yet computable** | An em dash plus what is missing — "12/28 days of history". A blank is honest; a zero is a claim.                                       |
| **e1RM above 12 reps**        | Blank, per the Epley cutoff. The hint explains why.                                                                                    |
| **Offline / request fails**   | The inline error path above. There is no optimistic write: a set that did not save must never look saved.                              |

**The rule behind the table:** the app never says a number it has not computed,
and never implies success it has not had. Both are invariant #1 seen from the
user's side.

---

## Out of scope for this rework

Bottom tab navigation, gestures, offline queueing, and installability. There are
two screens; a tab bar for two screens is furniture. Revisit when phase 4 adds
the achievement wall and phase 3 adds the coach.

**AI-NOTE:** this document is the contract for `app/globals.css` and the two
workout screens. If a change makes one of the ranked-1 items require scrolling
on a 375×812 viewport, the change is wrong, not the ranking.
