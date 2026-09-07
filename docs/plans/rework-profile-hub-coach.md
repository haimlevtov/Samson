<!--
Committed 2026-09-07, at the start of PR 4, which is later than it should have
been: PRs 1 to 3 of this sequence were already merged. It is recorded verbatim
as it was approved rather than backdated or tidied, so the trail shows what was
actually decided up front and what was decided along the way. Two things moved
after approval and are corrected in the documents that supersede them, not here:
the chat ADR is 0015 rather than 0014 (the progression chart took 0014), and
the leaderboard ADR is therefore 0016.
-->

# Rework — profile, hub, history graphs, and a coach you can talk to

Five changes, five branches, in this order. `main` is green at `c4e18ff` and the
phase plan stays paused.

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
