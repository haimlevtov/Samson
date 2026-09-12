# ADR 0028 — What a failed action may tell the user, and what it may log

**Status:** accepted, unplanned — a queued fix to `parseFreeText`, not a plan item
**Date:** 2026-09-12

> Written before the code it governs, in its own commit.

## Context

**This rule has been found in review at least eight times and written down
nowhere.** Each time it was fixed at the one site the reviewer happened to be
looking at:

| Found      | Site                                 | What leaked                                                    |
| ---------- | ------------------------------------ | -------------------------------------------------------------- |
| PR 2       | `app/settings/actions.ts`            | the whole error object, into the log                           |
| PR 4       | diet advisor                         | `LlmCallFailedError`'s `attempts`, each row carrying `user_id` |
| 2026-09-07 | `deliverForPersona`                  | `cause.message` verbatim to the browser                        |
| phase 6    | `loadEvidence` outside a `try`       | a raw Postgres message                                         |
| PR 7       | `app/workout/actions.ts` `explain()` | a raw database error                                           |
| PR 8b      | `requestPlan`                        | up to 500 characters of upstream provider body                 |

Eight findings of one bug is not eight bugs. It is a rule the codebase relies
on, enforces by habit, and states in comments that each cite a different earlier
incident — so the ninth site will get it wrong too, and the reviewer who finds it
will have nothing to cite but another comment.

_The first draft of this ADR said six, and the site it was written for was
"the sixth". Both were wrong: the table below lists eight, the `parseFreeText`
fix is the ninth site, and the miscount was caught in review of the very PR that
added this document. A file written to stop false claims is the worst place to
put one._

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

**And there already is a third, which the first draft of this ADR did not know
about.** `app/workout/actions.ts` and `app/settings/actions.ts` return **Zod
issue text** to the user, deliberately: a validation message names the field the
user got wrong and is the only thing that tells them what to fix. It passes the
test — the user can act on it — and it is written down here rather than left as
two `catch` branches nobody reconciled.

It is not in `src/llm/failure.ts` because that module's subject is a failed model
call, and a `ZodError` from a form is a different thing that happens to be an
error. Whichever module grows to cover form validation is where it belongs.

**`PostgrestError` is not an `Error` at all** — it is a plain object — so
`logLine` returns `'unknown'` for it, and `app/settings/actions.ts` logs
`{ code, hint }` under an AI-NOTE saying never to widen that. The module does not
express the repo's most common failure value, and that is a gap rather than a
decision.

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

### 3. A sentence that does not contradict a figure still on screen

The diet target renders whether or not a model could be reached, because it was
computed first. So the failure there says "the figures above are still yours" —
it loses the sentence, not the answer, and it must not say "nothing was saved"
beside a number the user can see.

_The first draft of this section said "nothing at all", which `askTheCoach` does
not do and should not: silence beside a figure reads as the figure being stale.
Caught in review — the ADR was describing an intention rather than the code it
called correct._

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
  got for the same reason. (Its rationale is in its own file header; an earlier
  draft of this line cited ADR 0025 for it, and ADR 0025 says no such thing.)
- **The existing sites are not rewritten by the change that adds it**, and they
  are not all correct either. Two log the whole object —
  `app/history/actions.ts`'s `award_session_xp` catch and `app/hub/page.tsx`'s
  leaderboard catch — and both are fixed by the PR that adds this ADR, because
  one of them is in the file that PR is about. Four more return `cause.message`
  after narrowing to the two allowed classes, which is correct behaviour reached
  by hand; they adopt the module when next touched.
  `app/history/[id]/SessionConsole.tsx` returns `cause.message` to the user
  unguarded, which `docs/specs/mobile-interface.md` §4 currently CONTRACTS FOR
  ("the server's message, inline"). That spec sentence and this ADR cannot both
  stand; reconciling them is not this change's to do, and it is named here so the
  next person does not have to rediscover it.
- **A length bound is acceptable in the log and not in the browser**, and the
  asymmetry is deliberate: a server log is read by the person who owns the
  deployment, and the 200 characters exist to stop one failure filling a file
  rather than to protect anybody from the content. Worth knowing that the bound
  is also weaker than it looks — `row.error` is 500 characters for an HTTP body,
  1,000 for a schema failure, and **unbounded** for a provider error inside a 200
  envelope.
- A `redirect()` must stay **outside** the `try`. Next.js implements it by
  throwing, so catching it turns a navigation into a rendered error — the reason
  every action in this codebase resolves the user before opening its `try`.
- This does not make error handling a solved problem. It makes the DECISION
  written down, so the next reviewer cites a document rather than a comment about
  a different incident.
