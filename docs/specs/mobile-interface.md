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
sign in ──► /welcome (first visit only) ──► /hub ──► /workout ──► [pick a template] ──► /history/[id] ──┐
              │                                               ▲         │
              │                                               └─ rest ◄─┘
              │                                                     │
              └──► /history ──► tap a past session ──► /history/[id] │
                                                       (read-only)   │
                                                                     ▼
                                          [Finish] ──► /history/[id]/kept ──► /history
```

The loop that matters is the inner one: **log set → rest → log set**. It runs
five to thirty times per session and is the only flow that happens under
physical load. Everything else is browsing.

Design consequence: the inner loop gets the bottom of the screen and never
requires scrolling. Browsing can scroll as much as it likes.

**Finishing lands on a receipt before History** — the Quest Log redesign, PR 4. `/history/[id]/kept` shows what the session earned — its own ledger rows — and that week against its cap, then the streak and accepted quests as of now. **A badge fires here**, on the screen the user lands on, as it always has; Done and Review the session both leave without losing it. It reads the SESSION's week — the one the award paid into — so a session begun before midnight and finished after it, or a loose end finished days later, still gets its receipt and its badge.

## 2. Information hierarchy

Ranked by what the user needs _at the moment they look_. Rank 1 is visible
without scrolling on a 375×812 screen; rank 3 may be below the fold.

### During a session — `/history/[id]`

| Rank | What                                   | Why                                                                                                                                                      |
| ---- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Rest remaining**                     | The only thing that is time-critical. It decides when to stand up.                                                                                       |
| 1    | **Log set** — the action               | The reason the screen is open.                                                                                                                           |
| 2    | Weight, reps for the set being entered | Filled every single time.                                                                                                                                |
| 2    | **What was lifted last time**          | The number the next set is chosen from. Nobody invents a load.                                                                                           |
| 2    | Which exercise the row belongs to      | Changes rarely; must be confirmable at a glance.                                                                                                         |
| 3    | RPE, rest length, warm-up flag         | Optional or defaulted.                                                                                                                                   |
| 3    | Sets already performed                 | Reference, consulted between exercises rather than between sets.                                                                                         |
| 4    | Session elapsed time, tonnage, finish  | End-of-session concerns.                                                                                                                                 |
| 4    | The quest hint under the bar           | One line: finishing settles the XP, and the quest it counts toward. Above the header because it is about finishing; one line, so rank 1 stays on screen. |

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

**The board moved above the quests on 2026-09-13**, on the owner's decision with the redesign. It still degrades rather than throws: a failed leaderboard read says so in its own sentence — not the empty board's, which tells the reader to set a display name they may already have — and the quests below it load regardless.

| Rank                                                                                                                                                                                                                                                                                                             | What                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1                                                                                                                                                                                                                                                                                                                | The leaderboard — ADR 0016, first since the Quest Log redesign (ADR 0033) |
| 2                                                                                                                                                                                                                                                                                                                | Challenges you can accept or are part-way into                            |
| 3                                                                                                                                                                                                                                                                                                                | Challenges the validator declined, and why                                |
| _The demo reset was rank 4 here. It is one button on `/sign-in` now, beside the account it belongs to — ADR 0032 §4 as amended twice. It could not be reached from this tab by the only account that has it: Hub sends a user whose `onboarded_at` is null to `/welcome`, and that account's is null by design._ |

**Profile — `/profile`**

| Rank | What                                                                           |
| ---- | ------------------------------------------------------------------------------ |
| 1    | Level, and progress into the next one                                          |
| 2    | Streak and adherence — the retention numbers, per PRD §3                       |
| 3    | XP this week against the ceiling                                               |
| 4    | Badges — each one, and the section, open `/badges` — and the progression trees |
| 5    | Tonnage and what it weighs as much as, acute:chronic, weekly chart, best e1RM  |
| 6    | — (settings moved to `/settings`; the cog is in the header)                    |

**A consequence worth stating:** the stat tiles are equal in weight and are not
equal in rank. Streak and adherence are the mechanic the product retains people
with (invariant #4), and they come first; sessions and badges follow; tonnage and
ACWR are diagnostics, and they sort below the game. _Since the Quest Log redesign
(ADR 0033) the four tiles are also equal in SIZE — two by two. Until then the
first two spanned the full width on a phone, and order alone now carries the
rank._

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

**`/progression-trees` reads as a climb** — the Quest Log redesign. A tile per tree, each a jump to its ladder; the explainer; then each ladder with its TOP rung first, so the page reads upwards the way the tree is climbed, and a rung's state is a glyph in its hex and a word beside it.

**`/badges` is the catalogue**, and Profile owns it the way it owns
`/settings`. Ranked: what you hold, newest first — the one you just earned is the
one you came to look at; then what is still to get, alphabetically, each with
how to earn it; then how many sit above the humour setting, and how many hidden
ones are left. Earned comes first because a
list that opens on everything you lack is a list of failures.

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

**The test for an exemption:**
the table is narrow enough to fit 375 px, and it is read DOWN a column rather
than across a row, so card-stacking would destroy the one property it has. _One
exemption now, and the list says why the other ended._

- **The set grid** — five columns, sized to fit as a grid. Turning a set into a
  card destroys the alignment that makes a session readable at a glance.
- **The leaderboard** was the second, as a three-column table read down its rank
  and level columns, until the Quest Log redesign (ADR 0033) drew it as a podium
  for the top three and a list below. It is no longer a table, so it no longer
  needs the exemption: the podium's tiles wrap a name to two lines inside a
  fixed third of the width, and each list row truncates the name and keeps the
  rank and level in their own columns. The argument that made it an exemption —
  a ranking is read down a column — is what the list rows still honour.

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

| State                                             | What the user sees                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Set logging**                                   | The row's tick shows a pending mark and the row is locked. It does not vanish or move.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Set logged**                                    | The row turns green with a filled tick, and the rest timer starts counting — that _is_ the confirmation, and it is what they need next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Set un-ticked**                                 | The `sets` row is deleted and its values return to a pending row. A mis-tap never costs a retyped weight.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Start pressed mid-session**                     | The session already running opens, rather than a second one. Nothing is created and nothing logged is orphaned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **No previous session**                           | An em dash in `PREVIOUS`. A blank column reads as a broken lookup; a zero would be a claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Rest finished**                                 | The timer turns green and the device says "Rest over." — or beeps where it cannot speak. No coach's voice, on purpose: ADR 0025.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Nothing added yet**                             | "No exercises yet." plus the add control. Never an empty grid with headers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Log failed**                                    | The server's message, inline, and **the form keeps its values**. Retyping a weight while out of breath is the worst possible recovery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Search matches nothing**                        | "Nothing matches. Only equipment you own is listed." — names the reason, since an empty list otherwise reads as a broken app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **User owns no equipment**                        | Explains that no equipment is recorded and what fixes it. Never an empty picker with no explanation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Welcome answer partly filled**                  | The step says it needs all four and keeps what was typed. Saving three of them looked like success and re-rendered the step blank, which is the shape this table exists to prevent. The DATE has two sentences of its own, below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Date of birth partly chosen**                   | "Choose a day, a month and a year — or clear all three." Two of three selects is neither a date nor a blank, and treating it as blank would discard answers the user gave. Every value is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **A day the month does not have**                 | "That day does not exist in that month. Check the day." Named, because the generic sentence left four controls on screen with nothing saying which was wrong, and pressing Continue again reproduced it exactly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **A date later than today**                       | "That date has not happened yet." The year list stops at the local year, so a later day in this year is offered and then refused — a recoverable refusal, stated as one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **No coach rows to offer**                        | The coach step says so and lets the user past. A step whose question has no possible answer would stick the flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **A coach cannot be previewed**                   | On the WELCOME step the reason REPLACES the Try button, beside the coach rather than after its line — exactly one of the two, never both. The two rows below put the reason before the line because there the line is a fallback for speech; here the line is always shown as part of the coach description.                                                                                                                                                                                                                                                                                                                                                                                            |
| **Row ticked while empty**                        | "Fill in reps first." on the row. Nothing is written; a zero-rep set is not a set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Metric not yet computable**                     | An em dash plus what is missing — "12/28 days of history". A blank is honest; a zero is a claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Nothing lifted this week**                      | `0 kg`, not a dash. The week's tonnage is computed and it is zero — a true claim, so the row above does not apply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **No loaded sets yet**                            | "Nothing to chart yet" and why: warm-ups and bodyweight count as zero. "No sets logged" is false for a bodyweight lifter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **e1RM above 12 reps**                            | Blank, per the Epley cutoff. The hint explains why.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **No coach voice**                                | No key, or a coach with no voice (a user's own row): the reason, then the line as text, and no Try button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Voice loading**                                 | "Finding…" on the button, which stays pressable: a second press joins the call already in flight. The coach's name is in the button's accessible name, not its visible label.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Voice refused or fails**                        | The reason, then the line — the week's budget spent, no voice, or the call failed. Blocked playback: "Tap again to play."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A reply is spoken**                             | The switch sits above the chat box, off by default, naming the voice ("Read the answers aloud — The Analyst") and saying what it costs. Once a clip plays: "In The Analyst's voice." Blocked playback shows the sentence above and a Tap to play button INSTEAD of the name — never both.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **A reply is not spoken**                         | The written reply always stays. The reason renders beside it: no key, budget spent, too long to read aloud, or the voice did not come through — which also covers running out of time and a press too soon after the last. An answer the app substituted for the coach's is never spoken.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Coach changed after a delivery**                | The delivered words stay, under "What The Analyst says" — the coach who wrote them, not the one the menu now shows — and on a gentle week the note above them reads "Gentler tone in what The Analyst says: …". Delivering again replaces them with the selected coach's delivery, or with the error alone if it fails. They are not hidden: they would vanish on the first menu change with nothing saying where they went.                                                                                                                                                                                                                                                                            |
| **No badge earned yet**                           | The Earned section says so and points at the list below it. An empty heading reads as a failed load.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Nothing left on the list**                      | "Every badge on the list is yours." — a state, not a blank section. "On the list" because badges above the humour setting are not on it; the row below says how many.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Badges above the humour setting**               | "3 more badges are above your humour setting." — counted, never named, and never silent: a list that drops rows without a word reads as complete. It names the setting because that is what the user can change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Hidden badges left to find**                    | "2 hidden badges left to find." and nothing about which. One is "1 hidden badge". When none are left and the user holds one, "You found every hidden badge." When none exist, nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Nobody on the board**                           | "Nobody is listed yet" and where to set a display name — the likeliest reason is the reader's own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **The board could not load**                      | "The board could not be loaded just now. Your quests below are unaffected." A different sentence from the empty board's, because that one gives advice for a problem this is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Profile's locked badges could not load**        | The shelf shows what is held, then "The badges still to earn did not load just now — every one is on the badges page." Profile's level, streak and Settings cog stay; a row of padlocks is not worth the page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **A badge fires**                                 | A sheet over History: the badge in its metal, "Achievement unlocked" — or, for a hidden badge, "Something hidden, found" with its `hidden` and `found` chips — the name, description and source hint, then All badges (to its card on /badges) and Continue. A dialog labelled by what happened and the badge: focus lands on Continue and stays inside; Escape, the backdrop and Continue close it. Closing, or following All badges, drops ?unlocked=, and the sheet opens only while the router's own parameters name the badge — so neither a reload nor Back fires it twice. Continue is a link to /history, so it still leaves without JavaScript. A slug the reader does not hold shows nothing. |
| **A rung's state**                                | A glyph in its hex AND a word: unlocked, next, cleared — finish the rung below, or locked (read by a screen reader). The next rung is a raised card; the connector and the hex ground are decoration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **A session finished**                            | The receipt: "+N XP" from this session's own ledger rows, "Session kept", that week against its cap in ten segments, the level, the streak, and each accepted quest with Hub's own phrase — "N more … to go", or "complete · pays on the next weekly run" once met, never an amount. A badge the session earned opens as a sheet over it. It is the SESSION's week, so a session finished after midnight or days later still gets its receipt and its badge.                                                                                                                                                                                                                                            |
| **A session that earned nothing**                 | "+0", and a reason only when it is known: that week's cap reached. Otherwise "No XP is recorded for this session" — the award can fail silently by design and is never retried, so the page promises no later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **The receipt's streak or quests could not load** | The rows are left out and one line says so — "Your streak and quests did not load just now — they are on Profile and Hub." — because the session is saved and an error page would read as a failed save.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Offline / request fails**                       | The inline error path above. There is no optimistic write: a set that did not save must never look saved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

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
