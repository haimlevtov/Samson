# Coach memory, a voice during a session, and a user who starts from nothing

Four changes, four branches, in this order. `main` is green at `3409c59`, the
rework plan closed at twelve of twelve, and hosted was reseeded on 2026-09-12.

| PR  | What                                                                    | Branch                  | State   |
| --- | ----------------------------------------------------------------------- | ----------------------- | ------- |
| 1   | [The persona picker is a menu](#pr-1--the-persona-picker-is-a-menu)     | `coach-persona-menu`    | planned |
| 2   | [The coach remembers](#pr-2--the-coach-remembers)                       | `coach-memory`          | planned |
| 3   | [Talk to it during a session](#pr-3--talk-to-it-during-a-session)       | `session-talk`          | planned |
| 4   | [A user who starts from nothing](#pr-4--a-user-who-starts-from-nothing) | `fresh-user-onboarding` | planned |

Ordered smallest-risk first, and PR 4 last because it is the one that consumes
the other three: a brand-new user meets the persona menu, then the onboarding
questions, then a coach with nothing to remember yet.

## Two decisions taken before planning, and who took them

Both were put to the owner because both change something already written down.

### Memory is written by code, from a field the model fills

**ADR 0015 §1 guarantees the chat has no database write path**, and says so in
the report's guarantee table as the thing that makes _"a jailbroken chat cannot
persist anything"_ true rather than hopeful. Memory needs a write path, so that
guarantee cannot survive unchanged. The owner chose the middle option of three:

- The model fills a structured `remember` field beside its answer, exactly as it
  fills `route` today.
- **Code decides whether it is stored.** Bounded length, no numerals at all, and
  the same scan every completion gets.
- The note is a row the user can **see and delete** on Profile.

So the guarantee becomes: _the model cannot write arbitrary text; it can propose
a short note, which code validates and the user can remove._ Weaker, honestly
weaker, and ADR 0015 will say so in the same table rather than quietly dropping
the row.

**Rejected: free-form model memory**, which would have deleted the guarantee
outright. **Rejected: a confirmation tap per fact**, which preserves the
guarantee almost intact and was judged to cost more than it buys — a coach that
forgets what you told it because you did not tap yes is a coach nobody trusts.

### Speech input is the browser's, not a provider's

The project has **no speech-to-text**. ADR 0025's speech stage is text-to-speech
only. The owner chose the browser's own `SpeechRecognition`:

- Free, no key, no new `llm_calls.stage`, no migration, no budget assumption —
  which matters against a key funded in single dollars.
- The same reasoning ADR 0006 used for device speech, and the mirror image of
  ADR 0025: **recognition quality is not a character problem**, so the argument
  that killed device speech for OUTPUT does not apply to INPUT.
- **It does not work in iOS Safari.** This is a phone-first product, so that is a
  real hole and PR 3 has to render something honest there rather than a button
  that does nothing.

**Rejected: a paid STT stage**, which works everywhere and costs money per minute
against a $5 key, plus a stage, a migration and a budget assumption.

---

## PR 1 — the persona picker is a menu

**Branch `coach-persona-menu`.** The smallest of the four and the only one with
no ADR.

Today the Voice card renders one chip per coach and a `Hear {name}` button. Five
chips is a row of five tap targets spending a whole line of a phone screen on a
choice made once.

**After:** a `Change persona` menu, and a **Try** button beside it.

- **The menu is a `<select>`**, not a custom dropdown. It is keyboard and screen
  reader navigable for free, it is the control a phone already renders as a
  native picker, and `docs/specs/mobile-interface.md`'s 44px rule is satisfied by
  the existing `select` min-height rather than by new CSS.
- **Try is a primary button**, which is already purple — `--accent` is `#6c4df6`.
  So "purple" is a token change from `.secondary`, **not a new colour**, and that
  matters: the design discipline in this repo is that state is never carried by a
  hardcoded hex.
- **The label stops naming the coach.** `Hear {name}` had to be rebuilt per
  selection; `Try` does not, and the name is already on screen in the menu.

**What must not change**, because each is a state something argued for:

- Every reason a coach cannot be heard still renders its sentence — `no-key`,
  `budget`, `no-voice`, `failed`, `blocked` (ADR 0025, and
  `docs/specs/mobile-interface.md` §4).
- Selecting a coach still supersedes a press in flight (`player.select()`).
- The button stays enabled while fetching, because disabling the focused control
  drops keyboard focus and a second press joins the call rather than paying twice.

**Files:** `app/coach/CoachConsole.tsx`, `app/globals.css`, and the two docs
that name the control: `docs/specs/mobile-interface.md` §4's state table (three
rows of it — the button, its loading label and its refusals) and
`.claude/skills/add-persona/SKILL.md`, which tells the next author what `name`
is rendered as. _There is no persona spec; this line said there was, and both
docs above were missed on the first pass because of it._

---

## PR 2 — the coach remembers

**Branch `coach-memory`.** ADR first, in its own commit, amending ADR 0015.

### What a memory is

One short sentence the coach may keep about the user: _"wants to bring up their
biceps"_, _"reported a sore left shoulder on 12 September"_.

### The table

`coach_notes` — `user_id`, `text`, `created_at`. RLS own-row, read and write, the
same shape `user_equipment` has. `user_id` from the session, never a field.

**Bounded, because an unbounded memory is three problems at once:** a cost leak
(every note is re-sent on every turn), an attention-dilution attack (ADR 0015 §5's
reasoning for the transcript window, one table along), and a storage leak. So:
**at most 20 notes, newest kept**, and the oldest falls off.

### What code checks before a note is stored

The model proposes; code disposes. A note is refused unless:

- it is **at most 120 characters** — a sentence, not a paragraph;
- it contains **no numeral at all**, in any script. Same rule and same
  `\p{N}` predicate the diet route uses, for a related reason: a remembered
  figure is a figure the metrics engine did not produce, and it would be re-fed
  to the model every turn as though it had. "Reported a sore shoulder" is a
  memory; "squats 100 kg" is an invented fact with a long life;
- it survives `scanOutput`, which every completion already gets.

**The user can see and delete every note**, on Profile. That is not a nicety —
it is the thing that makes the weakened guarantee acceptable, and ADR 0015's
amended table will say the memory is _user-removable_ rather than merely bounded.

### How it reaches the model

A fenced block, beside the facts and the diet categories, built by code in the
same pass — `src/chat/prompts.ts`. **Notes contribute nothing to the quotable
number set**, for the same reason coach turns do not: a figure that slipped into
a note once would otherwise license itself forever.

### What this does not guarantee, and the ADR will say it

- **The coach will remember the wrong thing sometimes.** Which sentence is worth
  keeping is the model's judgement, the same class as `route`, and a mitigation
  rather than a control.
- **A note is what the user said, not what is true.** "Reported a sore shoulder"
  is a record of a claim. The coach must not treat it as a diagnosis, and the
  conduct rule about injuries still outranks it.
- **The guarantee is weaker than it was.** Written in the table, not in a
  footnote.

**Files:** `docs/adr/0030-*`, a migration, `src/chat/schema.ts`,
`src/chat/prompts.ts`, `src/chat/reply.ts`, `src/db/notes.ts`,
`app/coach/actions.ts`, a Profile surface, tests in the same commit.

---

## PR 3 — talk to it during a session

**Branch `session-talk`.** ADR first: it adds an input channel and it has a
platform hole worth writing down.

### The control

A **hold-to-talk** button on the session screen. Hold, speak, release: the
browser's `SpeechRecognition` produces a transcript, which goes to the coach as
an ordinary message.

**On a browser without it — iOS Safari, notably — the button is not rendered.**
A control that does nothing is worse than an absent one, and
`docs/specs/mobile-interface.md` §4 wants every state to say something: the card
explains that this browser cannot listen and points at the text box, which works
everywhere.

### The reply comes back spoken AND written

And the order matters for a reason ADR 0025 §4 already settled: **the server
never speaks text the browser sends.** A user who could post arbitrary text to
the speech stage could make the project's key say anything, bounded only by the
budget.

So the reply is generated and spoken **in the same request**: the action calls
the coach, gets the answer, and passes that answer — which is server-side text,
never round-tripped — to `callSpeech`. The browser receives audio plus the
transcript. There is no path where the browser hands the server words to say.

### What it costs, stated before it is built

Every spoken reply is a speech call, charged `SPEECH_ASSUMED_COST_USD` ($0.02)
against the weekly budget, and a chatty session is a lot of presses. The default
budget is $0.50 a week, so **twenty-five spoken replies spend a week**. PR 3 has
to decide whether speaking is opt-in per session, and the ADR has to say what it
chose.

### Confinement is unchanged

The transcript is a message like any other: fenced, routed, guarded by whichever
route the model names. The `off_topic` constant is what answers a question about
the weather, exactly as it does on the Coach tab.

**Files:** `docs/adr/0031-*`, a session-screen component, `app/history/actions.ts`
or a new action, `src/speech/`, tests.

---

## PR 4 — a user who starts from nothing

**Branch `fresh-user-onboarding`.** The largest, and the one that finally
exercises every empty state this project has written and never seen.

### The user

A **sixth archetype**, `fresh`: an account with no workouts, no sets, no
equipment, no biometrics, no plan, no XP. Every other seeded user is furnished;
this one is the demo of what a real person meets on day one.

It is the honest test of work already shipped: 8b's questionnaire, ADR 0029's
"no equipment" state, the diet advisor's missing-biometric refusals, and every
"nothing here yet" card.

### The onboarding

A **stepped form** on first sign-in, not one long page. What it asks, and each
question is one the app genuinely cannot infer:

1. **Name** — what the coach calls you.
2. **Age, weight, height, sex** — the four biometrics the diet engine needs, with
   the same grammar and bounds `src/diet/biometrics.ts` already enforces.
3. **Diet goal** — maintain, lose, gain.
4. **Equipment** — the ADR 0029 picker, reused rather than rebuilt.
5. **Days a week, weeks, anything sore** — the plan request, reusing 8b's schema.

Then it offers to generate the plan, which is 8b's action unchanged.

**Design notes, because the request asked for them specifically:**

- **One question per screen on a phone**, with progress shown. A five-section
  form on a 375px screen is a scroll, and a scroll is where people leave.
- **Every step is skippable except the name**, and skipping is explained rather
  than blocked: no biometrics means no calorie target, no equipment means no
  plan. The app already renders all of those states honestly — this is the first
  time a user will see them on purpose.
- **Nothing is generated until the last step.** The plan costs money and takes
  most of a minute; it must be a press, not a side effect of finishing a form.
- **It is resumable.** Each step writes what it collected, so a closed tab does
  not start over. This falls out of reusing the existing actions, which each
  write their own table.

### The reset

A **Reset this demo account** control that returns the fresh user to empty.

- **Only for that account.** It renders for nobody else, and it deletes only rows
  the caller owns, through their own session under RLS — never the service role.
  A demo convenience that could touch another user's data would be the worst bug
  in the project.
- **Confirmed, not a single tap**, and it says exactly what it removes.
- On Profile rather than the main page as asked: Profile is where "who you are"
  lives (ADR 0013), and an irreversible control belongs beside the other account
  actions rather than on the first screen of the demo. _This is a deliberate
  departure from the request and is flagged for the owner to overrule._

**Files:** `src/seed/archetypes.ts`, `scripts/seed.ts`, an onboarding route and
its steps, a reset action, tests.

---

## Verification

Each PR: `npm run verify`, `npm run build`, `npm run test:db` where a migration
is involved, then the reviewers, then merge and delete the branch.

**Docker** is needed by PR 2 and PR 4 only, for the `src/db/types.ts`
regeneration their migrations force. Announced before it starts and stopped in
the same turn.

**And the browser pass is owed.** Nine of the twelve rework PRs had a surface and
none of them was ever opened in a browser — every one is proved by test, by
mutation and by reading. All four PRs here are surfaces, PR 4 is nothing but
surface, and the request for it asked for user experience and design in as many
words. That cannot be discharged by a test suite, and this plan should not
pretend otherwise: **someone has to open it on a phone.**
