# Phase 5 — The interface phase that was briefed as content fill

Branch: many. 2026-09-05 to 2026-09-07, PRs #7 to #19.

> **This is a record, not a plan, and the difference is the point.**
>
> `CLAUDE.md` says the artifact trail is graded **and so is its order** — a plan
> is committed before the code it plans, in its own commit, because a plan
> committed alongside its implementation cannot show it came first. This file
> was written on 2026-09-07, **after** every PR below had merged. It did not
> guide the work and does not claim to.
>
> It exists because the alternative was worse: phase 5 had no plan artifact at
> all, and a missing document is harder to reason about than a late one that
> says when it was written. Backdating it would have been the actual offence.
>
> The phase's decisions **were** recorded before their code, in the place the
> rules require: seven ADRs (0010–0016), each in its own commit ahead of the
> implementation, plus `docs/specs/mobile-interface.md`,
> `workout-templates.md` and `coach-chat.md`. The per-PR trail is intact. What
> was missing was the phase-level view, and this is it.

## The divergence, first, because it is the largest fact

`docs/PLAN.md` briefs phase 5 as **"Content fill"**: remaining achievements,
cumulative-tonnage comparisons, remaining personas, progression trees, and a
curated supplement evidence table.

**Almost none of that was built.** As of the end of the phase:

| Briefed                                    | Shipped                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| Remaining achievements, all tiers          | **One** achievement exists (`first-full-week`, from phase 4) |
| Tonnage comparisons (bus, elephant, whale) | None                                                         |
| Remaining personas                         | Still the three from phase 3                                 |
| Progression trees: push, pull, legs, core  | Table exists, **no rows and no reader**                      |
| Supplement evidence table with DOIs        | Does not exist                                               |

> **This table is a snapshot of 2026-09-07 and is deliberately not maintained.**
> **All five of its rows are false as of 2026-09-09** — the achievements, the
> tonnage comparisons, the personas, the progression trees and the supplement
> evidence table have all shipped in the content fill, and nothing on it is
> outstanding. What shipped is recorded in
> [`phase-5-content-fill.md`](phase-5-content-fill.md)'s Outcome, which is the
> live document; editing a dated record to keep it current would destroy the
> thing it exists to record.

What happened instead was **interface and feature work**: a session set grid, a
five-tab navigation, workout templates, a theme, a re-cut of what Profile and
Hub own, exercise progression charts, an open coach chat, a settings route, and
the leaderboard.

### Why it diverged, said plainly

Two reasons, and only one of them is defensible.

**The defensible one: using the app surfaced problems content fill would not
have fixed.** The training page was a wide table on a phone. There was no
navigation — routes existed with no way to reach them. Starting a workout put it
straight into History and told the user they had finished something they were
still doing, and every press of Start inserted another row. None of that is
content, and shipping more achievements onto it would have been decorating a
surface nobody could use.

**The one that is just drift: nobody re-read the brief.** The phase was executed
as a series of individually reasonable PRs, each responding to what the last one
exposed, and the ADRs stamped "phase 5" accumulated without anyone checking them
against what phase 5 was supposed to be. That is how a plan stops governing —
not by being overruled, but by not being opened.

The right move at PR #9 would have been to amend `docs/PLAN.md` and say the
phase had changed. That did not happen until this document.

## What actually shipped, in order

| PR  | What                                                                  | Decision recorded first                    |
| --- | --------------------------------------------------------------------- | ------------------------------------------ |
| #7  | Schema invariants against hosted, without Docker                      | —                                          |
| #8  | A distinct device voice per coach, and reading the persona that spoke | migration + ADR 0006 correction            |
| #9  | The training page rebuilt as a set grid                               | ADR 0011, `docs/specs/mobile-interface.md` |
| #10 | Five-tab navigation, a theme, consistent routes                       | ADR 0012                                   |
| #11 | Profile owns what you earned; Hub owns everyone else                  | ADR 0013                                   |
| #12 | Accepting a challenge is what puts it in play                         | migration + `tests/db`                     |
| #13 | Exercise progression charts in History                                | ADR 0014                                   |
| #14 | The coach chat                                                        | **ADR 0015 + `docs/specs/coach-chat.md`**  |
| #15 | Settings as a route, behind a header cog                              | ADR 0013 amendment                         |
| #16 | A running session kept out of History, and reachable                  | `docs/specs/mobile-interface.md`           |
| #17 | The leaderboard                                                       | **ADR 0016**                               |
| #18 | The three skills `CLAUDE.md` advertised and did not have              | —                                          |
| #19 | Two cards that met with no space between them                         | —                                          |

PRs #11 to #17 were planned together in
[`rework-profile-hub-coach.md`](rework-profile-hub-coach.md), whose Outcome
records what they turned into and which of them this table lists as follow-ups
that no plan anticipated.

Templates (ADR 0010, `docs/specs/workout-templates.md`) landed inside this
window too.

**Two of these were pulled forward from later phases**, and both are recorded
where they were promised:

- **The leaderboard** is a phase 6 item. ADR 0013 gave Hub the job of being the
  tab about other people, and a tab that owns nothing is the fault ADR 0012 was
  written to fix. `docs/PLAN.md`'s phase 6 entry now says so, including the two
  ways the shipped mechanism differs from what that entry described.
- **The coach chat** was not briefed anywhere. It came from a direct product
  request, and it is the first free-text channel into a model in the project —
  which is why it got an ADR of its own rather than being folded into a PR.

## Verification

Every PR: `npm run verify`, `npm run build`, and the browser at 375×812 for
anything with a surface. `npm run test:db` where a migration was involved.

At the end of the phase: **801 unit tests across 36 files**, **103 database
cases**, `verify` and `build` clean. 61 commits, 176 files changed.

Every PR went through the standing workflow — branch, PR, reviewer subagents,
merge only when green, delete the branch.

## Outcome — 2026-09-07

### Review caught something real in every single PR

That is the phase's most useful measurement, and it is not a flattering one.
The reviewers were not rubber stamps:

- **The gateway's retry echo replayed a rejected completion as an `assistant`
  message, unfenced — for every stage.** ADR 0015 argues at length that this
  channel is closed for the chat, and it was open in shared code the whole time.
- **The active-session guard asked a calendar question about a recency
  problem.** `local_date = today` meant a session begun at 23:55 stopped being
  active at midnight while the user was still logging into it — reintroducing
  the duplicate-row bug that PR #16 existed to fix.
- **`btrim(x)` strips ASCII space and nothing else**, so a tab or a
  non-breaking space took a numbered slot on everybody's leaderboard and
  rendered as a blank row, falsifying ADR 0016 §3's central promise.
- **A hand-written second copy of the invisible-character set**, with an
  AI-NOTE justifying the duplication that cited the very file refuting it.
- **Four documents describing the leaderboard as unbuilt**, including
  `docs/FRAMING.md`'s out-of-scope table, which excluded the feature that had
  just shipped.

### The browser caught two things the whole toolchain waved through

Both are worth naming because they define what CI cannot do here.

**`llm_calls.stage` is a CHECK constraint.** Adding `chat` to the `LlmStage`
union passed typecheck, lint and 757 unit tests, then failed on the first real
message. The unit suite mocks the gateway, so it never inserts a row and
_structurally cannot_ catch it. `tests/db/schema-invariants.test.ts` now asserts
the union and the constraint admit the same set, and
`.claude/skills/add-pipeline-stage/SKILL.md` leads with it.

**The settings form was completely broken.** A Zod field was added to the schema
and never to the parse object, so it was permanently `undefined` and _every_
save failed — display name, timezone, theme, humour. Typecheck could not see it
because the parse object is an untyped literal.

### And one the user caught that a sweep did not

The Profile level card "overlapping" the tiles below it. An automated sweep
across 320–900px in both themes found nothing, because it tested for
**intersecting bounding boxes** and the boxes merely _touched_ — 0px apart, with
a card shadow reaching 10px down onto the card below. The detector was correct
and the question was wrong.

### Unplanned but load-bearing: the CLI pin

`supabase/setup-cli` tracked `latest`, and the types-stale step regenerates
`src/db/types.ts` and fails on any diff. CLI v2.117.0 published at 16:47:15Z and
`main`'s run failed at 16:47:14Z, on a change that adds parentheses and nothing
else. Every open PR went red at once. Pinned to 2.116.0, with both traps
recorded in `CLAUDE.md`.

## Known gaps leaving this phase

- **Everything phase 5 was actually briefed to build.** The table at the top is
  the list. `docs/PLAN.md` phase 5 should be rewritten to say what this phase
  became, and the content-fill items either rescheduled or cut — they are marked
  "compressible and parallelisable" in the brief, so cutting is legitimate. That
  decision has not been made and is not made here.

  **Settled 2026-09-08: rescheduled — and this bullet was wrong.** The decision
  had been made, in `docs/FRAMING.md` Q2, where the stakeholder was pressed on
  this exact brief and answered "Phase 5 is not cut, only sequenced last".
  `CLAUDE.md` names FRAMING.md as the document to read when a decision is
  disputed and it was not read here. All five items ship, planned in
  [`phase-5-content-fill.md`](phase-5-content-fill.md).

  **Closed 2026-09-09.** All five shipped — the fifth, the supplement evidence
  table, in that plan's PR 6. Nothing in the table at the top of this file is
  still outstanding.

- **Phase 3's persona drift eval remains unmet** — "does turn 80 still sound
  like turn 3". The project's one outstanding acceptance criterion, waiting on
  live runs rather than on work.
- **The start-action race.** `startWorkout` and `startFromTemplate` read then
  insert. Next's action queue serialises a double-tap, so what remains is two
  tabs or two devices. The guarantee is a partial unique index —
  `unique (user_id, local_date) where status = 'in_progress'` — and it was
  deliberately deferred rather than forgotten.
- **`progression_nodes` has no rows and no reader.**
  `.claude/skills/add-progression/SKILL.md` documents that plainly rather than
  implying the trees exist.

  **Closed 2026-09-08.** Four trees, a reader, a pure evaluator and a surface at
  `/progression-trees`, with the criteria contract in
  [ADR 0020](../adr/0020-progression-unlock-criteria.md) — see
  [`phase-5-content-fill.md`](phase-5-content-fill.md).

- **The chat's topical confinement is a mitigation, not a guarantee**, and
  ADR 0015 says so in a table. The model classifies itself; what is guaranteed
  is that it has no tools, no write path, and cannot state a figure the metrics
  engine did not produce.
