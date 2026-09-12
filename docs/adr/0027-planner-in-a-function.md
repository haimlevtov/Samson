# ADR 0027 — Running the planner inside a serverless function, and what it costs

**Status:** accepted, rework plan PR 8b
**Date:** 2026-09-12

> Written before the code it governs, in its own commit.

## Context

**`docs/specs/coach-chat.md` §1 argued that this button should not exist**, and
the argument was not wrong:

> A planner run is up to three planner+critic round trips at 25–120 s each
> (`PLANNER_TIMEOUT_MS`), which does not fit inside a serverless function's
> ceiling, and making it fit means a job queue, which `CLAUDE.md` puts out of
> scope. So the button says what it does… the card explains where plans come
> from instead of offering a control that would dead-end.

Every clause of that is still true. What changed is a stakeholder decision —
recorded in `docs/plans/rework-hub-history-coach.md` PR 8 — to build it anyway,
**with the limits named rather than discovered.** This ADR is where they are
named, because a decision taken against a written argument should leave a record
that answers the argument rather than quietly deleting it.

The numbers that bound the problem:

| Thing                   | Value                                 | Where                 |
| ----------------------- | ------------------------------------- | --------------------- |
| Planner call timeout    | 120 s                                 | `PLANNER_TIMEOUT_MS`  |
| Critic call timeout     | 60 s (the default)                    | `DEFAULT_TIMEOUT_MS`  |
| Iterations per run      | 3                                     | `MAX_PLAN_ITERATIONS` |
| Worst case, one run     | **540 s**                             | 3 × (120 + 60)        |
| Vercel function ceiling | 60 s on the plan this project runs on | —                     |

So a run as the eval performs it exceeds the ceiling by roughly nine times, and
even a **single** planner-plus-critic iteration at its configured timeouts —
180 s — exceeds it by three. The gap is not a tuning problem.

Measured, against the figure `src/llm/config.ts` already records: generation runs
near 100 output tokens per second, and a four-week block is 1,500–2,500 tokens.
So the planner call is ~15–25 s of generation plus prompt processing, and the
critic's 1,500-token ceiling is ~15 s. **One iteration of a four-week block is
plausibly 40 s.** That fits, with no margin worth relying on.

## Decision

**The web run is a different shape from the eval run, and the difference is a
parameter rather than a second implementation.**

`generatePlan` gains an optional budget. The eval passes none and keeps exactly
today's behaviour; the server action passes one.

### 1. A wall-clock deadline for the whole run, not a per-call timeout

Capping each call is not enough, because the ceiling applies to their sum. The
budget carries a **deadline**, and before each call the loop gives that call
`min(its own default, the time left)`. When too little is left to be worth
starting, the run finishes as `failed` with a reason instead of starting a call
the function will be killed during.

**WHY this rather than a shorter `PLANNER_TIMEOUT_MS`:** that constant is right
for the eval, which has no ceiling and whose whole job is to find out what the
planner can do. Lowering it globally would make the graded eval worse in order
to fit a surface the eval does not run on.

**A deadline through `timeoutMs` alone is not a deadline, and the first version
of this ADR missed it.** `timeoutMs` is a **per-attempt** `AbortSignal.timeout`
in the gateway, which retries a timed-out call up to `DEFAULT_MAX_ATTEMPTS` (3)
with backoff. So a 45s allowance bounded one attempt and permitted ~136s — over
twice the ceiling it was written to fit inside, with the function killed, no
`plan_runs` row, no rendered state, and an in-flight attempt billed upstream
whose `llm_calls` row was never written. The budget therefore also caps
**attempts at 1**, and dividing the allowance by three was rejected: a third of
45s is 15s, which is the low end of a planner call's measured generation time, so
three attempts that each fit would each be certain to time out.

The cost is §2's cost again: a schema-invalid first response ends the run where
the eval would have retried it.

### 2. One iteration from the web, not three

A block the deterministic rules reject is reported as rejected. It is **not**
retried, because a second iteration cannot fit.

**That is the real cost of the ceiling, and it is worth stating as a product
consequence rather than a technical one:** the retry loop is the thing that makes
the planner trustworthy — ADR 0004's escalation, ADR 0008's correction channel —
and the web gets one shot at it. The user's "try again" is the retry, performed
by a human who chose to spend it, rather than one the function pays for silently.

### 3. A shorter block than the schema allows

The web asks for at most **four weeks**. `plannerInputSchema` admits 12 and
`trainingBlockSchema` admits 8; both remain as they are, because they bound what
is _valid_ rather than what this surface _requests_.

Generation time scales with output tokens and nothing else here does, so the
block length is the only lever that moves the deadline. Four weeks is also every
seeded block's length, so it is the shape the rules and the critic have actually
been exercised against.

### 4. Every terminal state renders a sentence, and none of them is a hang

`PlanRunResult.status` is already a closed union — `accepted`, `rejected_rules`,
`rejected_critic`, `exhausted`, `failed` — and each one maps to something the
card says. `docs/specs/mobile-interface.md` §4 requires every state to render
something; a spinner that stops is not a state.

### 5. No candidates, no call

`availableExercises` returns an empty list for a user with no `user_equipment`
rows, and invariant #5 means the planner selects only from that list. A run
against nothing cannot produce a valid block, so the action **refuses before
spending anything** and says what is missing.

This is not hypothetical: nothing but `scripts/seed.ts` writes `user_equipment`,
so every user who is not one of the five seeded archetypes has none. A picker is
a separate piece of work — the plan says so — and this refusal is what keeps the
gap from presenting as a failed plan.

> **Amended 2026-09-12:** the picker shipped, on `/settings` —
> [ADR 0029](0029-equipment-is-a-settings-question.md). The refusal stays exactly
> as decided, because a user can still have saved nothing and that is a real
> answer. What changed is that it is no longer a dead end: the card names
> `/settings` instead of saying the app does not collect an equipment list.

### 6. No queue

`CLAUDE.md` puts queues out of scope and that is unchanged. A queue is the
correct engineering answer to this problem and it is not the correct answer for
a project that runs once, for one demo, on free tiers.

## What this does not guarantee, stated plainly

| Claim                                              | Status                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The button never hangs                             | **Guaranteed, after a correction.** The deadline is enforced in the loop below the function ceiling — but the first version of this ADR expressed it only through a PER-ATTEMPT timeout, so it bounded one attempt at ~136s against a 60s ceiling. The web budget caps attempts at 1. See §1                    |
| A failure is always shown as a state               | **Guaranteed** — every status maps to a sentence                                                                                                                                                                                                                                                                |
| Pressing it produces a plan                        | **NOT guaranteed.** One iteration, no retry, and a deadline that can expire mid-generation                                                                                                                                                                                                                      |
| A plan it produces passed the rules and the critic | **Guaranteed** — the same code path the eval uses, with fewer attempts at it                                                                                                                                                                                                                                    |
| A rejected plan tells the user why                 | **Partly.** The card names which gate refused it and how many findings there were. The findings themselves are stored on the plan_runs row and **rendered nowhere** — FOUND IN REVIEW, this row said "stored and rendered", and the Hub list it pointed at belongs to the challenge validator                   |
| It costs nothing when it fails                     | **False.** A timed-out planner call is charged TIMEOUT_ASSUMED_COST_USD against the weekly budget — ADR 0007 — because it was billed upstream. **The user is NOT told**, and this row used to claim they were: no rendered string mentions the budget. The copy does say that a second press costs a second run |

**The honest summary: this is a button that sometimes does not work, shipped
deliberately, because a card explaining that plans come from a developer's
terminal is worse for the demo than a control that succeeds most of the time and
says so when it does not.**

## Consequences

> **Amended 2026-09-12, rework PR 8 — the days-a-week bound.** The block-weeks
> cap has a sibling this ADR never mentioned: `PLAN_DAYS_PER_WEEK`, which was
> `[2,3,4,5,6]` against a planner schema admitting 1 to 7. The reason given in
> code was that seven "leaves no rest day, **which the rules reject anyway**".
> That second clause was **false** — `src/planner/rules.ts` holds six rules and
> not one of them looks at rest — so an option the owner wanted was withheld
> behind a claim nothing enforced. It is 1 to 7 now, the same bound the schema
> has, so the two cannot disagree about what a week is.
>
> The reservation is recorded rather than acted on. `docs/FRAMING.md` names the
> user's body as a stakeholder that cannot complain, and seven days with no rest
> day is the kind of plan this project has been careful about. What still bounds
> it is arithmetic that runs either way: `acwr_band` and
> `weekly_volume_increase` cap how fast load climbs however many days it is
> spread over. So it is unwise rather than unsafe, it is the user's own
> training, and the control says what seven costs instead of pretending the
> option does not exist.

- `generatePlan` takes an optional fifth argument. Every existing caller is
  unchanged, and the eval must stay unchanged — it is a graded output.
- `app/coach/page.tsx` gains an explicit `maxDuration`. Relying on a platform
  default for the one thing this ADR is about would be leaving the binding
  constraint unstated in code.
- **The questionnaire's four questions are the four `ContextInput` fields the app
  cannot read:** goal, days per week, block weeks, injured joints. Equipment is
  **not** among them — it is filtered in SQL before the model sees anything
  (invariant #5) and arrives as pre-filtered candidates.
- The block-weeks question is capped at the web maximum, so the control cannot
  ask for something decision 3 will not request.
- **Unverified end to end until this is pressed against a real key**, and stated
  as such rather than implied: the eval has never run `--live` in CI, and a run
  from the web has never happened at all.
