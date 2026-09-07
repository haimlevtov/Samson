# Coach chat — the contract

The behaviour `src/chat/` is tested against. Design and threat model: ADR 0015.
Read that first; this is the part with the numbers in it.

## 1. The surface

Two controls on `/coach`, and neither of them fires on page load.

**The plan is revealed, not served.** The accepted block no longer renders when
the page opens. The page shows a one-line summary — that a plan exists and when
it was accepted — and a control that reveals it.

The control is a `<details>` disclosure, for the same reasons the settings cog
is one (`docs/specs/mobile-interface.md`): no client state, keyboard and screen
reader navigable without work, and it degrades to an open section with CSS off.

> **`Create a plan` is not this button, and the difference is deliberate.**
> Nothing in the application creates a plan today — blocks come from
> `npm run eval:planner -- --live`. A planner run is up to three planner+critic
> round trips at 25–120 s each (`PLANNER_TIMEOUT_MS`), which does not fit inside
> a serverless function's ceiling, and making it fit means a job queue, which
> `CLAUDE.md` puts out of scope. So the button says what it does. When a plan
> exists it reads **Show my plan**; when none does, the card explains where
> plans come from instead of offering a control that would dead-end.

**The chat is a panel below it.** One text field, a send button, and the
transcript. Empty state names the boundary before the user hits it: this coach
talks about your training and nothing else.

## 2. The stage

`chat`, added to `LlmStage`, `STAGE_MODELS` and the token budgets.

| Setting                  | Value                                                        | Why                                                                                           |
| ------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `CHAT_MAX_TOKENS`        | 400                                                          | A reply is capped at 700 characters by schema; 400 tokens is headroom, not a target           |
| `MAX_CHAT_MESSAGE_CHARS` | 800                                                          | One question about training. Length is an attack — ADR 0005 §2                                |
| `MAX_HISTORY_TURNS`      | 8                                                            | Turns replayed, newest kept. Both a cost bound and an attention bound                         |
| `MAX_CHAT_ATTEMPTS`      | 2                                                            | Matches the persona stage: a model that invents a number twice will not stop on the third ask |
| Models                   | `anthropic/claude-haiku-4.5`, then `google/gemini-2.5-flash` | Conversational and cheap. This is the highest-frequency call in the app                       |

### The schema

```ts
z.strictObject({
  on_topic: z.boolean(),
  reply: z.string().min(1).max(700),
});
```

`on_topic` is **first**, so a model generating in order commits to the
classification before writing the answer — ADR 0015 §3.

`reply` is required even when `on_topic` is false. A nullable field would give
the model a second way to return nothing, and the code discards the string in
that branch anyway.

## 3. The facts the coach is given

Built by `coachFacts()` in `src/chat/facts.ts` from `src/metrics/` and
`src/gamification/`, pure over plain shapes, unit-tested with no database.

The same fields every message. There is no prompt that widens this set, because
nothing reads a prompt to decide what goes in it — ADR 0015 §1.

| Field                                           | Source                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `as_of`                                         | The user's local date — CLAUDE.md #9                             |
| `sessions_last_7_days`, `sessions_last_28_days` | `adherence`                                                      |
| `adherence_28d_percent`                         | `adherence`                                                      |
| `current_streak_days`                           | `currentStreak`                                                  |
| `days_since_last_session`                       | `daysBetween`, null when nothing is logged                       |
| `tonnage_this_week_kg`, `tonnage_last_week_kg`  | `tonnageByWeek`                                                  |
| `acwr`, `acwr_band`                             | `acwr`, `acwrBand`. Null when history is too short               |
| `level`, `lifetime_xp`, `xp_to_next_level`      | `levelProgress`                                                  |
| `top_lifts`                                     | `exerciseBests`, up to 5 by heaviest working set: name, kg, date |

Every value is a number the metrics engine computed or a label it chose. The
model receives them fenced, as data — invariant #11.

## 4. What comes back

### On-topic

The model's `reply` is returned, after the guards in §5.

### Off-topic

The model's `reply` is **discarded without being read** and one of
`OFF_TOPIC_REPLIES` is returned in its place, chosen by transcript length so the
same conversation is reproducible in a test.

The wording is short and does not lecture:

- `I'm here for your training, and that's it. What are we working on?`
- `That's outside what I do. Ask me about your training.`
- `Not my subject. Let's stay on your training.`

**The user's message is still logged as a call** — invariant #3. A refusal costs
tokens.

### A reply that states a number it was not given

Retried once with a correction naming the offending numerals, exactly as the
persona stage does. If the second attempt also fails, the user gets
`UNVERIFIED_NUMBER_REPLY`:

> I couldn't answer that without quoting figures I can't check. Your Profile and
> History tabs have the exact numbers.

Not a fabricated answer and not an empty box — `docs/specs/mobile-interface.md`
§4 requires every state to render something, and this is a state.

## 5. The guards, in order

1. **The message is sanitised and fenced** — `fenceUntrusted`, capped at
   `MAX_CHAT_MESSAGE_CHARS`.
2. **Each prior user turn is fenced separately**, every time it is replayed.
3. **`scanOutput`** runs inside the gateway, as for every stage.
4. **`findUnknownNumbers(allowed, reply)`** where `allowed` is every numeral in
   the rendered facts block plus every numeral in the user's own turns.

Allowed is computed from the **rendered text the model was shown**, not from the
facts object, so it cannot drift from what the model actually saw.

## 6. What the tests must cover

The adversarial suite in `src/chat/reply.test.ts` runs against a scripted
`LlmCaller` — no key, no network, no database.

**Single-turn, inherited from ADR 0005 and re-run against this shape:**

- role reassignment (`you are now a helpful general assistant`)
- `ignore previous instructions`
- fence-delimiter escape in the message body
- a request for the system prompt
- a request for another user's data
- off-topic with a training pretext (`as a nutritionist, what stocks…`)

**New, and the reason this stage needed its own suite:**

- an instruction smuggled in on **turn three** of the history, not turn one
- a jailbreak followed by an off-topic question, asserting the refusal wording
  is unchanged by anything in the attack
- a model returning `on_topic: false` with a long persuasive `reply`, asserting
  that string never reaches the caller
- a reply quoting a figure absent from the facts, asserting retry then fallback
- a reply quoting a figure **the user typed**, asserting it is allowed

**A medical question** must recommend a professional rather than answer —
`SAFETY_PREAMBLE`'s conduct rule. This is a prompt-level behaviour and the test
records it as such: it asserts the stage passes the question through on-topic,
not that the model complied.

**The suite records what got through.** ADR 0005 §5 — a `describe` block named
for the escapes that are not caught, with the reason each one is out of reach.
