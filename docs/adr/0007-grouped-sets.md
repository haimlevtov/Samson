# ADR 0007 — Prescribe set groups, not individual sets

**Status:** accepted, phase 2 (revision) — **amended, see "Correction" below**
**Date:** 2026-09-01

## Correction — the diagnosis below was wrong about the cause

Everything measured in this ADR happened. The conclusion drawn from it did not
follow, and the record is amended rather than rewritten so the mistake stays
visible.

**The block schema was not why the planner could not finish.** After grouping
sets, the call still hit its ceiling. Reading the full usage breakdown rather
than the summary showed why:

```
completion_tokens          6000
completion_tokens_details.reasoning_tokens  6000     ← the entire budget
content chars              0
```

`anthropic/claude-sonnet-5` is a reasoning model and OpenRouter routes it with
extended thinking enabled by default. It was spending every token of
`max_tokens` on reasoning and emitting no answer at all. The 16,000 tokens in
the original measurement were 16,000 tokens of thinking, not an oversized block.

With `reasoning: { enabled: false }`, the same request, same schema:

```
HTTP 200 in 28.1s      (was 158s, then a timeout)
finish_reason  stop
completion     3834 tokens, reasoning 0
schema valid   true
cost           $0.064
```

**What I got wrong:** I read `finish_reason: "length"` with a large
`completion_tokens` and concluded the output was too big. Both facts were true
and the inference was not. The usage object had `reasoning_tokens` in it the
whole time; I did not look.

**What survives:** the schema change is kept, on its own merits rather than the
ones claimed below. Grouped sets are smaller, cheaper and a better description
of how a programme is actually written, and 3,834 completion tokens is
comfortably inside a 6,000 ceiling where the old shape would have been marginal.
But it was not the fix, and this ADR must not be cited as though it were.

**The real fix** is `reasoning: { enabled: false }` in `buildRequestBody`,
applied to every stage by default. The failure mode is silent and total — a
model that thinks until it runs out of budget returns HTTP 200 with an empty
answer — so the default is off and enabling it is a per-call decision.

The second finding below, about timed-out calls costing money the ledger never
records, is unaffected and stands.

---

## Context

`trainingBlockSchema` enumerated every prescribed set as its own object. Three
sets of five at 60 kg was three near-identical objects differing only in
`set_index`.

That shape was committed knowingly. The AI-NOTE on `prescribedExerciseSchema`
recorded the trade and deferred it:

> A `{ count, reps, weight_kg }` grouping would express "3×5 @ 60 kg" in one
> object and cut that by roughly three … Deliberately not changed mid-phase: the
> rules tests were already being authored against this shape by a separate
> author, and invalidating that work costs more than the tokens do. **Revisit
> before phase 3, with the measured cost in hand.**

The measurement now exists, and it says the note framed the problem wrongly.
This is not a cost trade. One real call, `anthropic/claude-sonnet-5`, one golden
case, a generous timeout:

```
HTTP 200 in 158.0s
prompt_tokens      12729
completion_tokens  16000     ← exactly max_tokens
finish_reason      "length"
content chars      0         ← truncated JSON, unparseable
cost               $0.185
```

**The model generated sixteen thousand tokens and had not finished a four-week
block.** Every attempt cost $0.185 and produced nothing usable, then died on the
60-second timeout. Fourteen consecutive planner calls behaved identically.

Raising `max_tokens` does not fix it. The output was still growing at 16k, and
each 60s of generation buys a few thousand more tokens of a structure that is
mostly repetition.

## Decision

**An exercise prescribes set _groups_.**

```ts
set_groups: [{ count: 3, reps: 5, weight_kg: 60, rpe: 8, rest_seconds: 120 }];
```

A ramp is several groups of `count: 1`. Straight sets are one group. The field
is named `set_groups` rather than `sets` on purpose — calling a group a set is
the kind of stale name CLAUDE.md's comment rules exist to prevent, and every
tonnage calculation now has to multiply before it sums.

Expected output for a four-week block falls from >16,000 tokens to roughly
1,500–2,500. That is the difference between impossible and routine, not a
saving.

### `set_index` is gone

It was the only thing distinguishing the repeated objects, and it was never
information — position in the array said the same thing. Materialising a block
into `sets` rows (phase 4's job) generates the indices, exactly as
`insertSet()` already does when logging.

## Consequences

- `TrainingBlock` changes shape, so `src/planner/rules.ts`, the golden set, the
  shared stub, the seeder and `src/persona/guard.ts` all move with it.
- **`src/planner/rules.test.ts` was written by a separate author against the old
  shape.** Its fixtures change; its assertions do not. That distinction is the
  point — the rules did not change, only the shape they read, so a test that
  needed its _expectations_ rewritten would have been evidence the change was
  bigger than claimed. None did.
- A group cannot express a set that differs from its neighbours in more than
  load — but nothing in the rules or the UI ever read that, and a ramp is still
  expressible as consecutive groups.
- The 12,729-token prompt is now the dominant half of the cost. The 120-candidate
  list is most of it, and `DEFAULT_CANDIDATE_LIMIT` is the next lever if cost
  needs reducing.

## The second finding, recorded here because the same run produced it

**A timed-out call costs real money and the ledger records nothing.**

|                      |          |
| -------------------- | -------- |
| `llm_calls` reported | $0.00005 |
| OpenRouter reported  | $0.5269  |

Fourteen timeouts, every one with `cost_credits` null, because the gateway
never reads a response and so has nothing to write. Invariant #3 is satisfied
in letter — a row exists per attempt — and defeated in spirit.

It matters beyond accounting. `sumSpendSince` reads `cost_credits`, so the
budget gate cannot see this spend **at all**, and a timeout loop is precisely
the runaway that gate exists to stop. It was blind to the one failure mode it
was built for.

**Fix:** the ledger keeps recording only measured cost — mixing estimates into
`cost_credits` would corrupt the token-economics deliverable, which is a graded
output. Instead `sumSpendSince` adds a documented, deliberately pessimistic
charge per timed-out row. The gate over-estimates; the analysis stays truthful.

**AI-NOTE:** `TIMEOUT_ASSUMED_COST_USD` is a guess, and it is a guess in the
safe direction. If the ledger ever gains a real figure for timed-out calls —
OpenRouter's generation lookup can supply one given an id, which a timeout does
not produce — delete the assumption rather than tuning it.
