# Plans — what each one is, and which to open

Eleven documents, written over nineteen days, in four different genres. This
file is the way in.

It exists because phase 5 alone is three files whose names do not say how they
relate, and because `docs/plans/` had no index at all — you had to already know
which document answered your question in order to find it.

**Nothing here supersedes anything.** The originals are the record; this is a
map. Where this file and a plan disagree, the plan is right and this is stale.

## The four genres, because they are graded differently

`CLAUDE.md`: _the artifact trail is graded, and so is its order._ A plan
committed alongside its implementation cannot show it came first. So these
documents are not interchangeable, and merging them into one file would destroy
the distinction each of them spends its opening paragraph establishing:

| Genre                             | Written                                        | Documents                                                                                                                                |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan, committed first**         | documents-only, ahead of the code it governs   | phases 2, 3, 4, 6; `phase-5-content-fill.md`; `rework-hub-history-coach.md`; `coach-memory-voice-onboarding.md`; `quest-log-redesign.md` |
| **Plan, committed with its code** | in the same commit as the implementation       | phases 0, 1                                                                                                                              |
| **Plan, committed late**          | mid-sequence, kept verbatim rather than tidied | `rework-profile-hub-coach.md`                                                                                                            |
| **Record**                        | after the fact, and says so                    | `phase-5.md`                                                                                                                             |

**The second row is a finding rather than a category anyone chose**, and it came
out of checking this table instead of writing it from the filenames. `phase-0.md`
was added in `3b8b0e2` — a 48-file commit carrying every migration, the gateway
and CI — and `phase-1.md` in `4885106` alongside the whole metrics engine.
Neither can show it came first, and neither says so. The habit starts at
`82bcf46`, "Phase 2 artifacts, committed before the code they plan", which is the
first documents-only plan commit in the repo.

A record is not a failed plan. `phase-5.md` states that it did not guide the work
and does not claim to — the alternative was no phase-level artifact at all, and
backdating one would have been the actual offence.

## Every plan

Status is against each document's **own** acceptance criteria, not against
whether the feature exists.

| Document                                                             | Genre                | Covers                                                          | Status                       |
| -------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------- | ---------------------------- |
| [phase-0.md](phase-0.md)                                             | plan, with its code  | Foundations: schema, gateway, ledger, CI                        | shipped                      |
| [phase-1.md](phase-1.md)                                             | plan, with its code  | Deterministic substrate — metrics, seeder                       | shipped                      |
| [phase-2.md](phase-2.md)                                             | plan, first          | Planner and critic                                              | shipped, two criteria unmet  |
| [phase-3.md](phase-3.md)                                             | plan, first          | Normalizer and persona                                          | shipped, one criterion unmet |
| [phase-4.md](phase-4.md)                                             | plan, first          | Gamification vertical slice                                     | shipped                      |
| [phase-5.md](phase-5.md)                                             | **record**           | What phase 5 actually became: interface and feature work        | shipped                      |
| [rework-profile-hub-coach.md](rework-profile-hub-coach.md)           | plan, committed late | PRs #11–#17, the middle of phase 5                              | shipped                      |
| [phase-5-content-fill.md](phase-5-content-fill.md)                   | plan, first          | What phase 5 was briefed to build, done afterwards              | shipped                      |
| [phase-6.md](phase-6.md)                                             | plan, first          | The diet advisor on the Coach tab; file import                  | shipped, one criterion unmet |
| [rework-hub-history-coach.md](rework-hub-history-coach.md)           | plan, first          | Hub, graphs, demo data and the Coach — after the phases         | 12 of 12 shipped             |
| [coach-memory-voice-onboarding.md](coach-memory-voice-onboarding.md) | plan, first          | Coach memory, a voice in a session, and a user who starts empty | 9 of 9 shipped               |
| [quest-log-redesign.md](quest-log-redesign.md)                       | plan, first          | The owner's Quest Log redesign, one surface per PR              | 3 of 5 shipped               |

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
know what shipped** — it carries the longest Outcome section in the repo
(545 lines against 184 for the runner-up), one entry per shipped PR, and it is
the live document. The snapshot table at the top of
`phase-5.md` is deliberately frozen and every row of it is now false; it says so.

### The whole phase in one table

None of the three carries this list end to end.

| PR                                                  | Merged | What                                                    | Where it is planned or recorded                  |
| --------------------------------------------------- | ------ | ------------------------------------------------------- | ------------------------------------------------ |
| [#7](https://github.com/haimlevtov/Samson/pull/7)   | 09-07  | Schema invariants against hosted, without Docker        | [phase-5.md](phase-5.md)                         |
| [#8](https://github.com/haimlevtov/Samson/pull/8)   | 09-07  | A distinct device voice per coach                       | [phase-5.md](phase-5.md)                         |
| [#9](https://github.com/haimlevtov/Samson/pull/9)   | 09-05  | The training page rebuilt as a set grid                 | [phase-5.md](phase-5.md)                         |
| [#10](https://github.com/haimlevtov/Samson/pull/10) | 09-05  | Five-tab navigation, a theme, consistent routes         | [phase-5.md](phase-5.md)                         |
| [#11](https://github.com/haimlevtov/Samson/pull/11) | 09-07  | Profile owns what you earned; Hub owns other people     | [rework](rework-profile-hub-coach.md) PR 1       |
| [#12](https://github.com/haimlevtov/Samson/pull/12) | 09-07  | Accepting a challenge is what puts it in play           | [rework](rework-profile-hub-coach.md) PR 2       |
| [#13](https://github.com/haimlevtov/Samson/pull/13) | 09-07  | Exercise progression charts in History                  | [rework](rework-profile-hub-coach.md) PR 3       |
| [#14](https://github.com/haimlevtov/Samson/pull/14) | 09-07  | The coach chat                                          | [rework](rework-profile-hub-coach.md) PR 4       |
| [#15](https://github.com/haimlevtov/Samson/pull/15) | 09-07  | Settings as a route, and `OWNED_BY`                     | [rework](rework-profile-hub-coach.md), unplanned |
| [#16](https://github.com/haimlevtov/Samson/pull/16) | 09-07  | A running session kept out of History                   | [rework](rework-profile-hub-coach.md), unplanned |
| [#17](https://github.com/haimlevtov/Samson/pull/17) | 09-07  | The leaderboard                                         | [rework](rework-profile-hub-coach.md) PR 5       |
| [#18](https://github.com/haimlevtov/Samson/pull/18) | 09-07  | The skills `CLAUDE.md` advertised and did not have      | [rework](rework-profile-hub-coach.md), unplanned |
| [#19](https://github.com/haimlevtov/Samson/pull/19) | 09-07  | Two cards that met with no space between them           | [rework](rework-profile-hub-coach.md), unplanned |
| [#20](https://github.com/haimlevtov/Samson/pull/20) | 09-07  | The phase-5 record itself                               | [phase-5.md](phase-5.md)                         |
| [#21](https://github.com/haimlevtov/Samson/pull/21) | 09-08  | The content-fill plan, committed before its code        | [content-fill](phase-5-content-fill.md) PR 1     |
| [#22](https://github.com/haimlevtov/Samson/pull/22) | 09-08  | Achievements across every tier                          | [content-fill](phase-5-content-fill.md) PR 2     |
| [#23](https://github.com/haimlevtov/Samson/pull/23) | 09-08  | Cumulative-tonnage comparisons                          | [content-fill](phase-5-content-fill.md) PR 3     |
| [#24](https://github.com/haimlevtov/Samson/pull/24) | 09-08  | The remaining personas                                  | [content-fill](phase-5-content-fill.md) PR 4     |
| [#25](https://github.com/haimlevtov/Samson/pull/25) | 09-08  | Progression trees                                       | [content-fill](phase-5-content-fill.md) PR 5     |
| [#26](https://github.com/haimlevtov/Samson/pull/26) | 09-08  | Progress in the demo database                           | [content-fill](phase-5-content-fill.md) PR 7     |
| [#27](https://github.com/haimlevtov/Samson/pull/27) | 09-09  | The hint bubble stopped scrolling the page sideways     | [ADR 0022](../adr/0022-popover-clamping.md)      |
| [#28](https://github.com/haimlevtov/Samson/pull/28) | 09-09  | The supplement evidence table                           | [content-fill](phase-5-content-fill.md) PR 6     |
| [#29](https://github.com/haimlevtov/Samson/pull/29) | 09-09  | Navigation and an Outcome for the plans                 | —                                                |
| [#30](https://github.com/haimlevtov/Samson/pull/30) | 09-09  | The seeder refuses to silently drop prescribed work     | —                                                |
| [#31](https://github.com/haimlevtov/Samson/pull/31) | 09-09  | This file: one way into the plans, phase 5 as one story | —                                                |

Two things the table makes visible that the individual files do not:

- **The PR numbers and the plan numbers do not line up, in both directions.**
  Content-fill PR 6 shipped as #28 and PR 7 as #26, because PR 7 was inserted
  from a direct product request after PR 6 had been planned. The rework plan's
  five PRs are #11–#14 and #17, with **#15 and #16 interleaved between them** and
  **#18 and #19 after the last of them** — none of those four is in any plan.
- **#15, #16, #18 and #19 were not planned anywhere**, and that is the pattern
  the rework Outcome names: _a tab rework is not finished when the tabs are
  right._ Each was invisible until there were enough surfaces for the navigation
  to be wrong about. (Named rather than counted, because "four of the last five"
  is also true of #26–#30 further down the table, which those words do not
  describe at all.)

## What is still open, taken from the documents rather than from memory

> **The first version of this section listed three items and called them
> complete.** It was written from recall and missed six, including two unmet
> acceptance criteria that `phase-2.md` names in a table. That is the same
> failure `rework-profile-hub-coach.md`'s own Outcome carries a callout about,
> repeated one day later — which is the argument for reading the Still-open
> sections rather than remembering them.

**Waiting on live model runs, not on work** — seven of the nineteen open items
below, and worth grouping. _This said "blocked on an OpenRouter key", closed by
one `.env.local` line; a funded key exists since 2026-09-11 (rework PR 6b), so
each now needs a run that spends it._

| From                     | Item                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| [phase-2.md](phase-2.md) | Cache hit rate measured and recorded — **unmet acceptance criterion**                                                              |
| [phase-2.md](phase-2.md) | Cost per plan generation recorded per model — **unmet acceptance criterion**                                                       |
| [phase-2.md](phase-2.md) | Live acceptance rate across the thirty golden cases                                                                                |
| [phase-3.md](phase-3.md) | The persona drift eval — "does turn 80 still sound like turn 3" — **unmet acceptance criterion**                                   |
| [phase-3.md](phase-3.md) | No persona has ever spoken; every delivery in the suite is scripted                                                                |
| [phase-0.md](phase-0.md) | A gateway call writes a complete `llm_calls` row — **unmet acceptance criterion**, and this list did not carry it until 2026-09-09 |
| [phase-6.md](phase-6.md) | No live model has ever answered a diet question; every adversarial result is against a scripted one                                |

`npm run eval:planner -- --live` is written and unrun. The persona drift eval is not written at all — `package.json` has no script for it, and the add-persona skill says so.

**Known gaps that need work:**

| From                                                       | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [phase-2.md](phase-2.md)                                   | The `repeated` critic escalation is untested                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [phase-3.md](phase-3.md)                                   | The number guard is over digits, so "add ten kilos" passes                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| [phase-3.md](phase-3.md)                                   | Coaches speak through the gateway's speech stage (ADR 0025), but only a preview line: a delivered plan is not read aloud until a later PR. "Rest over." is still device speech, and set logged, PR hit and last set are not announced at all — none of it the precomputed clips PLAN.md briefs                                                                                                                                                                                                       |
| [phase-5.md](phase-5.md)                                   | The start-action race — two tabs or two devices; the guarantee is a partial unique index, deliberately deferred                                                                                                                                                                                                                                                                                                                                                                                      |
| [phase-6.md](phase-6.md)                                   | **File import — an unmet acceptance criterion, by decision rather than by an API key.** Deferred 2026-09-09: Apple Health was the only one of the four formats with somewhere to land, and it is saved for later. The other three are endurance formats with no table to fill                                                                                                                                                                                                                        |
| [phase-6.md](phase-6.md)                                   | Apple Health would have closed two older notes — the bodyweight time series in `PRD.md` §8, and `tonnage.ts`'s AI-NOTE saying bodyweight-inclusive tonnage needs one first. Both stay open                                                                                                                                                                                                                                                                                                           |
| [phase-6.md](phase-6.md)                                   | The mangled comment at `src/evidence/doi.test.ts:89`, a backtick casualty that reached `main`. A one-line fix that keeps being rediscovered                                                                                                                                                                                                                                                                                                                                                          |
| [phase-6.md](phase-6.md)                                   | The browser pass at 375×812 was not run on PRs 2, 4 or 5. Review found a width bug and a colour-only state in that markup, so it is the check that catches exactly this                                                                                                                                                                                                                                                                                                                              |
| [rework-hub-history-coach.md](rework-hub-history-coach.md) | This plan's PRs have not had the browser pass on their signed-in pages either; PR 4's graph was rendered and measured as a component, not on its page. Each touches a signed-in surface, and this agent does not type passwords                                                                                                                                                                                                                                                                      |
| [ADR 0003](../adr/0003-grants-and-rls.md)                  | Three foreign keys that no write policy checks: `exercise_equipment.exercise_id` and `.equipment_tag_id` — linking to another user's custom row would be closed by the same own-or-shared `with check` as `20260911100000`, a policy only, while one user's link occupying the pair for everybody needs a key change, since the primary key has no `user_id` — and `user_equipment.equipment_tag_id`, an existence oracle only. Pinned in `tests/db/schema-invariants.test.ts`, so a fourth fails CI |
| [ADR 0025](../adr/0025-coach-voices.md)                    | The Voice card says "Try again in a moment" when the provider refuses — no credit, a rejected request — and retrying fixes neither. A provider refusal wants its own line                                                                                                                                                                                                                                                                                                                            |
| [ADR 0020](../adr/0020-progression-unlock-criteria.md)     | Two trees stall for a bodyweight-only user: pull cannot open its chin-up rung (it asks for band-assisted pull-ups, tagged `other`), and push cannot open its handstand rung (parallel-bar dips); the muscle-up asks for weighted pull-ups. Content decisions — a dip needs bars — pinned in `tests/db/progression.test.ts`, so a new one fails CI                                                                                                                                                    |

**Not a gap, a property to keep stating accurately:** the chat's topical
confinement is a mitigation rather than a guarantee, and
[ADR 0015](../adr/0015-coach-chat.md) says so in a table. It came out of phase 5
(PR #14), as did the start-action race (PR #16); only phase 3's and phase 2's
items are inherited from earlier phases.

## Phase 6, the last one, in one table

Closed 2026-09-09. **One plan PR, four code PRs, and a sixth item deferred.** The
plan was committed before any of the code — which is the difference between this
phase and phase 5, and the reason phase 5 needed three documents. The deferred
item is the exception and says so: it was explicitly never planned, because the
plan could not choose between three readings of what "file import" meant.

| PR                                                  | Merged | What                                                                         |
| --------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| [#32](https://github.com/haimlevtov/Samson/pull/32) | 09-09  | The plan, committed before its code                                          |
| [#33](https://github.com/haimlevtov/Samson/pull/33) | 09-09  | ADR 0024, the diet contract, and the four numbers nothing had ever asked for |
| [#34](https://github.com/haimlevtov/Samson/pull/34) | 09-09  | The calorie clamp, and the negative BMR the sweep found                      |
| [#35](https://github.com/haimlevtov/Samson/pull/35) | 09-09  | The diet stage: a model that may not write a number                          |
| [#36](https://github.com/haimlevtov/Samson/pull/36) | 09-09  | Retrieval-only supplement answers                                            |
| [#37](https://github.com/haimlevtov/Samson/pull/37) | 09-09  | The import decision and the phase close-out                                  |
| —                                                   | —      | File import, **deferred by decision** — the phase's one unmet criterion      |

**Each of the four CODE PRs carried a defect that would have reached a user**, and
three of them were invisible to the tests written for them, because each test
shared its code's assumption. Review found all but one; PR 3's negative BMR was
found by its own property sweep, which is the one test shape that does not have
to think of the case first. `phase-6.md`'s close-out has the table.

## Where else to look

- [`docs/PLAN.md`](../PLAN.md) — the phase brief and its acceptance criteria.
  The plans here say how a phase was executed; PLAN.md says what it owed.
- [`docs/adr/`](../adr/) — the decisions. Thirty-two of them, and several
  carry the honest note that they were written after their code at a reviewer's
  prompting rather than before it.
- [`docs/specs/`](../specs/) — the written contracts tests are built from.
