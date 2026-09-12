# Coach chat — the contract

The behaviour `src/chat/` is tested against. Design and threat model: ADR 0015.
Read that first; this is the part with the numbers in it.

## 1. The surface

_Rewritten 2026-09-12 for rework plan PR 8a — [ADR 0015 §6](../adr/0015-coach-chat.md#amendment-2026-09-12--6-one-box-three-answers).
It described four controls, a chat panel and a supplement card; the panels are
one box now. What the previous version said about the plan disclosure and the
`/evidence` link is unchanged and is kept below._

**One question box on `/coach`**, and nothing on the page fires on load.

The box answers three kinds of question — training, diet, and what the evidence
table says about a supplement — and which one it is answering is a **route the
model names, checked by that route's own guard in code**. It is a mitigation and
not a control: a wrong route is a worse answer, never an unsafe one. §4 and ADR
0015 §6 say why.

**Why one box rather than three.** Three fields asked the user to classify their
own question before typing it, and the classification was ours to make. A user
who wants to know whether to eat more on a heavy week does not know, and should
not have to know, that the app has a diet stage and a chat stage.

**The diet figures keep their own surface, above the box.** The goal selector
and the target are computed and rendered without a model — CLAUDE.md #6 — and
putting a number the app is certain of behind a question box would make it
conditional on asking.

**The plan is revealed, not served.** The accepted block no longer renders when
the page opens. The page shows a one-line summary — that a plan exists and when
it was accepted — and a control that reveals it.

The control is a `<details>` disclosure: no client state, keyboard and screen
reader navigable without work, and it degrades to an open section with CSS off —
`docs/specs/mobile-interface.md`.

> This deliberately does **not** cite the profile settings cog as precedent.
> That cog is becoming a link to its own `/settings` route, which is the right
> shape for a whole page of controls and the wrong one for revealing a block
> that is already on this page.

> **`Create a plan` is not this button, and the difference is deliberate.**
> Nothing in the application creates a plan today — blocks come from
> `npm run eval:planner -- --live`. A planner run is up to three planner+critic
> round trips at 25–120 s each (`PLANNER_TIMEOUT_MS`), which does not fit inside
> a serverless function's ceiling, and making it fit means a job queue, which
> `CLAUDE.md` puts out of scope. So the button says what it does. When a plan
> exists it reads **Show my plan**; when none does, the card explains where
> plans come from instead of offering a control that would dead-end.
>
> **Amended 2026-09-12, rework PR 8b: the button exists now, and every clause
> above is still true.** It was built on a stakeholder decision taken against
> this argument, and [ADR 0027](../adr/0027-planner-in-a-function.md) is where
> the limits are named rather than discovered. What makes it fit: **one**
> iteration instead of three, a **four-week** block instead of eight, and a
> wall-clock **deadline** enforced inside the planner loop so the function
> returns a state rather than being killed mid-call.
>
> The paragraph above stays because the reasoning it contains is what the
> amendment answers. Deleting it would leave the decision looking obvious, and
> it is not: **this button sometimes does not produce a plan**, by design, and a
> failed attempt still costs the user budget. Where a plan exists the control
> still reads **Show my plan**; where none does, the card now offers the
> questionnaire instead of explaining where plans come from.

**Save as a template** lives inside the plan disclosure — rework plan PR 7,
`docs/specs/workout-templates.md` §6. It exists only where there is a plan, so
it is not a control on the page so much as a control on the block.

**The box is below both.** One text field, a send button, and the transcript —
and, since rework PR 6, a voice switch above the field: off by default, for that
page only, naming whose voice the reply would be spoken in, and governing the NEXT
answer only. ADR 0031 carries the decision; its amendment carries this surface.
Empty state names the boundary before the user hits it: this coach talks about
your training, what to eat for it, and what the evidence table says about a
supplement. The empty state also says what the conversation does and does not
leave behind: **the transcript is not kept, and the coach may keep a short note.**

**Clear** appears once there is a transcript. It empties the visible
conversation; there is nothing to delete THERE, because the transcript is not
stored. _Notes are stored, and are deleted on Settings — ADR 0030 §4. Until
2026-09-12 this section said "nothing is stored", which was the whole truth then
and is not now._ It exists
because the transcript is re-sent with every message — so without it, a user who
has wandered somewhere unhelpful pays for that history on every subsequent turn
and cannot get out of it except by leaving the page.

**Supplements** stays in the page header. It is the only NAVIGATIONAL route to `/evidence` —
[ADR 0023](../adr/0023-evidence-rows.md) — and it is on Coach because a
supplement question is a coaching question that this coach cannot answer well.

_That reasoning survives the box being able to answer one._ The supplement route
returns **a row from the table**, chosen from an allowlist and rendered by code;
the link goes to the whole table, with the papers attached. One is an answer to
a question, the other is the evidence to read — and ADR 0023's position that the
model retrieves rather than summarises is what makes them different.

Stated carefully, because the obvious phrasing overclaims: the chat is confined
to training by a classifier, and [ADR 0015](../adr/0015-coach-chat.md) is
explicit that topical confinement is "a judgement, not arithmetic" and defence in
depth rather than a control. So this link is not a guarantee that the model will
refuse to discuss a supplement. It is somewhere better to send the user — a
table of claims with the papers attached — than whatever a model says off the
cuff about creatine.

## 2. The stage

`chat`, added to `LlmStage`, `STAGE_MODELS` and the token budgets.

| Setting                  | Value                                                        | Why                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHAT_MAX_TOKENS`        | 600                                                          | `reply` is capped at 700 characters and `remember` at 480 — about 300 tokens together, so 600 is headroom rather than a target. It was 400 until `remember` existed |
| `MAX_CHAT_MESSAGE_CHARS` | 800                                                          | One question about training. Length is an attack — ADR 0005 §2                                                                                                      |
| `MAX_HISTORY_TURNS`      | 8                                                            | Turns replayed, newest kept. Both a cost bound and an attention bound                                                                                               |
| `MAX_CHAT_ATTEMPTS`      | 2                                                            | Matches the persona stage: a model that invents a number twice will not stop on the third ask                                                                       |
| Models                   | `anthropic/claude-haiku-4.5`, then `google/gemini-2.5-flash` | Conversational and cheap. This is the highest-frequency call in the app                                                                                             |

**The ceiling is unchanged, and it had to be the largest of the three.** It was
already above the diet stage's 300 and the supplement lookup's 60, so the box
answers a diet question at least as fully as the panel it replaces did; the same
holds for the input cap, which was 800 against the diet question's 400, so no
question that fit before is rejected now. **Those three constants are deleted**
rather than left unreferenced — a ceiling nothing reads is a ceiling nobody is
held to, and the next editor would have had to work out which one the box
actually runs under.

### The schema

**Built per call from the rows the question is answered against**, the way the
supplement lookup's own schema was — `docs/specs/diet.md` §4b:

```ts
coachReplySchema(slugs) = z.strictObject({
  route: z.enum(['training', 'diet', 'supplement', 'off_topic']),
  reply: z.string().min(1).max(700),
  supplement_slug: z.enum([NO_MATCH, ...slugs]),
  remember: z.string().max(NOTE_SCHEMA_MAX_CHARS),
});
```

`route` is **first**, so a model generating in order commits to the
classification before writing the answer — ADR 0015 §3 and §6. It replaces
`on_topic`, which is now the `off_topic` member: one field deciding one thing,
rather than a boolean and an enum that could disagree.

**`supplement_slug` is an enum, not a string to be checked afterwards.** This is
ADR 0023's rule kept rather than restated: the allowlist **is** the schema, so a
slug the model invents fails the gateway's own validation and is retried, rather
than reaching a lookup and returning a silent null. A post-hoc membership test
would have been the weaker shape, and moving to one box is not a reason to
accept it. `NO_MATCH` is the member for "no row answers this", and it is what
every non-supplement route carries.

**Flat, not a discriminated union.** A union is the honest shape and compiles to
`anyOf` in JSON schema, which the structured-output modes across `STAGE_MODELS`
support unevenly — and `provider.require_parameters` turns an unsupported
keyword into a routing failure rather than a graceful degrade. A flat object
with every field required is what the existing stages already do, and the code
reads only the fields the route licenses.

`reply` is required even when the route is `off_topic`. A nullable field would give
the model a second way to return nothing, and the code discards the string in
that branch anyway.

**`remember` is declared LAST, and the position carries meaning like `route`'s
does** — ADR 0030 §1. What is worth keeping is a judgement about an answer, so
the model writes the answer first. It takes the empty string for "nothing", not
`null`, for the same reason `supplement_slug` takes `NO_MATCH`.

**Its schema bound is not its rule.** The schema admits four times
`MAX_NOTE_CHARS` so that an over-long note is DROPPED rather than failing
validation — a schema failure costs a whole retry, and the note is optional to
the question the user actually asked. The rule is `acceptableNote`, in
`src/chat/notes.ts`.

## 3. The facts the coach is given

Built by `coachFacts()` in `src/chat/facts.ts` from `src/metrics/` and
`src/gamification/`, pure over plain shapes, unit-tested with no database.

The same fields every message. There is no prompt that widens this set, because
nothing reads a prompt to decide what goes in it — ADR 0015 §1.

**The payload carries three more blocks, all built by code before the call.**
The model does not ask for any of them; they are there whichever route it takes.
Two are unconditional; the notes block is sent only when there is something to
remember, because an empty fenced array says nothing and costs tokens.

| Block                | What it is                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The diet categories  | `dietFacts()` — ADR 0024's **categories, never figures**. The target is computed by `computeEnergy` and rendered by the page, not by the model                                          |
| The supplement slugs | The `slug` column of the rows `loadEvidence` returns — RLS-scoped, shared rows only. The allowlist, and nothing else from the row                                                       |
| The notes            | What the coach has been told before — ADR 0030. `loadNotes` returns the newest `MAX_NOTES`; `notesBlock` sanitises each and caps the payload. **Sent only when there is at least one.** |

**Why unconditionally:** a route is only known once the answer comes back, and
both blocks are cheap and deterministic — pure arithmetic and one query the page
already makes. Preparing them for every question is what buys the single call
(ADR 0015 §6); fetching them after a route would mean a second one.

**The diet target is not in the payload**, and that is invariant #6 rather than
an omission. The model is given categories so it can explain a number it never
sees, and the number is on the screen beside its words. See `docs/specs/diet.md`
§4.

| Field                                           | Source                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `as_of`                                         | The user's local date — CLAUDE.md #9                             |
| `sessions_last_7_days`, `sessions_last_28_days` | `adherence`                                                      |
| `adherence_28d_percent`                         | `adherence`                                                      |
| `current_streak_days`                           | `currentStreak`                                                  |
| `days_since_last_session`                       | `daysBetween`, null when nothing is logged                       |
| `tonnage_this_week_kg`, `tonnage_last_week_kg`  | `tonnageForWeekOf`, 0 for a week with nothing lifted             |
| `acwr`, `acwr_band`                             | `acwr`, `acwrBand`. Null when history is too short               |
| `level`, `lifetime_xp`, `xp_to_next_level`      | `levelProgress`                                                  |
| `top_lifts`                                     | `exerciseBests`, up to 5 by heaviest working set: name, kg, date |

Every value is a number the metrics engine computed or a label it chose. The
model receives them fenced, as data — invariant #11.

`top_lifts[].name` is the exception worth naming: it is third-party catalogue
text, so it is sanitised and capped per field, and the digits inside it are not
quotable. See ADR 0015 §4.

## 4. What comes back

**And on two routes, a memory.** Beside the answer, a `training` or `diet` turn
may leave one `coach_notes` row — ADR 0030. `supplement` and `off_topic` may
not: neither reads the model's prose, and a memory harvested from a refused
message is a memory of an attempt to steer the coach. An exhausted guard loop
leaves none either, because the user never saw that answer.

**One of four, by route.** The guard that runs is the guard belonging to the
route the model named, and a retry that comes back on a **different** route is
checked by that route's guard rather than the previous one's — ADR 0015 §6. The
opposite would let a model escape the diet route's empty allowed set by changing
its mind about what the question was.

### `training`

The model's `reply` is returned, after the guards in §5.

### `diet`

The model's `reply` is returned **only if it contains no numeral at all** —
ADR 0024's allowed set for this stage is empty, and `\p{N}` is the whole check.
The figures the user reads are the ones the page computed and rendered; the
model explains a number it was never shown.

On a second failure the user gets `UNEXPLAINED_DIET_REPLY` and the target still
renders, which is the point of computing it first.

_The panel's two fields (`summary` and `caveat`) become one `reply`._ They were
two because the panel rendered them as a sentence and a muted line; one box
returns one answer. ADR 0024's guarantee is the empty allowed set, not the field
count, and it is unchanged.

### `supplement`

`supplement_slug` names a row **from the array that built the enum** — never one
refetched by a model-supplied string. The page renders that row from its own
columns. `NO_MATCH` renders the code-owned message pointing at `/evidence`.

The model's `reply` is **not shown on this route**. ADR 0023's position is that
the model retrieves and code renders: prose about a row, beside the row, would
be a second claim the evidence does not support.

### `off_topic`

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
2. **Every replayed turn is fenced separately**, the coach's own included, each
   with its own cap. The payload contains no `assistant` message — the
   transcript is client-supplied, so all of it is untrusted. ADR 0015 §2.
3. **`scanOutput`** runs inside the gateway, as for every text stage — a speech
   call returns audio and is not scanned (ADR 0025). It runs **twice**: once on
   the raw completion, and once — as `scanValue` — over each string in the
   parsed value. A completion is a JSON document, and one that spells a word as
   an escape carries no word at all until it is parsed; re-encoding the document
   is not enough either, because that puts the control characters back. ADR
   0005's 2026-09-12 amendment has the measurement and names what still gets
   through: homoglyphs, and a phrase split across two fields. The second scan is
   what covers the `reply` this box renders.
4. **The route's own number guard.** `training` uses
   `findUnknownNumbers(allowed, reply)` where `allowed` is the facts' **typed
   numeric leaves** plus every numeral in the user's own turns. What this does
   and does not guarantee is in ADR 0015 §4, and it is weaker than it sounds: it
   enforces that every numeral appeared in what the model was fed, not that a
   figure is true. `diet` does **not** use that function: it uses its own
   `\p{N}` predicate, and the difference is load-bearing rather than stylistic —
   see below. `supplement` reads no prose, so it has no number guard at all; it
   has the allowlist instead.

> **The diet route's check is `/\p{N}/u`, not `findUnknownNumbers(new Set(), …)`.**
> Those look equivalent — "an allowed set with no members" — and they are not.
> `findUnknownNumbers` matches `\d`, which is **ASCII only, even under the `u`
> flag**, so `١٨٠٠`, `१८००`, `１８００` and `¹⁸⁰⁰` all passed it and the model's
> figure rendered directly beneath the engine's. Asking in Arabic, Persian,
> Hindi or Bengali was enough; no jailbreak needed. Widening that function is
> not the fix either: `Number('١٨٠٠')` is `NaN` and the guard skips non-finite
> values, so a widened match would be silently discarded. The ASCII assumption
> there is load-bearing for the training route, where numerals are compared
> against a set of numbers. `src/chat/routing.test.ts` holds the two apart.

5. **`acceptableNote`** — ADR 0030 §2, and it is the only guard here whose
   failure costs the user nothing. It runs on the attempt's own `remember`
   field, **before** the route guard has decided whether the reply survives, and
   its four checks (non-empty, at most `MAX_NOTE_CHARS`, no numeral in any
   script and no spelled figure with a training unit, not a duplicate) drop the
   note and leave the answer alone. The gateway's `scanValue` is the exception:
   it runs on `remember` before any of this and fails the whole call.

`chatMessages` returns `{ messages, allowed }` from **one pass**, so the
quotable set cannot drift from what was sent. Three exclusions matter:

- **Coach turns contribute nothing.** Admitting them would let one reply that
  slipped a number past the guard license every later reply to repeat it.
- **Exercise names contribute nothing**, which is why the facts half reads typed
  leaves rather than the rendered block. Catalogue names carry digits ("3/4
  Sit-Up"), and any authenticated user may insert an exercise of their own.
- **Notes contribute nothing.** `acceptableNote` already refuses every numeral,
  so a note carrying one could only come from a row written around that rule —
  and a figure that slipped into a memory once would otherwise license itself in
  every reply thereafter.

The set is fixed **before** the retry loop. The correction names the rejected
figure, and recomputing after appending it would authorise the very number that
was just refused.

## 6. What the tests must cover

The adversarial suite in `src/chat/reply.test.ts` runs against a scripted
`LlmCaller` — no key, no network, no database.

**Memory — ADR 0030, in `src/chat/notes.test.ts` and `tests/db/notes.test.ts`:**

- every drop condition, at its boundary: exactly `MAX_NOTE_CHARS` keeps and one
  more drops; a numeral in five scripts; a spelled figure with a unit, and a
  spelled number without one, which is the stated limit
- a duplicate defeated by an appended zero-width character — the case that
  showed `trim()` alone was not enough
- `training` and `diet` keep a note; `supplement` and `off_topic` drop it, and
  both edges are asserted, because narrowing OR widening the route check passed
  the whole suite before they existed
- the notes block is fenced, is absent when there is nothing to remember, and
  adds nothing to `allowed`
- twenty full-length notes reach the model untruncated, and more than twenty are
  cut to twenty by `notesBlock` itself rather than only by the reader
- against Postgres: no cross-user read, write or delete; the bound holds for a
  hand-written row as well as an application one; the reader returns the newest
  `MAX_NOTES` in order; the column's CHECK refuses what the application refuses

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
- a model returning `route: 'off_topic'` with a long persuasive `reply`,
  asserting that string never reaches the caller
- a reply quoting a figure absent from the facts, asserting retry then fallback
- a reply quoting a figure **the user typed**, asserting it is allowed

**Routing, new in PR 8a.** Each is a case the single call made possible, and
each asserts a guard rather than a classification:

- every route returns its own shape: prose for `training`, prose with no numeral
  for `diet`, a **row** for `supplement`, a constant for `off_topic`
- a `diet` reply carrying any numeral is rejected, retried, and falls to
  `UNEXPLAINED_DIET_REPLY` — the empty allowed set holds on this route
- a `supplement_slug` outside the enum is a **schema failure**, retried by the
  gateway, never a lookup by a model-supplied string — the allowlist is the
  schema, so there is no membership test to forget
- `NO_MATCH` renders the code-owned miss
- the model's `reply` on the `supplement` route never reaches the caller
- **a retry that changes route is checked by the new route's guard**: a `diet`
  answer rejected for a numeral, returning `training` on the second attempt, is
  checked against the facts and not against the empty set — and the reverse,
  `training` then `diet`, is rejected for the numeral the first attempt was
  allowed
- `route` is asserted to be the schema's **first** field, as `on_topic` was

**A medical question** must recommend a professional rather than answer —
`SAFETY_PREAMBLE`'s conduct rule. This is a prompt-level behaviour and the test
records it as such: it asserts the stage passes the question through on-topic,
not that the model complied.

**The suite records what got through.** ADR 0005 §5 — a `describe` block named
for the escapes that are not caught, with the reason each one is out of reach.
