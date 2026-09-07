# ADR 0013 — Profile owns what you have earned; Hub owns everyone else

**Status:** accepted, phase 5
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

| Tab         | Owns                                                                |
| ----------- | ------------------------------------------------------------------- |
| **Profile** | Identity, settings, level, XP, badges, streak, training load, bests |
| **Hub**     | Leaderboard, quests and challenges, and later collaboration         |

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

Profile now leads with what you have earned, so the settings form cannot be the
first thing on it. It moves behind a cog.

**A `<details>` element, not a modal or client state.** It is keyboard and
screen-reader navigable with no work, it needs no `useState` in a page that is
otherwise a server component, and with CSS disabled it degrades to an open
section rather than to a button that does nothing. The summary is a 44px target
per `docs/specs/mobile-interface.md`.

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

**Hub is briefly emptier than before.** Between this change and the challenge
and leaderboard work that follows, Hub holds challenges and a placeholder. That
is a deliberate ordering: moving the ownership boundary first means the
leaderboard lands in a tab that already means "other people", rather than
arriving as one more item in a pile.

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
and the settings that used to be its whole content are demoted behind a
disclosure. "Settings and rewards" are not co-equal halves of a tab; rewards are
the tab, and settings are a drawer on it.

What survives from 0012 unchanged is the test it set — a tab must own one thing
you can name in a word — and by that test "you" is a better answer than
"settings".
