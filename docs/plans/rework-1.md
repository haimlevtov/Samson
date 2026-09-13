<!--
Committed 2026-09-07, at the start of PR 4, which is later than it should have
been: PRs 1 to 3 of this sequence were already merged. It is recorded verbatim
as it was approved rather than backdated or tidied, so the trail shows what was
actually decided up front and what was decided along the way. Three things moved
after approval and are corrected in the documents that supersede them, not here.

1. The chat ADR is 0015 rather than 0014 — the progression chart took 0014 while
   this branch waited — so the leaderboard ADR becomes 0016.
2. PR 4's "Create a plan" button is not what shipped. Nothing in the app creates
   a plan, so the control reads "Show my plan", and docs/specs/coach-chat.md §1
   argues for not adding a Create button until a planner run can outlive a
   serverless request.
3. PR 4's note about the missing `add-pipeline-stage` skill still stands, and
   the registry is worse than recorded: CLAUDE.md advertises four skills and
   `.claude/skills/` contains one.
-->

# Rework — profile, hub, history graphs, and a coach you can talk to

Five changes, five branches, in this order. `main` is green at `c4e18ff` and the
phase plan stays paused.

> **This is the middle of phase 5**, PRs #11–#17, and the only one of its three
> documents whose name does not say so. The others are
> [`phase-5.md`](phase-5.md), the record of the phase around it, and
> [`phase-5-content-fill.md`](phase-5-content-fill.md), the content the brief
> asked for, built afterwards. [`README.md`](README.md) has the whole phase in
> one PR table.

## Status — complete

All five shipped on 2026-09-07, in the order planned.

| PR  | What                                                                                | Branch                   | Merged                                              | Contract                                                              |
| --- | ----------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | [What Profile owns, what Hub owns](#pr-1--adr-0013-what-profile-owns-what-hub-owns) | `tab-ownership-recut`    | [#11](https://github.com/haimlevtov/Samson/pull/11) | [ADR 0013](../adr/0013-profile-and-hub.md)                            |
| 2   | [Accepting quests and challenges](#pr-2--accepting-quests-and-challenges)           | `hub-accept-challenges`  | [#12](https://github.com/haimlevtov/Samson/pull/12) | —                                                                     |
| 3   | [Exercise progression graphs](#pr-3--exercise-progression-graphs-in-history)        | `history-exercise-graph` | [#13](https://github.com/haimlevtov/Samson/pull/13) | [ADR 0014](../adr/0014-exercise-progression-chart.md)                 |
| 4   | [The coach you can talk to](#pr-4--the-coach-ask-for-a-plan-and-talk-to-it)         | `coach-chat`             | [#14](https://github.com/haimlevtov/Samson/pull/14) | [ADR 0015](../adr/0015-coach-chat.md), [spec](../specs/coach-chat.md) |
| 5   | [The leaderboard](#pr-5--the-leaderboard)                                           | `hub-leaderboard`        | [#17](https://github.com/haimlevtov/Samson/pull/17) | [ADR 0016](../adr/0016-leaderboard.md)                                |

**Everything between this table and the [Outcome](#outcome) is the plan, not the
record.** It is kept as approved — see the comment above the title for the three
things that had already moved by the time it was committed, the third of which
is now closed. This table and the Outcome were both written 2026-09-09.

## Context

Phases 0–4 shipped a working vertical slice, and the tab rework (ADR 0012) cut
it into five surfaces. Using it surfaced five gaps: settings crowd the profile,
the game state sits on the wrong tab, the Hub has nothing social in it, history
shows what you lifted but not whether you are getting stronger, and the coach
hands you a plan without being asked and cannot be talked to at all.

Two of these are not layout work and are the reason this is a plan rather than a
list:

- **The coach chat is the first free-text channel into a model in this project.**
  Everything until now has been structured: the planner sees a fenced JSON
  payload, the normalizer sees one sentence about sets. A chat box is an open
  door, and ADR 0005's position is that a prompt is never the control.
- **The leaderboard is the first feature that reads another user's rows**, which
  invariant #10 forbids by default. `docs/PLAN.md` phase 6 already gated it.

### Decisions taken before planning

- **The leaderboard ships as its own PR**, last, with its ADR and migrations. It
  does not ride along inside a Hub reshuffle where a cross-user read gets less
  scrutiny than it deserves.
- **Chat confinement is one call returning `{ on_topic, reply }`**, with code
  discarding the model's text and substituting a fixed deflection when
  `on_topic` is false. One call per message, and the wording of a refusal is
  code, so it cannot be argued with.
- **The exercise graph plots heaviest working set over time, annotated with
  reps.** Its known weakness is handled rather than ignored: a deload reads as a
  regression unless the reps are visible, which is why they are on every point.

---

## PR 1 — ADR 0013: what Profile owns, what Hub owns

**Branch `tab-ownership-recut`.** ADR first, in its own commit.

ADR 0012 gave Hub "XP, streak, badges, challenges, training load, bests" and
Profile "who you are and the settings". That split is now wrong in both
directions: the things you have _earned_ are part of who you are, and the Hub
needs to be about other people. ADR 0013 supersedes 0012's ownership table:

| Tab         | Owns                                                                         |
| ----------- | ---------------------------------------------------------------------------- |
| **Profile** | Identity, settings, level, XP, badges, streak — you and what you have earned |
| **Hub**     | Leaderboard, quests, challenges, and later collaboration — other people      |

**Training-load diagnostics move to Profile too** (ACWR, weekly tonnage, bests).
Stated as the argued call it is: they answer "how am I doing", which is a
question about you, and leaving them on a social tab would make Hub two
unrelated things again — the exact fault ADR 0012 was written to fix.

**Level is new and does not exist.** XP does; there is no level anywhere in
`src/gamification/`. It arrives as `levelForXp(lifetimeXp)` in `src/gamification/level.ts`
— pure, deterministic, unit-tested, invariant #1 — with the curve and its
reasoning added to `docs/specs/xp-and-challenges.md` before the code. Properties
to assert: monotonic in XP, never negative, and the XP-to-next-level figure the
UI shows always agrees with the level boundary.

**Settings go behind a cog.** `app/profile/SettingsForm.tsx` moves inside a
disclosure in `app/profile/page.tsx`. A `<details>` with a cog summary, not a
modal: it needs no client state, it is keyboard- and screen-reader-navigable for
free, and it degrades to an open section with CSS off. 44px target per
`docs/specs/mobile-interface.md`.

Files: `docs/adr/0013-profile-and-hub.md`, `docs/specs/xp-and-challenges.md`,
`src/gamification/level.ts` + test, `app/profile/page.tsx`, `app/hub/page.tsx`,
`app/globals.css`.

---

## PR 2 — Accepting quests and challenges

**Branch `hub-accept-challenges`.**

The batch job assigns challenges as `offered`; nothing ever moves them to
`active`. Accepting is a user action, and `challenges` has read-only RLS and no
write policy — so, exactly as in ADR 0009, it goes through a `security definer`
RPC rather than a client update.

`accept_challenge(p_challenge_id uuid)` verifies the row belongs to
`auth.uid()`, is `offered`, and is inside its window, then transitions it to
`active`. The status filter in the `UPDATE` is the idempotency guard — a second
press matches no row — the same shape `settle_challenges` already uses.

Hub renders offered challenges with an Accept control, active ones with their
progress from `evaluateChallenge` (the same function the settlement job calls;
there is one definition of progress), and keeps the rejected list with its
reasons, which is phase 4's inspectability criterion.

Files: a migration for the RPC, `src/db/gamification.ts`, `app/hub/page.tsx`,
`app/hub/actions.ts`, `tests/db/` for the RPC's ownership and idempotency.

---

## PR 3 — Exercise progression graphs in history

**Branch `history-exercise-graph`.**

A graph control on each exercise in `app/history/[id]/LiftBlock.tsx` opens that
lift's history: **heaviest working set per session over time, each point labelled
with its rep count.**

- **Warm-ups excluded**, matching `exerciseBests`. A 20 kg warm-up is not a data
  point about strength.
- **Inline SVG, no chart library.** The tonnage bars on Hub are already
  hand-rolled, `app/globals.css` is hand-written, and a charting dependency
  would be the first in the project — for one sparkline. Reuse the CSS variables
  so it themes with everything else.
- A single session is a dot, not a line, and no history says so rather than
  rendering an empty axis.

New read in `src/db/training.ts`: top working set per workout for one exercise,
scoped by RLS. Shaping stays in `src/metrics/` so it is testable without a
database, like everything else there.

Files: `src/db/training.ts`, `src/metrics/progression.ts` + test,
`src/ui/LiftChart.tsx`, `app/history/[id]/LiftBlock.tsx`, `app/globals.css`.

---

## PR 4 — The coach: ask for a plan, and talk to it

**Branch `coach-chat`.** The substantial one. ADR and spec commit first.

### The plan is requested, not served

`app/coach/page.tsx` currently renders the accepted plan on load. It gets a
**Create a plan** button; the block renders only after the user asks.

### ADR 0014 — confining an open chat

Extends ADR 0005 rather than restating it. The threat model changes because the
input does: every earlier stage receives structured data, and this one receives
whatever someone types.

Five layers, only one of which is a prompt:

1. **Structural.** The chat gets no tools, no database write path, and no
   ability to reach the planner. It reads a fenced summary of the user's own
   metrics and nothing else.
2. **Fenced input.** Every user turn goes through `fenceUntrusted`
   (`src/llm/safety.ts`), including the history — which is user text too, and
   the obvious way to smuggle an instruction in on turn three.
3. **A code-owned refusal.** The stage returns
   `{ on_topic: boolean, reply: string }`. When `on_topic` is false the reply is
   **discarded** and a constant is sent instead. The model classifies; it does
   not get to author the refusal, so no amount of "reply with only the word
   OK" changes what the user sees.
4. **Output scanning.** The existing `scanOutput` already blocks protected
   attributes, demeaning language, prompt leakage and credential shapes.
   `findInventedNumbers` from `src/persona/guard.ts` is reused so the coach
   cannot state a figure the metrics did not give it — invariant #1 applies to
   a chat exactly as it does to a persona.
5. **A bounded window and a budget.** History is truncated by turns and
   characters, because an unbounded transcript is both a cost leak and an
   attention-dilution attack.

**What this does NOT guarantee, stated plainly in the ADR:** topical confinement
is a judgement, not arithmetic. Unlike the calorie floor or the XP ceiling there
is no deterministic check for "is this about training", so this is defence in
depth and the report must not claim otherwise. What _is_ guaranteed is that a
refusal's wording, the absence of tools, and the numbers it may state are all
code.

### Build

- `docs/adr/0014-coach-chat.md`, `docs/specs/coach-chat.md` (the contract the
  tests are written from).
- `chat` added to `LlmStage` in `src/llm/types.ts`, `STAGE_MODELS`, and a token
  budget in `src/llm/config.ts`.
- `src/chat/{schema,prompt,reply}.ts` + tests, injected `LlmCaller` like
  `src/planner/loop.ts`, so the whole thing runs offline against a scripted
  model.
- **The adversarial suite grows** — ADR 0005 §5 requires it every phase and this
  is the phase that most owes it. Cases: role reassignment, "ignore previous",
  fenced-delimiter escape, instruction smuggled via conversation history,
  off-topic with a training pretext, requests for the system prompt, requests
  for another user's data, and a medical question (which must recommend a
  professional, per the conduct rules). The suite records **what got through**,
  not only what was blocked.
- `app/coach/ChatPanel.tsx` and a server action.

**Note for whoever picks this up:** `CLAUDE.md` advertises an
`add-pipeline-stage` skill and it does not exist — only `add-achievement` is in
`.claude/skills/`. Adding the stage by hand is fine; the stale registry is worth
a line in the PR.

---

## PR 5 — The leaderboard

**Branch `hub-leaderboard`.** Last, deliberately.

ADR 0015 first, because this is the first cross-user read in the project and
invariant #10 says every table is RLS'd to its owner with no service role in
application code.

- A `security definer` **view** exposing **display name and XP total only** — no
  email, no `user_id`, no set history.
- **Opting out is a `users` column**, so a second migration. A leaderboard
  nobody can leave is not acceptable, and the default for a user who has set no
  display name has to be answered explicitly rather than leaking an email local
  part.
- `tests/db/` asserts the thing PLAN.md phase 6 asks for in as many words: a
  query as user A returns user B's display name and XP **and nothing else**, and
  an opted-out user does not appear at all.

---

## Verification

Each PR: `npm run verify`, `npm run test:db`, `npm run build`, then the browser
at 375×812 for anything with a surface.

| Change      | The check that matters                                                                     |
| ----------- | ------------------------------------------------------------------------------------------ |
| Level       | Property tests: monotonic in XP, never negative, UI figure agrees with the boundary        |
| Accept      | `tests/db/` — accepting someone else's challenge does nothing; a second press does nothing |
| Graph       | Browser at 375×812: a lift with several sessions, a lift with one, a lift with none        |
| Chat        | The adversarial suite, with the escapes that got through written down                      |
| Leaderboard | `tests/db/` — user A sees name and XP only; an opted-out user is absent                    |

Per the standing workflow: branch, PR, **reviewers**, merge only when green and
clean, then delete the branch.

---

## Outcome

Written 2026-09-09, after the fact, which is later than it should have been —
this plan shipped without one while `phase-5-content-fill.md` kept a detailed
record per PR. The entries below are shorter than that file's for the same
reason: they are reconstructed from the merged work rather than written while it
was fresh, so they say what shipped and where it diverged, and do not pretend to
recall the review rounds in detail.

All five merged on 2026-09-07, and all three
[decisions taken before planning](#decisions-taken-before-planning) survived
contact. What diverged was in PR 4's body rather than in that list — see below.

### What diverged from the plan

**The plan is requested, not served — and there is no button** (PR 4). The plan
said `/coach` gets a **Create a plan** control. Nothing in the application
creates a plan: a planner run is up to three planner+critic round trips at
25–120 s each, which does not fit inside a serverless function, and making it fit
means a job queue that `CLAUDE.md` puts out of scope. So the control reads **Show
my plan**, and when no plan exists the card explains where plans come from rather
than offering a button that would dead-end.
[`docs/specs/coach-chat.md`](../specs/coach-chat.md) §1 carries the argument.

**The ADR numbers moved.** The chat ADR is 0015, not the 0014 this plan names —
the progression chart took 0014 while the chat branch waited — so the leaderboard
became 0016. Recorded in the comment above the title as well, because that is
where a reader starts.

**Level arrived as planned** (PR 1) — `levelForXp` in `src/gamification/level.ts`,
pure and unit-tested, with the curve written into
[`docs/specs/xp-and-challenges.md`](../specs/xp-and-challenges.md) before the
code. It then sat at level 1 for every seeded user for a day, until
[`phase-5-content-fill.md`](phase-5-content-fill.md) PR 7 gave the demo database
XP — a working feature reading a database that had never had anything to read.

### What the plan did not anticipate

Four follow-up PRs came straight out of using what these five built, and none of
them is in the sequence above:

|                                                     |                          |                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#15](https://github.com/haimlevtov/Samson/pull/15) | `profile-settings-route` | Settings moved from a disclosure on Profile to its own route. The `<details>` this plan argued for worked and was in the wrong place; `/settings` is an address people can say out loud, and ADR 0013 gained an amendment. It also brought `OWNED_BY` in `src/ui/tabs.ts`: a route no tab owns lit no tab at all. |
| [#16](https://github.com/haimlevtov/Samson/pull/16) | `active-session-routing` | A workout in progress was landing in History with no route back into it, and both start actions could insert a duplicate row. See [`phase-5.md`](phase-5.md), which tables the same PR.                                                                                                                           |
| [#18](https://github.com/haimlevtov/Samson/pull/18) | `project-skills`         | `CLAUDE.md` advertised four skills and `.claude/skills/` held one — item 3 of the comment above this document's title, now closed.                                                                                                                                                                                |
| [#19](https://github.com/haimlevtov/Samson/pull/19) | `profile-card-spacing`   | Layout, once Profile actually held everything ADR 0013 moved onto it.                                                                                                                                                                                                                                             |

The pattern is worth naming: **a tab rework is not finished when the tabs are
right.** Each of these was invisible until there were enough surfaces for the
navigation to be wrong about.

### Delivered, including the part that is easiest to quietly skip

**The adversarial suite records what got through.** [ADR 0005](../adr/0005-llm-safety.md)
§5 asks for the escapes and not only the blocks, and the Verification table above
repeats it. Both exist as named `describe` blocks:
`src/chat/reply.test.ts` — "what this stage does NOT stop, recorded rather than
implied", five escapes each with its reason — and `src/llm/safety.test.ts` —
"scanOutput — what it does NOT catch, recorded honestly".

> **A first draft of this Outcome listed this as still open, and cited ADR 0015
> §5.** Both halves were wrong: 0015 §5 is the bounded context window, the
> escapes requirement is ADR **0005** §5, and the record had shipped — three
> documents already said so, including this file's own Verification table.
> Caught in review. Worth leaving visible, because a retrospective written from
> memory rather than from the code is exactly how a delivered requirement gets
> re-opened on paper.

### Still open from this plan

- **Topical confinement remains a judgement, not a control.**
  [ADR 0015](../adr/0015-coach-chat.md)'s "what this does not guarantee" section
  says so and nothing has changed it: there is no deterministic check for "is
  this about training". What is guaranteed is the refusal's wording, the absence
  of tools, and the numbers the coach may state — never that the classifier is
  right.
