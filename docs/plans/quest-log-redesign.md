# The Quest Log redesign

Five changes, five branches, in this order. `main` is green at `91776d1`, and the
coach-memory plan closed at nine of nine.

The owner handed over a full visual redesign on 2026-09-13 — "Quest Log", option
2a — made with Claude Design. Its handoff README is copied, unedited, to
[`docs/design/quest-log-handoff.md`](../design/quest-log-handoff.md); the
`.dc.html` mockups are not committed (400 KB of reference HTML that is not code).
The instruction that came with it:

> apply the redesign while making sure nothing breaks, all features stays where
> they are, leaderboard in hub will be on top by design

| PR  | What                                                                           | Branch                   | State                                                                   |
| --- | ------------------------------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------- |
| 1   | [The visual layer, and the Hub](#pr-1--the-visual-layer-and-the-hub)           | `quest-log-hub`          | shipped 09-13, [↓](#pr-1--the-visual-layer-and-the-hub-2026-09-13)      |
| 2   | [Profile](#pr-2--profile)                                                      | `quest-log-profile`      | shipped 09-13, [↓](#pr-2--profile-2026-09-13)                           |
| 3   | [The unlock sheet and the trees](#pr-3--the-unlock-sheet-and-the-trees)        | `quest-log-unlock-trees` | shipped 09-13, [↓](#pr-3--the-unlock-sheet-and-the-trees-2026-09-13)    |
| 4   | [The session, and the finish moment](#pr-4--the-session-and-the-finish-moment) | `quest-log-session`      | shipped 09-13, [↓](#pr-4--the-session-and-the-finish-moment-2026-09-13) |
| 5   | [Coach](#pr-5--coach)                                                          | `quest-log-coach`        | planned                                                                 |

Ordered so the primitives land with their first consumer, then one surface per
PR. Each is presentation: **no migration, no RPC, no policy and no new number.**

## Decisions taken before planning

### The handoff predates six shipped PRs, and where they disagree the feature stays

The mockups were drawn against an older Samson. Read against `main`, they omit or
remove things that ship today. The owner's instruction settles every one of
these the same way — **the feature stays where it is and is restyled** — and
they are listed so that no PR "follows the design" into deleting one:

| The handoff shows                                 | What ships, and stays                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A Voice card with a `Change` chip                 | The persona menu, the Try button, the coach's bio, and Deliver this plan (coach-memory PRs 1 and 5)         |
| Delivered lines, each with a speak button         | The delivered plan is **not** spoken — ADR 0025 §4. No speak button is added; that would be a new paid path |
| No diet card                                      | The Daily calories disclosure with its goal selector (ADR 0015 §6, ADR 0032 §3)                             |
| "Removed by decision": weekday tiles, topic chips | Neither exists on `main` any more; nothing to remove                                                        |
| A badge shelf with locked slots                   | The shelf, plus the way into `/badges` and each card's link to its place there (coach-memory PR 7)          |
| No plan import form                               | Save as a template, inside the plan disclosure (rework PR 7)                                                |

### Leaderboard first

The handoff puts the board above the quests, and the owner confirmed it: "leaderboard
in hub will be on top by design". The Hub page's own comment that it was "the least
important thing on this tab" is superseded for ORDER only — it still degrades
rather than throws, so a failed view never takes the quests down with it.

### No icon package, and the font is self-hosted

- **Icons are inline SVG**, copied from Lucide (ISC) into one module, exactly as
  `src/ui/TabBar.tsx` already argues: some forty icons is not a dependency. The
  handoff's mock loads them from `api.iconify.design` at runtime; the app never
  does.
- **Bricolage Grotesque via `next/font/google`**, which downloads at build time
  and serves the file from this app's own origin. No request to Google from a
  user's browser, and no new npm package.

### Metal is a reading of the tier, not a number

The handoff's gold, silver, bronze and obsidian map from `achievements.tier` in
one TS module, `src/ui/tiers.ts`, tested to cover all eight tiers the CHECK
allows. The same module maps a badge to its icon, defaulting to `medal`, because
an `icon` column would be a migration for decoration. CLAUDE.md #7 is about
content, and a metal is not content: nothing about earning a badge changes.

### Two surfaces are always dark

The board card and the unlock sheet are dark in both themes by design. Their
colours become tokens in `:root` that the dark blocks do not redefine, so
`app/globals.css`'s rule — nothing outside the token blocks names a colour —
still holds.

### A challenge's title comes from its spec, not its slug

`challengeTitle(spec)` reads `kind`, `target` and `window_days` —
"Three sessions this week", "Eight hard sets this week" — because the spec is what
the challenge measures and the slug is only a name for it. A null spec falls back
to the de-hyphenated slug, which is what the page prints today.

---

## PR 1 — the visual layer, and the Hub

**Branch `quest-log-hub`.** ADR 0033 first, in its own commit: the decisions
above that outlive this plan — the icon module, the font, the metal mapping, the
always-dark tokens, and what "presentation only" rules out.

**The layer:**

- Tokens: `--gold`, `--silver`, `--bronze`, `--obsidian` with their inks,
  `--emblem`, `--hex`, and the board ground, in `:root` only.
- Type: Bricolage for `h1`, card titles and big numerals; body unchanged. Kicker
  and micro sizes as classes, not per-page styles.
- `src/ui/icons.tsx` — `<Icon name>` over the Lucide bodies, a closed union of
  names so a typo is a compile error.
- `src/ui/Hex.tsx` — the emblem: size, ground, optional rim, children.
- `src/ui/tiers.ts` + test — tier → metal, slug → icon.
- `src/ui/format.ts` + tests — `isoWeek(localDate)`, `challengeTitle(spec, slug)`.
- `src/ui/segments.ts` + test — how many segments a meter fills, and the partial
  one, for a target ≤ 10; above that the existing `.xp-meter`.
- `h2.section` gains an optional leading icon.

**Hub:** header kicker `QUEST BOARD · WEEK n` and a level hex (Hub loads
`loadXpSummary`); **the board first**, as a dark card with a podium for the top
three (2nd · 1st · 3rd, metal rims, first letter of the name) and rows below,
the reader's row carrying the `YOU` chip and `aria-current`; then quest cards with
an icon hex, a spec-derived title, `Take the quest`; In play with the segmented
meter; Not offered unchanged. Every existing sentence about what a challenge pays
and when stays.

Files: `docs/adr/0033-quest-log-visual-layer.md`, `docs/specs/mobile-interface.md`
(Hub ranks), `app/layout.tsx`, `app/globals.css`, `src/ui/{icons.tsx,Hex.tsx,tiers.ts,segments.ts,format.ts}`
with tests, `app/hub/page.tsx`.

---

## PR 2 — Profile

**Branch `quest-log-profile`.** Header in Bricolage, the cog as the `settings`
icon. The hero level card with the conic ring, `n XP to Level n+1`, and two label
chips (`xpForLevel(level + 1)` — the curve's own function). Four equal stat tiles
with icon plates. This week's XP as a ten-segment meter over the ceiling. The
progression row-link with a hex — **without** a rung count, which would need a
heavy read on a page that does not otherwise use the trees. The badge shelf in
three columns: earned cards in their metal, held hidden ones in obsidian, and
**locked slots for visible badges not yet earned, read through
`loadBadgeCatalogue`** so the humour ceiling and ADR 0017 apply exactly as they do
on `/badges`. The way into `/badges` stays. Training load, tonnage and e1RM are
unchanged.

---

## PR 3 — the unlock sheet and the trees

**Branch `quest-log-unlock-trees`.** `BadgeReveal` becomes a centred sheet over
History: the badge's metal inside a rim hex, the kicker, name, description,
source hint, `All badges` (to `/badges`, where the catalogue is — the handoff says
`/profile` because it predates it) and `Continue`, which with Escape and the
backdrop dismisses it. `?unlocked=` and the ownership check stay exactly as they
are. Motion is a fade, and none under `prefers-reduced-motion`.

`/progression-trees`: kicker header, a tile per tree, and each ladder read top
rung first with a hex per rung for its state — unlocked, next, locked, and
cleared-but-waiting — which `unlockStates` already distinguishes. The criterion
sentences, the truncation notice and the explainer stay.

---

## PR 4 — the session, and the finish moment

**Branch `quest-log-session`.** The light coat only: the session bar's back
chevron, the clock over the template name, a quest hint card when an active
`sessions` challenge exists, Bricolage lift names and icon buttons, the rest bar's
count. **The set grid does not change** — ADR 0011, and the handoff says the same.

The finish moment is a route, `/history/[id]/kept`, that `finishWorkout`
redirects to with the same `?unlocked=` it sends today. It reads what is already
written — this workout's `xp_events` row, `loadXpSummary`, the streak from
`currentStreak`, active challenges through `evaluateChallenge` — and computes
nothing new. `Done` goes to `/history?unlocked=…`, so a badge still fires on
History, where it fires today. A session that earned nothing says so: the week's
ceiling was reached, and the session still counts for streak and adherence.
Challenge rows say **"pays on the next weekly run"** (ADR 0009 §4).

---

## PR 5 — Coach

**Branch `quest-log-coach`.** Kicker header and the `pill` icon on Supplements.
The Voice card gains the emblem and its heading; **the menu, Try, the bio and
Deliver stay in it.** The plan disclosure's summary becomes the row-link look with
a chevron that turns on open; the body is unchanged. The Diet disclosure gets the
same summary. Ask the coach: the transcript as two kinds of turn, the textarea,
and the `SpeakSwitch` beside `Send`. Nothing about what the chat sends, speaks or
refuses changes.

---

## Verification, every PR

`npm run verify` and `npm run build`; the browser at 375px against hosted, in
**both themes**, for every surface the PR touches — the always-dark cards are the
ones most likely to break in one of them. No paid calls: nothing here needs a
coach to speak. Reviewers per the standing workflow, including
`convention-compliance-reviewer` for the tokens, tap targets and the "state never
by colour alone" rule the handoff repeats.

## Outcomes

### PR 1 — the visual layer, and the Hub, 2026-09-13

Shipped as [#69](https://github.com/haimlevtov/Samson/pull/69). The leaderboard is
first on Hub as a podium, quests are cards with emblems, and every page's title
has the display face. Four reviewers; nothing blocking, and the findings worth
keeping are below.

**What shipped where the plan said otherwise.** `isoWeek` went to
`src/metrics/dates.ts`, beside `startOfWeek` and under the coverage threshold,
not `src/ui/format.ts`. `challengeTitle` and three more helpers went to a new
`src/ui/quests.ts`. `app/hub/Board.tsx` and `src/ui/SegmentMeter.tsx` were not
in the file list. None of it changes a decision; all of it is recorded here, which
is where this repository records it.

**A title that restated the rule, and still said a different one.** The handoff's
copy was "Three sessions this week", and the first version shipped it. But
`evaluateChallenge` counts the last seven days ending today, and the same PR put
the ISO calendar week in the header — so on a Monday, a challenge met Friday to
Sunday read "this week · complete" under "WEEK 38". Titles say "in seven days"
now. It is the one place this PR departs from the handoff's words on purpose.

### What review found

- **A tie for first was drawn as a difference.** `rank()` ties, and the crown, the
  gold digits and the centre slot followed whichever tied lifter Postgres returned
  first — which could swap on a reload. Everything that claims a place now follows
  rank; only the layout follows position. The same tie gave two rows one React key,
  inherited from the table this replaced, whose comment said rank was unique.
- **A display name could say "YOU".** On the podium the chip was the only mark,
  and its fill was one of the board ground's own colours. The reader's tile has an
  outline a name cannot produce.
- **A failed board read told a named user to set a name**, because it rendered the
  empty board's sentence. It has its own now — and the board sits at the top of the
  tab, where that mistake would have been the first thing read.
- **ADR 0033 claimed three things the code did not do**: that the tier test caught
  a ninth tier (it read one migration), that the welcome flow's title had the new
  face (its rule was missed), and that `src/ui` only divides (`remainingPhrase`
  subtracts). The test and the CSS were fixed; the ADR's wording was, for the third.
- **Hub now shows one personal figure**, the reader's level, and ADR 0013 said Hub
  was other people. Recorded there as an amendment rather than noticed later.
- **The build now needs Google Fonts.** `next/font/google` fetches at build time
  and fails the build if it cannot; CI does not build, so Vercel's preview was the
  first place it ran. It passed. ADR 0033 records the fix if it ever does not.

**Verified in a browser at 375px against hosted**, dark and light, as the
beginner fixture. No paid calls.

### PR 2 — Profile, 2026-09-13

Shipped as [#70](https://github.com/haimlevtov/Samson/pull/70). The hero level
ring, four equal stat tiles, the week's XP in ten segments, the progression
row-link with an emblem, and a medal shelf: earned badges in their tier's metal,
held hidden ones in obsidian with "hidden · found" in words, and locked slots for
visible badges not yet earned. Three reviewers.

**The locked slots nearly cost the page.** They come from `loadBadgeCatalogue` —
four reads, one of which throws on an empty result by design, for `/badges`'s
sake. On Profile that would have replaced the level, the streak and the only
reliable way into Settings with an error page for the sake of a row of padlocks.
Held badges are read as before and still throw; the catalogue degrades to a
sentence pointing at `/badges`.

**A second list of unearned badges owed the first list's honesty.** `/badges`
counts the badges above the humour setting; the new shelf dropped them without a
word, which ADR 0017 and spec §4 both forbid. It counts them now.

**A padlock is not a word.** The lock icon is hidden from screen readers, so a
locked card and an earned card read identically. Locked cards say "locked".

**Changed on purpose, and said in the PR:** a Profile badge card no longer shows
its description or earned date; both are one tap away on `/badges`. The stat
tiles are equal in size now, so order alone carries their rank — spec §2 says so.

### PR 3 — the unlock sheet and the trees, 2026-09-13

Shipped as [#71](https://github.com/haimlevtov/Samson/pull/71). A badge fires as a
sheet over History in its tier's metal, and the progression trees read top rung
first with a hex and a word per state. Three reviewers.

**A dismissed badge came back on Back.** Closing dropped `?unlocked=` from the
address, but Next keeps a page as it was rendered, and Back restored History with
the sheet still in it — so the most natural path after finishing, looking at the
session and going back, fired the same badge twice. The sheet now opens only while
the router's own search params name the badge, and `replaceState` passes `null`
state so the router sees the change rather than treating it as its own. Checked in
the browser: Continue, a session, Back — no sheet.

**The handoff's `role="status"` became a dialog.** It covers the page and eats the
backdrop's clicks, so it is modal whatever its role says. Focus lands on Continue,
stays inside, and returns to the page heading on close; the dialog is labelled by
what happened as well as by the badge. Continue is a link to `/history`, so a
sheet rendered open on the server still lets somebody out if the JavaScript never
arrives.

**What the handoff drew and this did not ship, on purpose:**

- **No "+75 XP" chip.** An achievement's XP goes through the weekly ceiling, so a
  flat 75 could be untrue.
- **No "most recent unlock" tile.** Unlocks are recomputed from sets and never
  stored, so nothing knows when a rung opened. The tiles jump to their ladders
  instead.
- **The title stays "Progression trees"**, not "Progression": ADR 0020's naming
  keeps the words together, because ADR 0014 owns "progression" for the e1RM chart.
- **The explainer stays whole**; the first version shortened it.

**The gate and the fields that cross to the browser are tested now.** They lived
in components, and nothing under `app/` is in the unit suite; `src/ui/unlock.ts`
holds the ownership check, the field list and the URL cleanup. History also stopped
reading held badges on every visit — only when one might fire, and degrading.

### PR 4 — the session, and the finish moment, 2026-09-13

Shipped as [#72](https://github.com/haimlevtov/Samson/pull/72). The session screen
got its light coat — the set grid untouched — and finishing lands on a receipt,
`/history/[id]/kept`, before History. Two reviewers, and the receipt changed
shape three times because of them.

**The badge had moved without anyone deciding it should.** The first version kept
firing badges on History and passed `?unlocked=` through the receipt's Done —
so "Review the session", a tab, or Back lost a badge for good, on the path this PR
itself added. A badge now fires on the receipt, the screen finishing lands on,
which is where it has always fired.

**"This week" was today's week.** A receipt read as of today redirected any
session from an earlier week to its own page — dropping the badge — which happens
to a session begun at 23:40 on a Sunday and finished after midnight, and to a loose
end finished days later. The award pays a session into its own week, and the
receipt now reads that week.

**The handoff's "Third kept session this week" is not shipped.** The award counts
completed and rest days at the moment it runs; a count read later, or of
completed sessions only, disagreed with it and printed "First session" over a
third-session payout. The number the award used is not stored, so the receipt
says "Session kept".

**What else shipped differently from this entry and the handoff:** quest rows use
Hub's phrase with no amount, because the weekly run caps and re-checks; "No XP is
recorded" promises no later, because nothing retries a failed award; the bar's
label is the template name or the date, with no session count; the remove button
is still "×"; this session's segment on the meter is not outlined. The finish
redirect was not exercised by finishing a new session, to keep the fixture account
unwritten; the receipt was checked against a completed session this week, with a
badge.
