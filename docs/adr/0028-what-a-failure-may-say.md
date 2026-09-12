# ADR 0028 — What a failed action may tell the user, and what it may log

**Status:** accepted
**Date:** 2026-09-12

> Written before the code it governs, in its own commit.

## Context

**This rule has been found in review six times and written down nowhere.** Each
time it was fixed at the one site the reviewer happened to be looking at:

| Found      | Site                                 | What leaked                                                    |
| ---------- | ------------------------------------ | -------------------------------------------------------------- |
| PR 2       | `app/settings/actions.ts`            | the whole error object, into the log                           |
| PR 4       | diet advisor                         | `LlmCallFailedError`'s `attempts`, each row carrying `user_id` |
| 2026-09-07 | `deliverForPersona`                  | `cause.message` verbatim to the browser                        |
| phase 6    | `loadEvidence` outside a `try`       | a raw Postgres message                                         |
| PR 7       | `app/workout/actions.ts` `explain()` | a raw database error                                           |
| PR 8b      | `requestPlan`                        | up to 500 characters of upstream provider body                 |

Six findings of one bug is not six bugs. It is a rule the codebase relies on,
enforces by habit, and states in comments that each cite a different earlier
incident — so the seventh site will get it wrong too, and the reviewer who finds
it will have nothing to cite but another comment.

Two things make this worth an ADR rather than a lint rule. The decision is about
**which** errors are the user's business, which is a judgement about meaning and
not a pattern a matcher can see. And the reasoning behind the two halves is
different: one is about reconnaissance, the other about a specific field on a
specific error class.

## Decision

**An action tells the user one of three things, and nothing else.**

### 1. Verbatim, because the message is for them

Two error classes, and the test is whether the user can act on it or is entitled
to it:

- `MissingApiKeyError` — says exactly what to do, names no internals, and is the
  common case in development.
- `BudgetExceededError` — reports the user **their own** weekly spend against
  their own ceiling. Withholding it would make a refusal look like a bug.

**A third class may be added only by arguing it past that test**, in this ADR.
Growing the list by adding a `catch` branch somewhere is how the list stops
meaning anything.

### 2. A code-owned sentence, for everything else

Not the message, not a prefix of it, not "the error was: …". A sentence this
project wrote, which says what the user can do next.

**WHY, and it is reconnaissance rather than any single disclosure.** A raw error
hands over table names, column semantics, constraint names, model ids, provider
names, quota text and — on an HTTP failure — up to 500 characters of the upstream
response body, which providers commonly fill with the request they rejected. Any
one of those is close to harmless. In quantity, from a surface somebody can poke
repeatedly, they are a free map of infrastructure the user cannot otherwise see.

**A length bound is not a content bound.** `LlmCallFailedError.message` is
capped; what it is capped to is still the provider's words. This distinction is
what the PR 8b finding turned on — the code had a comment asserting the gateway
"already bounds" the string, which was true and irrelevant.

### 3. Nothing at all, where a figure survives the failure

The diet target renders whether or not a model could be reached, because it was
computed first. A failure there loses the sentence, not the answer, and saying
"that did not finish" beside a figure that plainly did is worse than silence.

### And what goes in the log: the NAME and a bounded message, never the object

```ts
console.error(
  'what failed',
  cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : 'unknown'
);
```

**WHY never the object.** `LlmCallFailedError` declares
`attempts: LlmCallInsert[]`, an enumerable own property, and Node prints those
after the stack. Every one of those rows carries `user_id`. So
`console.error(cause)` wrote the user's auth UUID into the server log up to three
times per failure, plus the upstream body — which for the coach box means free
text this project's own adversarial list shows can be a health disclosure.

**WHY the name matters as much as the bound.** `LlmCallFailedError` versus
`SafetyBlockedError` versus a Postgres error is the whole diagnosis, and it is
the part a generic user-facing sentence necessarily discards.

## Consequences

- The judgement lives in one tested module rather than in six `catch` blocks that
  each got it right by copying the last one. `src/llm/failure.ts` is pure — no
  key, no network, no database — which is the same treatment `src/speech/refusal.ts`
  got for the same reason in ADR 0025.
- **The existing sites are not rewritten by the change that adds it.** They are
  correct today, and a refactor of five working `catch` blocks is a large diff
  with no behavioural content, on code that was reviewed recently. New and fixed
  sites use the module; the rest adopt it when they are next touched.
- A `redirect()` must stay **outside** the `try`. Next.js implements it by
  throwing, so catching it turns a navigation into a rendered error — the reason
  every action in this codebase resolves the user before opening its `try`.
- This does not make error handling a solved problem. It makes the DECISION
  written down, so the next reviewer cites a document rather than a comment about
  a different incident.
