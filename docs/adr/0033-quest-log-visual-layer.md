# ADR 0033 — The Quest Log visual layer

**Status:** accepted, quest-log redesign — §2 amended 2026-09-13 (the face is committed)
**Date:** 2026-09-13

## Context

The owner handed over a full redesign of the game layer on 2026-09-13 — "Quest
Log", option 2a, made with Claude Design. The handoff
([`docs/design/quest-log-handoff.md`](../design/quest-log-handoff.md)) is
explicit that it is presentation: no data model, RPC, policy or number changes.
The plan is [`docs/plans/rework-4.md`](../plans/rework-4.md).

Most of it is layout, and layout needs no record. Five things do, because they
are decisions a future change could quietly undo, or ones this repository had
already argued the other way.

## Decision

### 1. Icons are an inline module, not a package

The handoff names about forty Lucide icons, and its mockups load them from
`api.iconify.design` at runtime. The app does neither.

`src/ui/icons.tsx` holds each icon's SVG elements, copied from Lucide (ISC
licence, attribution in the file), behind `<Icon name>` with a **closed union of
names** — a misspelt icon is a compile error, not an empty square. This is the
argument `src/ui/TabBar.tsx` already makes for its five: a set of forty glyphs is
not a dependency, and every icon package worth having ships far more than it
delivers. It also means no page makes a request to a third party to draw itself.

**AI-NOTE:** adding an icon means adding its elements to the module, from Lucide,
at the same 24-grid and 2px stroke. Mixing another set in breaks the one visual
rhythm the tab bar and the new emblems share.

### 2. One display font, self-hosted

Bricolage Grotesque (OFL). It is used for `h1`, card titles and big numerals;
body text stays the system stack, so a slow font costs headings a swap rather than
costing the page its text.

> **Amended 2026-09-13, on the owner's instruction: the font files are committed.**
> This section first chose `next/font/google`, which downloads the face during
> `next build` — so no browser ever asked Google, but every BUILD did, and a build
> with no route to Google Fonts failed. "What this does not guarantee" recorded
> that as the cost; the owner asked for it removed.
>
> The three files are Google's own `latin`, `latin-ext` and `vietnamese` subsets —
> every file `next/font/google` fetched, not only the two it preloaded; FOUND IN
> REVIEW, the first version of this left Vietnamese out and drew its accented
> letters in Arial. They are variable woff2s covering the weight and optical-size
> axes, in `app/fonts/` beside the SIL Open Font License text the licence requires
> them to travel with, and `app/fonts/SOURCE.md` records the URL and SHA-256 of
> each. `next/font/local` serves them from this origin with immutable caching and
> preloads only the Latin one, where `next/font/google` had preloaded both subsets
> it was given; the build fetches nothing.
>
> **Why three `localFont` faces and a hand-written fallback**, rather than one
> call: `next/font/local` cannot give each file its own `unicode-range`, and
> without ranges one file shadows the others. Separate calls can — but each would
> also generate its own metric-adjusted Arial fallback, and the first fallback
> would catch every extended glyph before the next face was reached, rendering
> "Łukasz" in Arial. So every call sets `adjustFontFallback: false`, and one
> fallback face follows them in `--display`, with the metrics `next/font/google`
> had computed for Arial against this family from Next's `capsize-font-metrics.json`
> (88.21% ascent, 25.61% descent, 105.43% size), so a heading does not jump when the
> face arrives and lays out as it did before. `next/font/local` would read slightly
> different figures from the subset files (91.48%, 26.56%, 101.66%); keeping the old
> ones is the choice, and a replacement font takes its figures from the same table.
>
> AI-NOTE: replacing the font means replacing the files, their rows in
> `app/fonts/SOURCE.md`, their `unicode-range`s in `app/layout.tsx`, and the
> fallback's metrics in `app/globals.css` together. `tests/unit/invariants.test.ts`
> pins each file's hash and checks it is a whole woff2, and fails if
> `next/font/google` or Google's font hosts come back anywhere a build or a browser
> would reach.

### 3. Metal is a reading of the tier, not a new fact

Gold, silver, bronze and obsidian are a **display mapping** of
`achievements.tier`, in `src/ui/tiers.ts`, beside the badge → icon mapping:

| Tier                              | Metal    |
| --------------------------------- | -------- |
| `pr`, `volume`                    | gold     |
| `consistency`, `comeback`         | silver   |
| `recovery`, `variety`, `calendar` | bronze   |
| `hidden`                          | obsidian |

**Not a column**, because nothing about earning, ordering or paying for a badge
changes with it — CLAUDE.md #7 puts _content_ in the database, and a colour a
tier is drawn in is not content. **Not a number either**: "gold" claims nothing
about difficulty that the tier did not already claim, and Profile's badge shelf
says so (quest-log PR 2). A test reads the LATEST `tier in (…)` CHECK across every
migration and holds the map to exactly those tiers, so a ninth tier added by a
migration fails the test rather than rendering on the fallback metal — bronze, the
least prominent, because an unknown tier drawn gold would be a claim.
_This said the test caught a ninth tier "rather than rendering unstyled", while
it read only the migration that created the table; review caught both halves._

**A HELD hidden badge is obsidian whatever its tier**, on Profile's shelf and on the
unlock sheet — the finding is the reward, and obsidian is how both say it. Both shipped hidden badges have
tier `hidden` today, so the rule and the table agree.

A badge's icon is keyed by slug with `medal` as the default, for the same reason:
a new achievement row needs no application change to render, which is what the
`add-achievement` skill promises.

### 4. Two surfaces are dark in both themes, and still tokens

The leaderboard card and the badge unlock sheet are dark whatever the theme — the
podium's metal rims and the obsidian badge need a dark ground to read as metal.
`app/globals.css` says nothing outside its token blocks names a colour. So their
colours are tokens declared **once, in `:root`**, which the two dark blocks
deliberately do not redefine. That keeps the rule, and makes "always dark" a fact
somebody can find rather than a hex in a component.

### 5. What "presentation only" rules out

Stated because a redesign is the easiest place to change behaviour by accident:

- **No new rule.** A level, a meter's fill, a count of segments: each comes from
  `src/gamification/` or `src/metrics/`, or from a tested pure helper in `src/ui/`
  that only rearranges figures those modules produced for display — dividing a
  total into segments, or subtracting progress from a target to say "one more
  session to go". _This said "only divides", and `remainingPhrase` subtracted in
  the same PR; the wording is what changed, because the subtraction restates
  `evaluateChallenge`'s own two numbers and adds no rule._
- **No copy that reads as a different rule.** A challenge's window is the last N
  days ending today, so its title says "in seven days", never "this week" — a
  word the header now uses for the ISO calendar week.
- **No new read that widens what a page may see.** Hub loads the XP summary it
  shows in its header. Profile's locked badge slots come through
  `loadBadgeCatalogue`, so ADR 0017 and the humour ceiling apply exactly as on
  `/badges` — including the count of what the ceiling held back, which Profile's
  first version dropped. Nothing reads another user's row except the leaderboard view it
  already reads.
- **No feature removed.** Where the handoff omits something that ships, it stays —
  the plan lists each one.
- **State is never colour alone.** The leaderboard's "you" is a chip and
  `aria-current`; a rung's state is a glyph as well as a ground.

## What this does not guarantee

**That the fonts and metals read well on every device.** The handoff was drawn
in a 390px phone frame; the verification is 375px in both themes, which is the
spec's width and not every width.

_This section listed "that a build survives Google Fonts being down" until §2's
amendment committed the files. A build now needs no network for the font. The
amendment brings two limits of its own, below._

**That the display face stays current.** The committed files are the version
Google served on 2026-09-13. `next/font/google` picked up a new release at the
next build; these do not change until someone replaces them as `app/fonts/SOURCE.md`
describes.

**That a heading never jumps on Android.** The fallback is `local('Arial')`, and
Android ships no Arial, so there the fallback face does not load and a heading is
drawn in the system face, unadjusted, until Bricolage arrives. It was the same
under `next/font/google`; the phone-first platform is the one it misses.

**That a future tier or badge looks designed.** It renders — a medal on the
default metal for its tier — but a good icon for a new badge is still a choice
somebody makes in `src/ui/tiers.ts`.

## Consequences

- Headings change on every page at once, including pages the redesign does not
  otherwise touch (History, Workout, Settings, the welcome flow, `/badges`,
  `/evidence`). That is intended: one display face is the point. (`header.top h1`
  and `.welcome-head h1` are the two rules; review found the welcome flow's
  missing from the first.)
- **Hub shows one personal figure: the reader's level**, in the header — an
  exception to ADR 0013's "Hub is other people", recorded there.
- `src/ui/icons.tsx` becomes the place every icon lives. `TabBar.tsx` keeps its
  own five, hand-drawn and tuned; moving them is not part of this.
- Hub's order changes — the board first — which supersedes the ordering argument
  in the Hub page's comments and `docs/specs/mobile-interface.md` §2. The board is
  no longer a table either, which ends its §3 card-stacking exemption. Nothing
  else about ADR 0016 changes: the same view, the same four fields.
