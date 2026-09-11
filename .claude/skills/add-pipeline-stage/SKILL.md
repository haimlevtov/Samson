---
name: add-pipeline-stage
description: Add a new LLM stage to Samson's pipeline. Use when introducing any new call to a model — a new pipeline step, a new schema-validated completion, or a new surface that talks to the coach. Covers the LlmStage union, the model array, the token budget, the migration the type alone does not give you, and the tests that must ship with it.
---

# Adding a pipeline stage

A stage is one kind of call to a model: a Zod schema, a static system prompt, a
token budget, and a function that runs the loop with its I/O injected.

**Six things change, and one of them is a migration.** Skipping the migration
compiles, type-checks, passes the whole unit suite, and then fails on the first
real call.

## The order that avoids rework

### 1. The stage's identity — three files, all small

**`src/llm/types.ts`** — add the name to `LlmStage`:

```ts
export type LlmStage =
  | 'normalizer'
  | 'planner'
  /** One line on what this stage is for, and the ADR if it has one. */
  | 'yourstage'
  | 'smoke';
```

**`src/llm/models.ts`** — add a fallback array to `STAGE_MODELS`. It is a
`Record<LlmStage, …>`, so the compiler will demand this.

> Every slug there was checked against OpenRouter's `/models` endpoint for
> `structured_outputs` support. A model without it fails **every** call in the
> stage, and `provider.require_parameters` turns that into a routing error
> rather than a silent plain-text response. Reuse a slug already in the file
> unless you have checked a new one the same way.

**`src/llm/config.ts`** — a `*_MAX_TOKENS` constant. Say in the comment what
the expected output size is and why the ceiling is where it is. A ceiling far
above the expected size is a safety net, not a target.

### 2. The migration — the step that is easy to miss

`llm_calls.stage` is a **CHECK constraint**, not an enum derived from anything.
The TypeScript union and the database's list are two copies of one fact.

```sql
alter table public.llm_calls
  drop constraint if exists llm_calls_stage_check;

alter table public.llm_calls
  add constraint llm_calls_stage_check
  check (stage in ('normalizer', …, 'yourstage', 'smoke'));
```

**Why this is called out first rather than last.** Adding `chat` to `LlmStage`
without this passed typecheck, lint and 757 unit tests, then failed on the first
live message with `violates check constraint "llm_calls_stage_check"`. The unit
suite mocks the gateway, so it never inserts a row and can never catch it.

Invariant #3 means a call whose ledger row will not insert is a call that
**fails** — the right behaviour, and it makes the whole stage dead until the
migration lands.

`tests/db/schema-invariants.test.ts` now asserts the constraint and the
`LlmStage` union admit exactly the same set, in both directions. If you add the
type and not the constraint, that test fails — but only in the db job, which
needs Postgres.

### 3. The schema — `src/<stage>/schema.ts`

A `z.strictObject`. Derive the TS type with `z.infer`; never hand-write a
parallel interface.

Field order can matter. In the chat stage `on_topic` is declared before `reply`
so a model generating in order commits to the classification before writing the
answer. If ordering carries meaning like that, say so in a comment — it reads as
cosmetic otherwise and will be "tidied".

### 4. The prompt — `src/<stage>/prompts.ts`

**INVARIANT: static first, dynamic last.** `CallOptions.system` is a constant
per stage; everything per-call goes in `messages`. This is CLAUDE.md #11 and
ADR 0005 §1, and `tests/unit/invariants.test.ts` fails on any `system:` built by
interpolation anywhere in the codebase.

- Untrusted text goes through `fenceUntrusted` — user input, catalogue text,
  anything from a database column somebody else wrote.
- **Corrective feedback does not.** ADR 0008: a correction is your own
  instruction and belongs in the trusted region. Fencing it tells the model to
  fix a violation and to ignore the request in the same payload.
- The gateway prepends `SAFETY_PREAMBLE` itself, so a new stage cannot forget
  it. Do not paste conduct rules into your system prompt.

### 5. The stage — `src/<stage>/<name>.ts`

Inject the caller; never import `callLLM` directly:

```ts
export async function runStage(
  userId: string,
  input: StageInput,
  deps: { call: LlmCaller }
): Promise<StageResult> {
```

`LlmCaller` is in `src/planner/types.ts`. CLAUDE.md #2 is satisfied by the
*binding*, which happens in the server action — `callLLM(options, createGatewayDeps(...))`.
Importing the gateway into the stage puts its I/O inside the unit under test.

Follow `src/persona/deliver.ts` or `src/chat/reply.ts` for the retry shape: a
bounded loop, a correction message appended on rejection, and **no fallback to
unchecked output** when the loop is exhausted. A result that failed its guard is
not a degraded result; it is one the user must not be shown.

### 6. Tests — same commit, no API key

`vitest.config.ts` includes `src/**/*.test.ts`. Build a scripted caller that
returns literals, like `harness()` in `src/chat/reply.test.ts`, and assert:

- the happy path returns the model's output
- each guard rejects, retries with a correction naming the problem, and gives up
  into a **code-owned** result rather than raw output
- `stage`, `maxTokens` and a non-interpolated `system` are what got sent

**If the stage takes free text from a user, the adversarial suite grows too.**
ADR 0005 §5 requires it every phase, and the report records what **got
through**, not only what was blocked — write those as passing tests that assert
the hole.

## A stage that does not return text

The `speech` stage (ADR 0025) returns audio, and most of the list above does
not apply to it: no schema, no system prompt, no `scanOutput` — there is no
completion to scan — and no `max_tokens`. It goes through its own entry point,
`callSpeech` in `src/llm/gateway.ts`, which shares what CLAUDE.md #2 and #3 are
about: the key, the budget gate, retries and a ledger row per attempt.

What still applies: **step 1** (`LlmStage`, `STAGE_MODELS`, a bound in
`config.ts` — for speech an input ceiling, not a token one), **step 2** (the
constraint migration, unchanged) and **step 6** (a scripted fetch, no key).
Two things are new, and both cost something to forget:

- **A provider that reports no price** leaves `cost_credits` null. Never put an
  estimate in the row; add the stage to `chargedFor` in `src/db/ledger.ts` so
  the budget gate charges an assumption, as it does for timeouts.
- **`tests/unit/invariants.test.ts` names the gateway's entry points.** A new
  exported `call*` function fails it until it is added there on purpose.

## Before you call it done

```bash
npm run verify && npm run build
```

`npm run test:db` needs Postgres and is where the constraint is checked. If you
cannot run it, say so rather than implying the migration is verified — CI is
then its first execution.

## The check that catches the common mistake

If your stage is in `LlmStage` and not in the CHECK constraint, this fails:

```bash
npx vitest run --config vitest.db.config.ts tests/db/schema-invariants.test.ts
```

## Related

- `docs/adr/0001-llm-gateway.md` — why every call goes through one door
- `docs/adr/0005-llm-safety.md` — the five layers, and which are code
- `docs/adr/0008-correction-channel.md` — why corrections are not fenced
- `docs/adr/0015-coach-chat.md` — the most recent TEXT stage, and a worked example
  of confining one whose input has no shape
- `docs/adr/0025-coach-voices.md` — the stage that returns audio, and the
  price the provider does not report
