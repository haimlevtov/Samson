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
sign in ──► /hub ──► /workout ──► [pick a template] ──► /history/[id] ──┐
              │                                               ▲         │
              │                                               └─ rest ◄─┘
              │                                                     │
              └──► /history ──► tap a past session ──► /history/[id] │
                                                       (read-only)   │
                                                                     ▼
                                                        [Finish] ──► /history
```

The loop that matters is the inner one: **log set → rest → log set**. It runs
five to thirty times per session and is the only flow that happens under
physical load. Everything else is browsing.

Design consequence: the inner loop gets the bottom of the screen and never
requires scrolling. Browsing can scroll as much as it likes.

## 2. Information hierarchy

Ranked by what the user needs _at the moment they look_. Rank 1 is visible
without scrolling on a 375×812 screen; rank 3 may be below the fold.

### During a session — `/history/[id]`

| Rank | What                                   | Why                                                                |
| ---- | -------------------------------------- | ------------------------------------------------------------------ |
| 1    | **Rest remaining**                     | The only thing that is time-critical. It decides when to stand up. |
| 1    | **Log set** — the action               | The reason the screen is open.                                     |
| 2    | Weight, reps for the set being entered | Filled every single time.                                          |
| 2    | **What was lifted last time**          | The number the next set is chosen from. Nobody invents a load.     |
| 2    | Which exercise the row belongs to      | Changes rarely; must be confirmable at a glance.                   |
| 3    | RPE, rest length, warm-up flag         | Optional or defaulted.                                             |
| 3    | Sets already performed                 | Reference, consulted between exercises rather than between sets.   |
| 4    | Session elapsed time, tonnage, finish  | End-of-session concerns.                                           |

### Browsing

ADR 0012 split this across three tabs, because one page ranked "start a session"
against "how did last month go" and could only lose.

**Workout — `/workout`**

| Rank | What                                                 |
| ---- | ---------------------------------------------------- |
| 1    | The templates — picking one is what starts a session |
| 2    | Starting an empty session instead                    |
| 3    | Building or importing a template                     |

**Hub — `/hub`**

| Rank | What                                                  |
| ---- | ----------------------------------------------------- |
| 1    | Adherence, streak — the retention numbers, per PRD §3 |
| 2    | XP this week against the ceiling                      |
| 3    | Badges, challenges                                    |
| 4    | Tonnage, acute:chronic, weekly chart, best e1RM       |

**A consequence worth stating:** the stat tiles are equal in weight and are not
equal in rank. Adherence and streak are the mechanic the product retains people
with (invariant #4); tonnage and ACWR are diagnostics, and they sort below the
game.

**History — `/history`** is the session list and nothing else. It is rank 3
browsing by definition: nobody opens it under load.

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

**The session is a set grid, one per exercise** — ADR 0011. A row is either
_pending_ (editable kg and reps, empty tick) or _performed_ (values as text,
green ground, filled tick). **Ticking a pending row is the write.** The two
states are the same row in the same place, so what you are about to do and what
you did look alike.

**Columns are `SET · PREVIOUS · KG · REPS · ✓`**, in that order. Weight and reps
are adjacent because they are entered as a pair and the keyboard covers half the
screen anyway. `PREVIOUS` is last session’s set of the same kind — warm-ups
against warm-ups, working sets against working sets — and tapping it copies
those numbers into the row.

**Rank 3 hides behind the row.** RPE, warm-up and rest length appear when the
set number is tapped. They are optional or defaulted, and putting them in
columns would cost the rank-2 pair its single glance.

**Rest starts on its own** when a set is ticked. Reaching for a second button is
the step people skip when out of breath. Already true; must stay.

**The running rest bar is pinned to the bottom of the viewport**, above the safe
area. It is rank 1; an inline bar scrolls away as soon as the grid is longer
than the screen. Static rest lengths between performed rows stay inline.

**Pending rows survive a locked phone.** They are not `sets` rows — ADR 0010
forbids that — so they are written to `localStorage` under the workout id. §0
point 2 is the whole reason.

**Breakpoints are `min-width`, not `max-width`.** Phone is the base stylesheet;
wider screens are the enhancement. A `max-width` override is a desktop design
apologising, and it is how the current sheet is written.

**Navigation is five fixed tabs at the bottom** — ADR 0012 — left to right:
History, Coach, Hub, Workout, Profile. Bottom because that is where the thumb
is, per §0. Each tab is a full-height target with an icon and a word; the icon
alone is a guessing game and the word alone is hard to hit. The current tab is
marked with `aria-current="page"` as well as with colour. No page carries its
own navigation chips any more.

**Two things live at the bottom of the session screen.** The running rest bar
sits directly above the tab bar, never under it, and the page's bottom padding
clears both. Rest is rank 1; furniture does not get to cover it.

**Safe areas are respected.** Bottom-anchored content clears
`env(safe-area-inset-bottom)` so it is not under the home indicator. The tab
bar is the thing that does this now.

**Tables become cards below 760 px.** Seven columns of `white-space: nowrap`
cannot be made to fit 375 px, and horizontal page scroll is the single most
common phone-layout failure. Each row becomes a card with its column name as a
label. The set grid is exempt: it is five columns, sized to fit 375 px as a
grid, and turning a set into a card would destroy the column alignment that
makes a session readable at a glance.

## 4. Feedback, and its bad states

Every state below must render something. "Nothing happens" is the failure this
section exists to prevent.

| State                         | What the user sees                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Set logging**               | The row's tick shows a pending mark and the row is locked. It does not vanish or move.                                                  |
| **Set logged**                | The row turns green with a filled tick, and the rest timer starts counting — that _is_ the confirmation, and it is what they need next. |
| **Set un-ticked**             | The `sets` row is deleted and its values return to a pending row. A mis-tap never costs a retyped weight.                               |
| **No previous session**       | An em dash in `PREVIOUS`. A blank column reads as a broken lookup; a zero would be a claim.                                             |
| **Rest finished**             | The timer turns green and a cue fires. Isolated behind one call site for phase 3 to replace with a persona clip.                        |
| **Nothing added yet**         | "No exercises yet." plus the add control. Never an empty grid with headers.                                                             |
| **Log failed**                | The server's message, inline, and **the form keeps its values**. Retyping a weight while out of breath is the worst possible recovery.  |
| **Search matches nothing**    | "Nothing matches. Only equipment you own is listed." — names the reason, since an empty list otherwise reads as a broken app.           |
| **User owns no equipment**    | Explains that no equipment is recorded and what fixes it. Never an empty picker with no explanation.                                    |
| **Row ticked while empty**    | "Fill in reps first." on the row. Nothing is written; a zero-rep set is not a set.                                                      |
| **Metric not yet computable** | An em dash plus what is missing — "12/28 days of history". A blank is honest; a zero is a claim.                                        |
| **e1RM above 12 reps**        | Blank, per the Epley cutoff. The hint explains why.                                                                                     |
| **Offline / request fails**   | The inline error path above. There is no optimistic write: a set that did not save must never look saved.                               |

**The rule behind the table:** the app never says a number it has not computed,
and never implies success it has not had. Both are invariant #1 seen from the
user's side.

---

## Out of scope for this rework

Gestures, offline queueing, and installability.

**Bottom tab navigation was here, and has been built** — ADR 0012. The condition
this section set was "revisit when phase 4 adds the achievement wall and phase 3
adds the coach". Both landed, and templates with them. Five destinations is not
two, and the row of chips each header carried linked to a different subset of
the others.

**AI-NOTE:** this document is the contract for `app/globals.css` and the two
workout screens. If a change makes one of the ranked-1 items require scrolling
on a 375×812 viewport, the change is wrong, not the ranking.
