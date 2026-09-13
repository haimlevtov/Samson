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

| PR  | What                                                                           | Branch                   | State   |
| --- | ------------------------------------------------------------------------------ | ------------------------ | ------- |
| 1   | [The visual layer, and the Hub](#pr-1--the-visual-layer-and-the-hub)           | `quest-log-hub`          | planned |
| 2   | [Profile](#pr-2--profile)                                                      | `quest-log-profile`      | planned |
| 3   | [The unlock sheet and the trees](#pr-3--the-unlock-sheet-and-the-trees)        | `quest-log-unlock-trees` | planned |
| 4   | [The session, and the finish moment](#pr-4--the-session-and-the-finish-moment) | `quest-log-session`      | planned |
| 5   | [Coach](#pr-5--coach)                                                          | `quest-log-coach`        | planned |

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
