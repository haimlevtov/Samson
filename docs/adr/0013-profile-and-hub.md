# ADR 0013 — Profile owns what you have earned; Hub owns everyone else

**Status:** accepted, phase 5 — **amended 2026-09-07, see "Settings go behind a disclosure"**
**Date:** 2026-09-07
**Supersedes:** the ownership table in [0012](0012-bottom-tab-navigation.md)

## Context

[ADR 0012](0012-bottom-tab-navigation.md) cut the app into five tabs and argued,
correctly, that "a tab bar is only worth its 60px if each tab owns something".
It then drew the line here:

| Tab         | Owns (ADR 0012)                                              |
| ----------- | ------------------------------------------------------------ |
| **Hub**     | XP, streak, badges, challenges, training load, bests         |
| **Profile** | Who you are and the settings that change how the app behaves |

Using it showed that line is in the wrong place, in both directions.

**Profile is thin and Hub is a pile.** Profile holds three settings and a
join date. Hub holds six unrelated things whose only shared property is that
they are numbers about you.

**More importantly, Hub has no room for the thing it is for.** The Hub was
always meant to become social — a leaderboard, challenges you accept rather than
merely watch, and later training with other people. There is nowhere to put any
of that without making Hub a seventh thing, and ADR 0012's own reasoning says a
tab that is two unrelated things is the disease, not the cure.

And badges sitting on a different tab from the person who earned them was always
slightly wrong. A badge is not a statistic. It is a thing you have, like your
name and your timezone.

## Decision

**Profile is you. Hub is other people.**

| Tab         | Owns                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile** | Identity, settings (at `/settings`, owned by this tab), level, XP, badges, streak, training load, bests, and the progression trees (at `/progression-trees`, owned by this tab) |
| **Hub**     | Leaderboard, quests and challenges, and later collaboration                                                                                                                     |

Everything else in ADR 0012's table stands unchanged: History is past sessions,
Workout is templates, Coach is the plan. Hub remains the landing page — "what is
waiting for me" is still the right first question, it is just answered by a
challenge rather than by a streak counter.

### Training-load diagnostics go to Profile, not Hub

This is the part worth arguing rather than asserting, because ACWR and weekly
tonnage are not obviously "you" the way a badge is.

They go to Profile because they answer **"how am I doing"**, which is a question
about the person, and because the alternative is worse: leaving them on Hub
would mean Hub owns _social_ and _your training diagnostics_, which is exactly
the two-unrelated-things fault ADR 0012 exists to prevent. The test ADR 0012
set — does the tab own one thing you could name in a word — is passed by
"you" and by "everyone else", and failed by "everyone else, plus your
acute-to-chronic ratio".

The honest cost: Profile becomes the longest page in the app. That is
acceptable in a way a mixed-purpose tab is not — a long page about one subject
is scrolled; a tab about two subjects is misnavigated.

### Settings go behind a disclosure

> **Amended 2026-09-07 — settings moved to their own route. See the amendment
> below; this section records what was decided first and why it did not
> survive contact with the page.**

Profile now leads with what you have earned, so the settings form cannot be the
first thing on it. It moves behind a cog.

**A `<details>` element, not a modal or client state.** It is keyboard and
screen-reader navigable with no work, it needs no `useState` in a page that is
otherwise a server component, and with CSS disabled it degrades to an open
section rather than to a button that does nothing. The summary is a 44px target
per `docs/specs/mobile-interface.md`.

#### Amendment, 2026-09-07 — `/settings` is a route, and the cog is a link

The disclosure shipped and was wrong in one specific way this ADR had already
written down without noticing: it says, four paragraphs earlier, that **Profile
becomes the longest page in the app**. Putting the settings at the bottom of it
means the cog is not a control, it is a scroll target. Changing a timezone
requires scrolling past every badge, every chart and every diagnostic first.

**The cog moves to the header, top right, and links to `/settings`.**

A disclosure is the right shape for revealing more of what a page is already
about — the coach's plan on the Coach tab, the quick-log on a session. Settings
are a **different subject** that happened to be parked on Profile because it
was the identity tab. Three things follow from being a route rather than a
region:

- **It has an address.** It can be linked to, bookmarked, and returned to. A
  disclosure two thousand pixels down a page has no address at all.
- **Back works.** The device back gesture leaves settings and returns to
  Profile. Closing a disclosure is a separate, invisible affordance that back
  does not reach — and on a phone, back is the gesture people actually use.
- **The cog is reachable without scrolling**, which is the whole point of
  putting a control in a header.

**Sign out moves with it.** It was inside the disclosure, which made the one
irreversible control on the page also the least reachable one.

**What is kept from the original decision:** no modal, no client state, and no
`useState` in a server component. A route needs none of those either — it is
one more server page — so this amendment costs nothing that paragraph was
protecting. The `<details>` pattern itself stays in the codebase for the two
places it genuinely fits: the coach's plan and the session quick-log.

The disclosure CSS this decision originally wrote now has one caller, the
coach's plan, and `details.quick-log` still carries its own copies of the rules
rather than joining it. Stated because a claim that the CSS is "shared" would
be a claim about a file, and that is not the state of the file.

**Judged against:** a modal (traps focus, needs client state, no address, and
the back gesture dismisses the page rather than the modal on some browsers) and
leaving it in place (rejected on the scroll-distance argument above).

### Level is new, and it is arithmetic

The tabs now show a level, and no level exists anywhere in the project — XP
does, and nothing turns it into one.

**`levelForXp()` is deterministic code in `src/gamification/`, unit tested,**
like every other number a user sees (CLAUDE.md #1). The curve and its reasoning
go in `docs/specs/xp-and-challenges.md` before the code, and the properties are
asserted rather than assumed: monotonic in XP, never negative, and the
"XP to next level" figure the UI prints always agrees with the boundary
`levelForXp` itself uses. A progress bar that disagrees with the number beside
it is the classic failure here, and it is a test rather than a hope.

## Consequences

> **Amended 2026-09-12 by [ADR 0032](0032-a-user-who-starts-from-nothing.md),
> and the exception ENDED the same day.** Hub briefly carried one control this
> table does not give it: **Reset this demo account**, which rendered for a
> single seeded address and nobody else. It was an account action, and by the
> boundary above it belonged on Profile; the owner asked for it on the main page
> because it exists to be pressed between demo runs.
>
> It is gone from Hub. Not moved to Profile either — it is one button on
> `/sign-in`, beside the account it belongs to, because the reason it could not
> stay was not the ownership boundary: **the only account that has it cannot
> reach this tab.** Hub sends a user whose `onboarded_at` is null to `/welcome`,
> and that account's is null by design. ADR 0032 §4's second amendment carries
> the whole argument.
>
> **The table above is therefore exact again**, which is the state this
> amendment existed to avoid pretending. It is kept rather than deleted because
> `docs/specs/mobile-interface.md` §4 says an exception argued in a comment has
> stopped being an exception — and one silently un-recorded is no better.

**Hub is briefly emptier than before.** Between this change and the challenge
and leaderboard work that follows, Hub holds challenges and a placeholder. That
is a deliberate ordering: moving the ownership boundary first means the
leaderboard lands in a tab that already means "other people", rather than
arriving as one more item in a pile.

> **Resolved 2026-09-07.** The placeholder is gone: ADR 0016 built the
> leaderboard, and it did land in a tab that already meant "other people". The
> ordering argument above is left standing because it is the thing that was
> being claimed, and it turned out to be right.

**`/progress` stays deleted.** This is not a partial reversal of ADR 0012 — the
argument that one page must not have two names still holds. What changes is
which tab the content sits under.

**Level has no historical record.** It is derived from lifetime XP on every
read, so there are no level-up events, no timestamps, and nothing to show a
notification from. If a level-up should ever announce itself the way an
achievement does, that needs an event table and its own decision.

## Alternatives rejected

**Leave the boundary and put the leaderboard on Profile.** Puts other people
inside the tab named after you, which is worse than the problem being fixed.

**A sixth tab for social.** ADR 0012 argued five is already the practical
ceiling for a thumb, and adding one to avoid re-cutting a boundary is how tab
bars become nine icons.

**Keep the diagnostics on Hub as "stats".** "Stats" is not a thing you can name
in a word — it is a bucket, and a bucket is what this is trying to stop.

## A reversal worth naming

ADR 0012 rejected a four-tab layout partly on the grounds that "settings and
rewards have nothing to do with each other" ([0012](0012-bottom-tab-navigation.md),
Alternatives). This ADR puts settings and rewards on the same tab, so that
reasoning is reversed rather than merely superseded, and it should be said out
loud rather than left for a reader to notice.

The reversal is narrower than it looks. 0012's objection was to folding a whole
_tab_ into another — Profile disappearing as a destination. What is happening
here is the opposite: Profile becomes the substantial tab and gains a subject,
and the settings that used to be its whole content are demoted. "Settings and
rewards" are not co-equal halves of a tab; rewards are the tab, and settings
hang off it.

**Narrowed again by the 2026-09-07 amendment**, and worth saying out loud by
the same standard this section sets. Settings are no longer _content_ on
Profile at all — they are their own route, and what Profile keeps is
**ownership**: the cog is the only way in, and `OWNED_BY` in `src/ui/tabs.ts`
encodes that the tab bar lights Profile while you are there. So the reversal of
0012 shrinks to "the tab that owns your rewards also owns the door to your
settings", which is a good deal weaker than putting both on one page — and
closer to 0012's original instinct than this section first admitted.

What survives from 0012 unchanged is the test it set — a tab must own one thing
you can name in a word — and by that test "you" is a better answer than
"settings".
