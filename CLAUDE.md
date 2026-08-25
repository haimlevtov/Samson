# Samson — Agent Rules

Gamified strength-training app with an LLM coach. Class project.

- `docs/FRAMING.md` — the problem, the stakeholders, the three definitions of
  done, and the assumptions list. Read when a decision is disputed.
- `docs/PRD.md` — what the product is, who it is for, and what each surface owes
  them. Read before designing anything a user will see.
- `docs/PLAN.md` — the current phase and its acceptance criteria. Read before
  building.

These are referenced rather than inlined: this file loads on every turn, so it
carries only the rules that must never be skimmed. Everything else is fetched
when it is relevant.

## Architecture in one line

Deterministic code computes all numbers. The LLM interprets them, plans
within validated bounds, and speaks in a persona. It never calculates.

Pipeline: input → normalizer (LLM) → metrics engine (code) → planner (LLM)
→ safety critic (LLM + rules) → persona layer (LLM) → user.

## Invariants — do not violate without an explicit instruction to change them

1. **The LLM never computes a number.** e1RM, tonnage, XP, calories,
   streaks, achievement conditions are all deterministic code with unit
   tests. If a model is producing a figure the user sees, that is a bug.
2. **All LLM calls go through `src/llm/gateway.ts`.** No `fetch` to
   OpenRouter anywhere else. The gateway owns retries, fallback models,
   `max_tokens`, budget checks, schema validation, and token logging.
3. **Every gateway call writes a row to `llm_calls`.** No exceptions, including
   failed and retried calls.
4. **XP derives from adherence, never volume.** Volume-scaled XP rewards
   overtraining. Rest days maintain streaks. There is a weekly XP ceiling.
5. **The planner selects only from a pre-filtered candidate list.** Equipment
   filtering happens in SQL before the model sees anything.
6. **Diet outputs are clamped in code.** No prompt, persona, or user request
   can move the floor. The model explains the number; it does not choose it.
7. **Content lives in the database, not in code.** Achievements, personas,
   challenges, exercises, and progression nodes are rows.
8. **Units are stored canonically** (kg, cm, seconds). Convert at display only.
9. **Timestamps are UTC plus the user's IANA timezone.** Calendar-triggered
   achievements evaluate against the user's local date, never server date.
10. **RLS is on for every table.** Every table has `user_id`. Never bypass with
    the service role key in application code.

## Conventions

- TypeScript strict. Zod schemas are the single source of truth — derive TS
  types from them, and use the same schema for LLM structured output and
  runtime validation.
- Migrations only. Never modify the database by hand.
- Every feature ships with tests in the same commit.
- Tests must pass with no API key present. Mock the gateway in unit tests.

## Comment style

Comments explain **why**, not what. Tag the load-bearing ones so they survive
future edits:

```ts
// INVARIANT: <the rule> — see CLAUDE.md #<number>
// WHY: <the reasoning that isn't visible in the code>
// AI-NOTE: <what a future agent must also update when changing this>
```

Do not write comments that restate the code. Do not leave a stale comment in
place — update or delete it.

## Skills

Repetitive extensions have skills in `.claude/skills/`. Use them:

- `add-achievement` — new achievement row, predicate, test, humor tier
- `add-persona` — new coach persona config and eval entry
- `add-progression` — new node in an exercise progression tree
- `add-pipeline-stage` — new LLM stage, schema, token budget, fixture

## Local environment — leave nothing running

Development targets the **hosted** Supabase project. Docker's WSL2 VM costs
~9 GB on this machine and makes it unusable while it runs.

- **Stop everything you start, in the turn you start it.** Dev servers,
  containers, background jobs. Never end a turn with a process still alive.
- If Docker was started at all, `supabase stop && wsl --shutdown` before
  finishing. `supabase stop` alone reclaims almost nothing.
- Prefer the hosted project over a local stack. Only start Docker when a task
  genuinely cannot run against hosted, say so first, and stop it afterwards.

## Out of scope

Do not build: caching layers, queues, real-time sync, push notifications,
payments, containers, multi-region, load testing. This runs for one demo on
free tiers. Scaling work is explicitly deferred.
