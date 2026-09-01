# ADR 0004 — Planner and critic: an evaluator-optimizer with a deterministic floor

**Status:** accepted, phase 2
**Date:** 2026-09-01

## Context

PLAN.md requires this document **before any agent runs**. That ordering is the
point: a coordination standard invented after the code has run bends to fit the
code it was meant to judge, and by then the arrangement is whatever happened to
work rather than whatever was decided.

Phase 2 has to turn a user's history into a training block that is safe to
follow. Two things make that harder than a single prompt:

1. **A plan can be well-formed and wrong.** Schema validation is a shape check.
   A block prescribing twenty sets of squats parses perfectly. No amount of
   schema rigour distinguishes it from a sensible one.
2. **A model asked to enforce a numeric cap will usually enforce it.** Usually
   is the problem. The failure is fluent — a confident, well-structured answer
   that quietly exceeds the cap — and it is indistinguishable from success
   without independently doing the arithmetic.

## Decision

### The pattern: evaluator-optimizer, with a deterministic gate in front

One agent produces, a second judges, the first revises until the work passes.
It suits work where quality outweighs latency, which this is — a training block
is generated rarely and followed for weeks.

The arrangement is **not** two models alone. Deterministic rules run first:

```
candidates (SQL) → planner (LLM) → rules (code) → critic (LLM) → accepted
                        ↑                │            │
                        └────────────────┴────────────┘
                          structured rejections, max 3 iterations
```

### Each participant

| | Role | Input | Output | Boundary — what it may not do |
| --- | --- | --- | --- | --- |
| **Candidate query** | Decide what this user *can* do | `user_id` | Exercise list, equipment-filtered in SQL | Never ranks or programmes |
| **Planner** (`claude-sonnet-5`) | Choose and arrange work | Metrics, goal, days, candidates, prior rejections | `TrainingBlock` | May not invent an exercise outside the candidate list; may not compute a metric |
| **Rules** (`src/planner/rules.ts`) | Enforce every limit expressible as arithmetic | Block + context | `RuleFinding[]` | No judgement, no I/O, no model |
| **Critic** (`gemini-2.5-flash`) | Judge what arithmetic cannot — is this sensible training *for this person* | Block + context | `CriticVerdict` | May not re-check what the rules already checked; cannot approve past a rule failure, because it never sees a plan that failed one |

### Rules run before the critic

Cheap gates first, the same ordering as PLAN.md's merge gate. A plan breaching a
volume cap is definitively bad; paying a model to re-derive what arithmetic
already knows spends tokens to reach a worse-founded version of the same answer.

The consequence worth stating plainly: **the critic is never the last line of
defence on anything numeric.** It adds judgement on top of a deterministic
floor. It does not replace the floor, and a jailbreak that persuades the critic
still meets the rules on the way out.

### The critic runs on a different model from the planner

Already encoded in `src/llm/models.ts` and asserted by test. A critic sharing
the planner's weights shares its blind spots and rubber-stamps the same unsafe
block with the same confidence that produced it.

### Handoffs carry structure, never prose

Rejections cross every boundary as arrays of `{ code, detail }`, serialised as
JSON. Never as a sentence.

Prose handoffs lose the shape, and the receiving stage reconstructs it by
guessing — occasionally wrong, always silently. Structure is also what makes
phase 3's invariant testable: "the persona layer cannot alter a number" is only
assertable if the number arrives in a field rather than in a paragraph.

### Failure: escalate rather than repeat

The gateway already retries a schema-invalid response with the validation error
attached, up to `DEFAULT_MAX_ATTEMPTS`. What it cannot do is change model — its
`models` array is an OpenRouter fallback that fires on transport errors, not on
a response that parses as JSON but fails Zod.

So the **loop** escalates. A block that has already been rejected twice gets one
final iteration against an explicitly stronger model, passed as a `models`
override. Asking the same model the same question a third time mostly buys a
third copy of the same answer.

If the third iteration also fails, the run terminates as `exhausted` and the
user is told the coach could not produce a safe plan. It does not fall back to
an unvalidated block. A plan that failed its gates is not a degraded plan; it is
a plan that must not be followed.

### Every outcome is recorded, and the two rejection sources are never merged

`llm_calls` records calls. It cannot record this: a rule rejection is not a call
and would have no row. So `plan_runs` holds one row per generation, with a
`rejections` array in which every entry is tagged `rules` or `critic`.

Keeping them distinct is what makes the arrangement measurable rather than
merely present. "The critic rejected 40% of plans" and "arithmetic rejected 40%
of plans" describe different systems and imply opposite next moves — the first
says the planner prompt is weak, the second says the rules are doing the job the
critic was going to be trusted with.

## Consequences

**What it costs.** Two model calls per iteration instead of one, up to three
iterations, plus a possible escalation to a more expensive model — a worst case
around 6× the token cost of a single unchecked generation. Latency is seconds,
not milliseconds. This is the cost the phase's cascade analysis exists to
measure, and it is why `prompt_prefix_hash` has been written on every call since
phase 0.

**What it buys.** Every numeric limit holds regardless of what any model says.
Rejections are attributable to a source. The planner's prompt can be changed
without weakening a single safety guarantee, because none of them live in a
prompt.

**What it does not buy.** The critic is a model and can be wrong in both
directions. It can approve a block that is dull, badly sequenced, or poorly
matched to the user's goal — none of which any rule catches. The floor is a
floor, not a ceiling.

**Testability.** The loop takes `callLLM` as an injected dependency, exactly as
the gateway takes `fetch`. The entire arrangement — iteration control, rule
enforcement, rejection routing, escalation — runs in the unit suite against a
scripted model with no key, no network and no database.

## Notes

`src/planner/rules.ts` has its tests written by a separate author working from
`docs/specs/planner-rules.md` alone, without sight of the implementation.

FRAMING.md records "I wrote every test for my own code" as a method assumption
in conflict with the course, and the rules module is where that costs the most:
a rule and a test derived from the same reading of the requirement agree with
each other whether or not either is right. Reading the implementation cannot
surface that. Reading only the specification can.
