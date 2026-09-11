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

**Hub — `/hub`** — ADR 0013 moved everything personal off this tab.

| Rank | What                                           |
| ---- | ---------------------------------------------- |
| 1    | Challenges you can accept or are part-way into |
| 2    | The leaderboard — ADR 0016                     |
| 3    | Challenges the validator declined, and why     |

**Profile — `/profile`**

| Rank | What                                                                          |
| ---- | ----------------------------------------------------------------------------- |
| 1    | Level, and progress into the next one                                         |
| 2    | Streak and adherence — the retention numbers, per PRD §3                      |
| 3    | XP this week against the ceiling                                              |
| 4    | Badges, and the link into the progression trees                               |
| 5    | Tonnage and what it weighs as much as, acute:chronic, weekly chart, best e1RM |
| 6    | — (settings moved to `/settings`; the cog is in the header)                   |

**A consequence worth stating:** the stat tiles are equal in weight and are not
equal in rank. Streak and adherence are the mechanic the product retains people
with (invariant #4); tonnage and ACWR are diagnostics, and they sort below the
game.

**WHY level outranks the retention numbers**, when invariant #4 says adherence
is the mechanic: the level is a _summary_ of them. It is read from lifetime XP,
which comes from adherence and nothing else, so putting it first states the
conclusion before the workings rather than competing with them.

**WHY settings are not on this page at all.** They were the whole of Profile
before ADR 0013, then a disclosure at the foot of it, and are now their own
route — ADR 0013's amendment of 2026-09-07. The ranking argument is what drove
them off the page: a setting is changed a handful of times in the life of an
account and the things above it are looked at weekly, so ranking last put the
control below a screen and a half of content. Something ranked that low does
not want a lower slot; it wants a door.

**The cog is in the header, and it is the only one.** `/settings` is not in the
tab bar — five is the budget ADR 0012 set — so deleting that link orphans the
page without breaking a build. `tests/unit/invariants.test.ts` asserts every
route in `OWNED_BY` is linked from somewhere under `app/`.

**Disclosures.** Where a section is demoted rather than deleted — the coach's
accepted plan, the session quick-log — it goes behind a native `<details>`, not
a modal or a client-state accordion. It stays keyboard and screen-reader
navigable with no work, needs no client component on a page that is otherwise
server-rendered, and with CSS off it degrades to an open section rather than a
control that does nothing.

**A disclosure reveals more of what the page is already about.** A different
subject gets a route instead — that is the line ADR 0013's amendment drew when
settings stopped being a disclosure and became `/settings`.

Two rules come with it, and both are easy to lose:

- **The summary is a full tap target** (`min-height: var(--tap)`).
- **Removing `list-style` removes the focus indicator's box.** A summary with
  its marker suppressed must set its own `:focus-visible` outline, or keyboard
  focus lands somewhere invisible.

**History — `/history`** is the session list and nothing else. It is rank 3
browsing by definition: nobody opens it under load.

**One session at a time, and it is not history until it is finished.** A
workout is something you are in the middle of, and there is no being in the
middle of two. Both start actions — empty and from a template — resume the
running session rather than opening a second, and that session is left out of
History until `finishWorkout` resolves it.

**"Running" is a recency window, not a date.** A session counts as live while it
is `in_progress` and was started within `ACTIVE_SESSION_WINDOW_HOURS` (12).
This was originally "started today", which broke at midnight: a session begun at
23:55 stopped being live at 00:00 while the user was still logging into it, so
Start reappeared and a tap created the second row this rule exists to prevent.
The window is compared against a UTC instant and does not touch CLAUDE.md #9 —
`local_date` is still the write-time truth for every calendar question.

**Every route in offers Resume instead of Start while one is running**, and
there are three: Quick start, each template card, and the template detail page.
A "Start" that redirects into a different session is the app lying about what it
did — the actions redirect rather than insert, so the label has to follow.

A session left unfinished beyond that window is not live. It appears in History
with its `in progress` badge, where it can be opened and finished, because the
alternative is a row that exists and is reachable from nowhere.

## 3. Interaction model

**State is never carried by colour alone.** Anywhere a row, chip or control
means something by being a different colour — the reader's own leaderboard row,
a performed set, the current tab — a word or an icon carries the same meaning.
Colour is the fast path for people who can use it, never the only path.

**Sizes.** Every interactive target is at least **44×44 px**. A visually smaller
control gets its target from padding or a pseudo-element, not from shrinking the
hit area. This currently fails in two places: buttons are ~37 px tall and chips
~31 px.

_The "?" hint used to be listed here as 16×16 px. It is 20×20 with a 44 px
`::after` — the remedy this paragraph prescribes — and the sentence outlived the
fix. Corrected 2026-09-09._

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

**A `max-width` PROPERTY inside a `min-width` query is not the same thing, and
some content needs one.** The rule above is about breakpoints: the phone layout
must not be a desktop layout with overrides. Capping how wide a single element
grows on a large screen is the opposite — it is the phone design refusing to be
stretched. The sheet already does it for `.shell` (1000px) and the set grid
(620px), and 2026-09-10 added the progression chart at 560px: an SVG scales with
its viewBox and the HTML figures over it do not, so past that width a 6-unit dot
outgrows the label beside it and the sparkline reads as a poster with captions.

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
label.

**Two things are exempt, and the test for an exemption is the same both times:**
the table is narrow enough to fit 375 px, and it is read DOWN a column rather
than across a row, so card-stacking would destroy the one property it has.

- **The set grid** — five columns, sized to fit as a grid. Turning a set into a
  card destroys the alignment that makes a session readable at a glance.
- **The leaderboard** — three columns, and a ranking is read down its rank and
  level columns. Card-stacking turned five lifters into fifteen rows. (It was
  the XP column until 2026-09-09; the argument is about reading a number down a
  column, not about which number.)

Anything else becomes cards. A new exemption is argued here, in this list, not
in a comment beside the table — a rule whose exceptions live in code comments
has stopped being a rule.

**The page body never scrolls horizontally, and not only because of tables.**
The rule above was written about wide content, and read narrowly it let a
different failure through: a popover anchored to a control near the right of the
screen. Opening the "Adherence" hint on `/profile` at 375 px took
`scrollWidth` to 418 — 43 px of sideways scroll, from an element with no width
problem at all.

So the rule generalises: **anything floating above the page — a popover, a
menu, a picker — is clamped into the viewport rather than trusted to fit.**
CSS cannot express it, because an absolutely positioned box cannot know its own
distance from the screen edge; the measurement is
[ADR 0022](../adr/0022-popover-clamping.md), and
`src/ui/hint-position.ts` is the one implementation to reuse.

## 4. Feedback, and its bad states

Every state below must render something. "Nothing happens" is the failure this
section exists to prevent.

| State                         | What the user sees                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Set logging**               | The row's tick shows a pending mark and the row is locked. It does not vanish or move.                                                  |
| **Set logged**                | The row turns green with a filled tick, and the rest timer starts counting — that _is_ the confirmation, and it is what they need next. |
| **Set un-ticked**             | The `sets` row is deleted and its values return to a pending row. A mis-tap never costs a retyped weight.                               |
| **Start pressed mid-session** | The session already running opens, rather than a second one. Nothing is created and nothing logged is orphaned.                         |
| **No previous session**       | An em dash in `PREVIOUS`. A blank column reads as a broken lookup; a zero would be a claim.                                             |
| **Rest finished**             | The timer turns green and a cue fires. Isolated behind one call site for phase 3 to replace with a persona clip.                        |
| **Nothing added yet**         | "No exercises yet." plus the add control. Never an empty grid with headers.                                                             |
| **Log failed**                | The server's message, inline, and **the form keeps its values**. Retyping a weight while out of breath is the worst possible recovery.  |
| **Search matches nothing**    | "Nothing matches. Only equipment you own is listed." — names the reason, since an empty list otherwise reads as a broken app.           |
| **User owns no equipment**    | Explains that no equipment is recorded and what fixes it. Never an empty picker with no explanation.                                    |
| **Row ticked while empty**    | "Fill in reps first." on the row. Nothing is written; a zero-rep set is not a set.                                                      |
| **Metric not yet computable** | An em dash plus what is missing — "12/28 days of history". A blank is honest; a zero is a claim.                                        |
| **Nothing lifted this week**  | `0 kg`, not a dash. The week's tonnage is computed and it is zero — a true claim, so the row above does not apply.                      |
| **No loaded sets yet**        | "Nothing to chart yet" and why: warm-ups and bodyweight count as zero. "No sets logged" is false for a bodyweight lifter.               |
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
