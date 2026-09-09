# Plans — what each one is, and which to open

Eight documents, written over sixteen days, in three different genres. This file
is the way in.

It exists because phase 5 alone is three files whose names do not say how they
relate, and because `docs/plans/` had no index at all — you had to already know
which document answered your question in order to find it.

**Nothing here supersedes anything.** The originals are the record; this is a
map. Where this file and a plan disagree, the plan is right and this is stale.

## The three genres, because they are graded differently

`CLAUDE.md`: _the artifact trail is graded, and so is its order._ A plan
committed alongside its implementation cannot show it came first. So these
documents are not interchangeable, and merging them into one file would destroy
the distinction each of them spends its opening paragraph establishing:

| Genre                    | Written                                        | Example                       |
| ------------------------ | ---------------------------------------------- | ----------------------------- |
| **Plan**                 | before the code it governs, in its own commit  | `phase-5-content-fill.md`     |
| **Plan, committed late** | mid-sequence, kept verbatim rather than tidied | `rework-profile-hub-coach.md` |
| **Record**               | after the fact, and says so in its first line  | `phase-5.md`                  |

A record is not a failed plan. `phase-5.md` opens by stating that it did not
guide the work and does not claim to — the alternative was no phase-level
artifact at all, and backdating one would have been the actual offence.

## Every plan

| Document                                                   | Genre                | Covers                                                   | Status                      |
| ---------------------------------------------------------- | -------------------- | -------------------------------------------------------- | --------------------------- |
| [phase-0.md](phase-0.md)                                   | plan                 | Foundations: schema, gateway, ledger, CI                 | shipped                     |
| [phase-1.md](phase-1.md)                                   | plan                 | Deterministic substrate — metrics, seeder                | shipped                     |
| [phase-2.md](phase-2.md)                                   | plan                 | Planner and critic                                       | shipped                     |
| [phase-3.md](phase-3.md)                                   | plan                 | Normalizer and persona                                   | shipped, one criterion open |
| [phase-4.md](phase-4.md)                                   | plan                 | Gamification vertical slice                              | shipped                     |
| [phase-5.md](phase-5.md)                                   | **record**           | What phase 5 actually became: interface and feature work | shipped                     |
| [rework-profile-hub-coach.md](rework-profile-hub-coach.md) | plan, committed late | PRs #11–#17, the middle of phase 5                       | shipped                     |
| [phase-5-content-fill.md](phase-5-content-fill.md)         | plan                 | What phase 5 was briefed to build, done afterwards       | shipped                     |

## Phase 5 is three documents, and here is why

This is the part that needed combining. Phase 5 was briefed as **content fill**
and delivered as **interface work**; the content was then built afterwards under
the same phase number. That is one story in three artifacts:

1. **[phase-5.md](phase-5.md)** — the record of what the phase became, and the
   honest account of why it diverged. Two reasons, and it says only one of them
   is defensible: using the app surfaced problems content fill would not have
   fixed, and _nobody re-read the brief_.
2. **[rework-profile-hub-coach.md](rework-profile-hub-coach.md)** — the plan
   that governed the middle of it (PRs #11–#17): the Profile/Hub recut, accepting
   challenges, history graphs, the coach chat, the leaderboard.
3. **[phase-5-content-fill.md](phase-5-content-fill.md)** — the plan for the five
   content items the brief actually asked for, written once the divergence was
   noticed and executed over the two days after.

**Read them in that order if you want the story. Open the third if you want to
know what shipped** — it carries the longest Outcome section in the repo, one
entry per PR, and it is the live document. The snapshot table at the top of
`phase-5.md` is deliberately frozen and every row of it is now false; it says so.

### The whole phase in one table

None of the three carries this list end to end.

| PR                                                  | Merged | What                                                | Where it is planned or recorded                  |
| --------------------------------------------------- | ------ | --------------------------------------------------- | ------------------------------------------------ |
| [#7](https://github.com/haimlevtov/Samson/pull/7)   | 09-07  | Schema invariants against hosted, without Docker    | [phase-5.md](phase-5.md)                         |
| [#8](https://github.com/haimlevtov/Samson/pull/8)   | 09-07  | A distinct device voice per coach                   | [phase-5.md](phase-5.md)                         |
| [#9](https://github.com/haimlevtov/Samson/pull/9)   | 09-05  | The training page rebuilt as a set grid             | [phase-5.md](phase-5.md)                         |
| [#10](https://github.com/haimlevtov/Samson/pull/10) | 09-05  | Five-tab navigation, a theme, consistent routes     | [phase-5.md](phase-5.md)                         |
| [#11](https://github.com/haimlevtov/Samson/pull/11) | 09-07  | Profile owns what you earned; Hub owns other people | [rework](rework-profile-hub-coach.md) PR 1       |
| [#12](https://github.com/haimlevtov/Samson/pull/12) | 09-07  | Accepting a challenge is what puts it in play       | [rework](rework-profile-hub-coach.md) PR 2       |
| [#13](https://github.com/haimlevtov/Samson/pull/13) | 09-07  | Exercise progression charts in History              | [rework](rework-profile-hub-coach.md) PR 3       |
| [#14](https://github.com/haimlevtov/Samson/pull/14) | 09-07  | The coach chat                                      | [rework](rework-profile-hub-coach.md) PR 4       |
| [#15](https://github.com/haimlevtov/Samson/pull/15) | 09-07  | Settings as a route, and `OWNED_BY`                 | [rework](rework-profile-hub-coach.md), unplanned |
| [#16](https://github.com/haimlevtov/Samson/pull/16) | 09-07  | A running session kept out of History               | [rework](rework-profile-hub-coach.md), unplanned |
| [#17](https://github.com/haimlevtov/Samson/pull/17) | 09-07  | The leaderboard                                     | [rework](rework-profile-hub-coach.md) PR 5       |
| [#18](https://github.com/haimlevtov/Samson/pull/18) | 09-07  | The skills `CLAUDE.md` advertised and did not have  | [rework](rework-profile-hub-coach.md), unplanned |
| [#19](https://github.com/haimlevtov/Samson/pull/19) | 09-07  | Two cards that met with no space between them       | [rework](rework-profile-hub-coach.md), unplanned |
| [#20](https://github.com/haimlevtov/Samson/pull/20) | 09-07  | The phase-5 record itself                           | [phase-5.md](phase-5.md)                         |
| [#21](https://github.com/haimlevtov/Samson/pull/21) | 09-08  | The content-fill plan, committed before its code    | [content-fill](phase-5-content-fill.md) PR 1     |
| [#22](https://github.com/haimlevtov/Samson/pull/22) | 09-08  | Achievements across every tier                      | [content-fill](phase-5-content-fill.md) PR 2     |
| [#23](https://github.com/haimlevtov/Samson/pull/23) | 09-08  | Cumulative-tonnage comparisons                      | [content-fill](phase-5-content-fill.md) PR 3     |
| [#24](https://github.com/haimlevtov/Samson/pull/24) | 09-08  | The remaining personas                              | [content-fill](phase-5-content-fill.md) PR 4     |
| [#25](https://github.com/haimlevtov/Samson/pull/25) | 09-08  | Progression trees                                   | [content-fill](phase-5-content-fill.md) PR 5     |
| [#26](https://github.com/haimlevtov/Samson/pull/26) | 09-08  | Progress in the demo database                       | [content-fill](phase-5-content-fill.md) PR 7     |
| [#27](https://github.com/haimlevtov/Samson/pull/27) | 09-09  | The hint bubble stopped scrolling the page sideways | [ADR 0022](../adr/0022-popover-clamping.md)      |
| [#28](https://github.com/haimlevtov/Samson/pull/28) | 09-09  | The supplement evidence table                       | [content-fill](phase-5-content-fill.md) PR 6     |
| [#29](https://github.com/haimlevtov/Samson/pull/29) | 09-09  | Navigation and an Outcome for the plans             | —                                                |
| [#30](https://github.com/haimlevtov/Samson/pull/30) | 09-09  | The seeder refuses to silently drop prescribed work | —                                                |

Two things the table makes visible that the individual files do not:

- **The PR numbers and the plan numbers do not line up, in both directions.**
  Content-fill PR 6 shipped as #28 and PR 7 as #26, because PR 7 was inserted
  from a direct product request after PR 6 had been planned. The rework plan's
  five PRs are #11–#14 and #17, with #15, #16, #18 and #19 interleaved between
  them — none of those four is in any plan.
- **Four of the last five PRs were not planned anywhere**, and that is the
  pattern the rework Outcome names: _a tab rework is not finished when the tabs
  are right._ Each was invisible until there were enough surfaces for the
  navigation to be wrong about.

## What is still open, across all of them

Three things, none of them in phase 5's own scope:

- **Phase 3's persona drift eval** — "does turn 80 still sound like turn 3". The
  project's one unmet acceptance criterion. It needs live model runs, not code.
  [phase-5.md](phase-5.md), known gaps.
- **The start-action race.** `startWorkout` and `startFromTemplate` read then
  insert; Next's action queue serialises a double-tap, so what remains is two
  tabs or two devices. The guarantee is a partial unique index, deliberately
  deferred. [phase-5.md](phase-5.md), known gaps.
- **The chat's topical confinement is a mitigation, not a guarantee**, and
  [ADR 0015](../adr/0015-coach-chat.md) says so in a table. Not a gap to close —
  a property to keep stating accurately.

## Where else to look

- [`docs/PLAN.md`](../PLAN.md) — the phase brief and its acceptance criteria.
  The plans here say how a phase was executed; PLAN.md says what it owed.
- [`docs/adr/`](../adr/) — the decisions. Twenty-three of them, and several
  carry the honest note that they were written after their code at a reviewer's
  prompting rather than before it.
- [`docs/specs/`](../specs/) — the written contracts tests are built from.
