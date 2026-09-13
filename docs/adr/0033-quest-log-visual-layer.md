# ADR 0033 — The Quest Log visual layer

**Status:** accepted, quest-log redesign
**Date:** 2026-09-13

## Context

The owner handed over a full redesign of the game layer on 2026-09-13 — "Quest
Log", option 2a, made with Claude Design. The handoff
([`docs/design/quest-log-handoff.md`](../design/quest-log-handoff.md)) is
explicit that it is presentation: no data model, RPC, policy or number changes.
The plan is [`docs/plans/quest-log-redesign.md`](../plans/quest-log-redesign.md).

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

Bricolage Grotesque (OFL), through `next/font/google`. That downloads the font
**at build time** and serves it from this app's origin, so a user's browser never
asks Google for anything, and it adds no npm package. It is used for `h1`, card
titles and big numerals; body text stays the system stack, so a slow font costs
headings a swap rather than costing the page its text.

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
  `/badges`. Nothing reads another user's row except the leaderboard view it
  already reads.
- **No feature removed.** Where the handoff omits something that ships, it stays —
  the plan lists each one.
- **State is never colour alone.** The leaderboard's "you" is a chip and
  `aria-current`; a rung's state is a glyph as well as a ground.

## What this does not guarantee

**That the fonts and metals read well on every device.** The handoff was drawn
in a 390px phone frame; the verification is 375px in both themes, which is the
spec's width and not every width.

**That a build survives Google Fonts being down.** `next/font/google` downloads
the face during `next build` and fails the build if it cannot — it never falls
back to a runtime request. At RUNTIME a missing face costs headings their face and
never their text; at build time it costs the deploy. `verify.yml` does not run a
build, so the Vercel deploy is where this would first show. Committing the woff2
through `next/font/local` (the OFL allows it) removes the dependency, and is the
change to make if it ever bites.

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
