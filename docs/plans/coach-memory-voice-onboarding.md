# Coach memory, a voice during a session, and a user who starts from nothing

Four changes, four branches, in this order. `main` is green at `3409c59`, the
rework plan closed at twelve of twelve, and hosted was reseeded on 2026-09-12.

| PR  | What                                                                                                 | Branch                  | State                                                                              |
| --- | ---------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| 1   | [The persona picker is a menu](#pr-1--the-persona-picker-is-a-menu)                                  | `coach-persona-menu`    | shipped 09-12, [↓](#pr-1--the-persona-picker-is-a-menu-2026-09-12)                 |
| 2   | [The coach remembers](#pr-2--the-coach-remembers)                                                    | `coach-memory`          | shipped 09-12, [↓](#pr-2--the-coach-remembers-2026-09-12)                          |
| 3   | [Talk to it during a session](#pr-3--talk-to-it-during-a-session)                                    | `session-talk`          | shipped 09-12, [↓](#pr-3--talk-to-it-during-a-session-2026-09-12)                  |
| 4   | [A user who starts from nothing](#pr-4--a-user-who-starts-from-nothing)                              | `fresh-user-onboarding` | shipped 09-12, [↓](#pr-4--a-user-who-starts-from-nothing-2026-09-12)               |
| 5   | [A sixth coach, and a voice you can tell apart](#pr-5--a-sixth-coach-and-a-voice-you-can-tell-apart) | `austrian-persona`      | shipped 09-12, [↓](#pr-5--a-sixth-coach-and-a-voice-you-can-tell-apart-2026-09-12) |
| 6   | [The coach tab speaks too](#pr-6--the-coach-tab-speaks-too)                                          | `coach-tab-voice`       | planned                                                                            |
| 7   | [Every badge, and how to get it](#pr-7--every-badge-and-how-to-get-it)                               | `badge-catalogue`       | planned                                                                            |
| 8   | [The welcome flow, after somebody used it](#pr-8--the-welcome-flow-after-somebody-used-it)           | `welcome-second-pass`   | shipped 09-12, [↓](#pr-8--the-welcome-flow-after-somebody-used-it-2026-09-12)      |
| 9   | [Date of birth is three dropdowns](#pr-9--date-of-birth-is-three-dropdowns)                          | `welcome-birth-date`    | planned                                                                            |

Ordered smallest-risk first, and PR 4 near the end because it is the one that
consumes the others: a brand-new user meets the persona menu, then the onboarding
questions, then a coach with nothing to remember yet.

**PR 5 was added on 2026-09-12, after PR 2 shipped**, and it is last because it
is content rather than mechanism — a sixth persona row, two recast voices and a
line of copy under a control PR 1 built. Nothing depends on it.

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
budget is $0.50 a week, so **twenty-five spoken replies spend a week**.

**Decided by the owner on 2026-09-12: speaking is OPT-IN, per session.** The
button holds the transcript either way; the coach answers in the chat either way;
the audio is what the toggle buys. Off by default, and the reason is the number
above rather than a preference — a feature that can spend the project's whole key
in one session is not a default.

The ADR has to say what that costs as well as what it saves: a user who never
finds the toggle never hears a coach, and the whole point of ADR 0025's voices is
that they are heard. So the toggle is on the session screen next to the talk
button, not buried in Settings, and the card says what it costs in words — not in
dollars, which are the project's and not the user's.

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
3. **Diet goal** — cut, maintain or gain, which is what `DIET_GOALS` holds.
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

- **Only for that account.** It renders for nobody else, and never the service
  role. A demo convenience that could touch another user's data would be the
  worst bug in the project.

  _Shipped differently from this sentence, and ADR 0032 §4 says why: "through
  their own session under RLS" could not work, because four of the tables are
  select-only and a client delete against them succeeded while removing nothing.
  It is a `security definer` function that takes no argument and checks the
  account itself._

- **Confirmed, not a single tap**, and it says exactly what it removes.
- On Profile rather than the main page as asked: Profile is where "who you are"
  lives (ADR 0013), and an irreversible control belongs beside the other account
  actions rather than on the first screen of the demo. _This is a deliberate
  departure from the request and is flagged for the owner to overrule._

  **Overruled, and it shipped on the main page** — [ADR
  0032](../adr/0032-a-user-who-starts-from-nothing.md) §4 carries the reasoning
  the owner's version rests on: the control exists to be pressed between demo
  runs, and one you have to navigate to mid-demo is friction in the moment it was
  added to remove.

**Files:** `src/seed/archetypes.ts`, `scripts/seed.ts`, an onboarding route and
its steps, a reset action, tests.

---

## PR 5 — a sixth coach, and a voice you can tell apart

**Branch `austrian-persona`.** Content, not mechanism: a persona is a row
(CLAUDE.md #7), and `.claude/skills/add-persona` is the procedure. Three things
the owner asked for, in one PR because they are all the same surface.

> **What shipped differs from this entry in five places.** Recorded here so a
> reader of the plan is not misled; each is argued where the decision was taken.
>
> - **A fourth thing shipped: a Try button on the welcome coach step**, asked for
>   by the owner after this entry was written. It is a second paid speech
>   surface, so [ADR 0025](../adr/0025-coach-voices.md) carries an amendment for
>   it — including the recency guard `hearCoach` never had, and the sentence the
>   step now says about what a press costs.
> - **The coach is "a former champion", not "a former Mr Olympia".** The title is
>   a trademark, and it went for the same reason the name did.
> - **The banned list is shorter than this entry promised.** `man up` and
>   `ill be back` were both measured firing on ordinary coaching prose, because
>   `phraseUsed` clears punctuation before matching — so a sentence boundary is
>   not a word boundary, and a hit costs the user their whole block.
> - **The bio renders under BOTH pickers**, not only the Coach tab's menu.
> - **The recast brought a constant with it.** This entry asked only that the
>   cast be checked against Google's table; it is `SPEECH_VOICE_GENDER` now, so
>   "a male voice" is a property a test asserts rather than a name somebody
>   remembered.

### The Austrian

A sixth coach: a former Mr Olympia from a village in Styria, who won everything
there was to win and now coaches. Big, warm, unhurried, absolutely certain that
the next set is the one that matters.

**Written as an archetype rather than as a named person, and that is the repo's
own rule rather than a flinch.** `add-persona` says: _"Twist the reference toward
lifting rather than quoting it verbatim... Character art, logos, and trademarked
slogans are not [fine]."_ So: the accent, the cadence, the vocabulary — the pump,
the mind-muscle connection, the unembarrassed love of training — and none of the
film lines, no claim to be anybody, and no use of a living person's name in a
row that speaks to users.

- `system_prompt` describes a CHARACTER, because the column is fenced data and an
  instruction there is read as description (ADR 0006).
- `tts_instructions` carries the delivery: Austrian-accented English, deep and
  warm, deliberate, unhurried. An ACCENT is a property of speech; it is not an
  impersonation of a particular speaker, and the distinction is worth writing in
  the ADR-less PR body because somebody will ask.
- `banned_phrases` gets the two every persona carries plus the film quotes, so
  the character cannot drift into the impression by accident.
- `sample_line`: no numeral, none of its own banned phrases, clean through
  `scanOutput` — `tests/db/personas.test.ts` checks all three.

### The Physio and the Analyst get male voices

Both are cast female today — `Erinome` and `Sulafat`. The owner asked for male
voices for both.

**The voice list does not say which are which.** `SPEECH_VOICES` in
`src/speech/script.ts` carries a style label per voice and nothing about the
speaker, and the OpenRouter catalogue carries neither. So the recast is checked
against Google's published voice table before it is written, not chosen from
memory — the voice-variant bug in `add-persona` is what happens when a voice is
picked on an assumption.

**And no two coaches may share a voice.** That skill's INVARIANT was written for
the device-speech era and the column it names is gone, but the property it
protects is the whole point of having five coaches: a new cast has to leave six
distinct voices, and the db test has to assert it on `tts_voice` now rather than
on the dropped `tts_voice_variant`.

### A bio under the menu

The `Change persona` menu gives a name and nothing else, so choosing between six
coaches is guesswork. One or two sentences under the select, describing the coach
in the third person — what they are like to be coached by.

- **A new column**, `bio`, not a reuse of `system_prompt`: that one is a
  description written FOR a model and reads badly to a person, and it is fenced
  into a prompt, so making it double as UI copy would put user-facing text in the
  instruction channel's payload.
- It renders from the row, so it is content and needs no code per coach.
- It changes with the selection, which is a client-side read of a row already
  loaded — no request per change, the thing PR 1 was careful about.

**Files:** a migration (the `bio` column, the sixth row, the two recast voices),
`src/persona/schema.ts` (`SHIPPED_PERSONA_SLUGS`), `src/db/personas.ts`,
`app/coach/CoachConsole.tsx`, `app/globals.css`, `tests/db/personas.test.ts`,
and `.claude/skills/add-persona/SKILL.md` — whose voice-allocation table is about
to be wrong in two rows.

---

## PR 6 — the coach tab speaks too

**Branch `coach-tab-voice`.** PR 3 put a voice switch on the session screen; the
Coach tab, where people actually hold a conversation, still answers in silence.
The same control, on the surface it was arguably for in the first place.

**No new ADR.** [ADR 0031](../adr/0031-talking-during-a-session.md) already
decided everything this needs and its reasoning is surface-independent:

- **Opt-in per session**, off by default, because a spoken reply is $0.02 against
  a $0.50 week. The Coach tab is the chattier surface, so the arithmetic bites
  harder here, not less.
- **The server never speaks text the browser sends** — the reply is generated and
  spoken in one request, and `spokenLine` sanitises it before it is performed.
- **Only a reply within `MAX_TRANSCRIPT_CHARS` is spoken**, which keeps
  `SPEECH_ASSUMED_COST_USD` calibrated.

What it does add, and it is the reason this is a PR rather than a copy-paste:

- **The persona is CHOSEN here.** ADR 0031 §5 settles for "the first shared,
  voiced coach alphabetically" because the session screen has no picker. The
  Coach tab has one — three feet above the box. So the spoken reply should use
  the coach the user has selected, and the switch should say whose voice it is
  before they turn it on rather than after the first answer.
- **The chat has a transcript.** The session card holds one exchange; this one
  replays history, so a spoken reply arrives beside turns that were not spoken.
  The card has to make clear that the switch affects the NEXT answer, not the
  conversation.
- **`askTheCoach` already returns a state object**, so the audio rides in it
  rather than needing a second action — which is what keeps ADR 0025 §4 true.

**Files:** `app/coach/CoachBox.tsx`, `app/coach/actions.ts`,
`app/coach/coach-state.ts`, `app/globals.css` (the switch is already a shared
class from PR 6b's design pass), tests.

---

## PR 7 — every badge, and how to get it

**Branch `badge-catalogue`.** Profile lists the badges you have earned. There is
no way to see the ones you have not, or what any of them is for.

**A badge opens a panel**, and a link from the badges section opens the whole
catalogue: every achievement, what unlocks it, and whether you hold it.

### The constraint that shapes this, and it is a real one

**[ADR 0017](../adr/0017-held-hidden-achievements.md) exists precisely to stop this.** Its
policy is `hidden = false` for anything the user has not earned — `docs/PLAN.md`
phase 5 requires that hidden achievement definitions are never sent to a client
that has not earned them, and the RLS policy is what enforces it, not the UI.

So "all available badges and how to unlock them" cannot mean all of them:

- **A visible achievement** shows its name, its description and its unlock
  condition, earned or not.
- **A hidden one the user HOLDS** shows everything — that is ADR 0017's whole
  point, and the surface where it was never rendered.
- **A hidden one the user does NOT hold** shows that it exists and nothing else.
  Not silently omitted: a catalogue that quietly hides rows teaches people the
  list is complete when it is not, and "there are three more to find" is better
  copy than a short list anyway.

**Decided by the owner on 2026-09-12: show the count.** The alternative was
omitting hidden unearned rows entirely, which reads as a complete list and is
not one. So the panel says how many are left to find and nothing about what they
are — which is the same information the badge count on Profile already implies,
and rather more fun than a silent gap.

_What this does NOT change: [ADR 0017](../adr/0017-held-hidden-achievements.md)
still governs the DEFINITIONS. A hidden badge the user does not hold sends no
name, no description and no unlock condition — the RLS policy is what enforces
that, not the panel, and the db test asserts it._

### What the unlock condition says

Not the SQL. `achievements.predicate` is a SQL boolean (ADR 0009), and putting it
on screen would be both unreadable and a description of the schema. The
`description` column is what the user reads, and the catalogue's job is to render
it for a badge somebody has not earned — which nothing currently does.

**If a description does not stand on its own** for an unearned badge, that is a
content bug in the row, and the PR should say which rows need rewriting rather
than inventing prose in the component. Content lives in the database — CLAUDE.md
#7.

### Reading it

`loadUnlockedAchievements` returns what the user holds. The catalogue needs the
whole visible table plus that set, which is one more read in `src/db/gamification.ts`
and no new policy: the existing one already returns exactly the rows the user may
see. **That is the thing to verify first and by test** — the panel must not need
a policy change, and if it seems to, the design is wrong rather than the policy.

**Files:** `src/db/gamification.ts`, a Profile panel, `app/globals.css`,
`tests/db/achievements.test.ts` (a hidden, unearned row returns no description to
its non-holder), tests.

---

## PR 8 — the welcome flow, after somebody used it

**Branch `welcome-second-pass`.** The owner opened PR 4, used it, and came back
with five things. Four are small; one is a control that cannot be reached at all.

> **Three things below are not what shipped.** Recorded here so a reader of the
> plan is not misled; each is argued where the decision was actually taken.
>
> - **The reset is one button on `/sign-in`**, not a card on `/welcome` and Hub.
>   The owner asked for that mid-PR — [ADR 0032](../adr/0032-a-user-who-starts-from-nothing.md)'s
>   second amendment.
> - **`users.persona_slug` carries NO foreign key.** `personas` is unique on
>   `(user_id, slug)`, so there is nothing to point at — the migration and ADR
>   0032 both argue it.
> - **Sex is two options behind an unselectable placeholder.** This entry says
>   "the welcome control offers the two" and I first shipped three; the owner
>   overruled that, for the reason ADR 0032 now records.

### The reset button is unreachable, which is a design fault rather than a bug

**Hub redirects a user whose `onboarded_at` is null to `/welcome`.** The demo
account's `onboarded_at` IS null — that is the whole fixture — so it never sees
Hub, and the reset lives on Hub. **The control that exists to restart the demo
can only be reached by somebody who has already finished the demo.**

Nothing about the gate is wrong; the placement is. It goes on `/welcome` as well,
for the same marked account, because for that account `/welcome` IS the main
page until the flow is done. The Hub copy stays, for the case after onboarding.

### Days a week becomes 1–7, and a false comment gets corrected

`PLAN_DAYS_PER_WEEK` is `[2,3,4,5,6]` and its comment says seven "leaves no rest
day, **which the rules reject anyway**". **That is false** — `src/planner/rules.ts`
has six rules (weekly volume increase, ACWR band, deload cadence, equipment
available, load ceiling, injured joint) and not one of them mentions rest.
Nothing rejects a seven-day week; it simply gets planned.

So the owner's request is buildable, and the comment that made it look
impossible is the thing to fix first.

**One reservation, recorded rather than acted on:** `docs/FRAMING.md` says the
user's body is a stakeholder that cannot complain, and every persona bans "no
pain no gain". Seven days with no rest day is the kind of plan this project has
been careful about. The ACWR and volume rules still bound how fast load climbs,
so it is unwise rather than unsafe — and it is the user's own choice about their
own training. It ships, and the control says plainly what seven means.

### Three smaller ones

- **Sex is male or female** on the welcome step. `SEXES` keeps `unspecified` for
  the settings form and the schema; the welcome control offers the two, and the
  step stays skippable, which is what "prefer not to say" already means here.
- **Equipment gets a select-all.** It goes in the shared form, so Settings gets
  it too — one control, both surfaces.
- **A coach personality step**, which is the interesting one — see below.

### Choosing a coach, and the column three things have been waiting for

Onboarding asks which coach you want. That needs somewhere to put the answer,
and **`users.persona_slug` is a column three separate pieces of work have
already gone without**:

- [ADR 0031](../adr/0031-talking-during-a-session.md) §5 settles for "the first
  shared, voiced coach alphabetically" for the session voice, and says in as
  many words that persisting the choice "is a column and a settings control, and
  it belongs with whatever change wants it on more than one screen". This is
  that change.
- PR 6 wants it, for the same reason.
- The Coach tab's own picker dies with the page.

**Nullable**, like `diet_goal`, and for the same reason: "has not chosen" is not
"chose the first one". Readers fall back to the existing default, so nothing
changes behaviour by the column merely existing.

**It is a FOREIGN KEY to `personas(slug)`, not free text** — a persona is a row
(CLAUDE.md #7), and a dangling slug would render a picker with nothing selected.
On delete it sets null, which is the honest behaviour if a coach is ever retired.

**Files:** a migration and the `src/db/types.ts` regeneration it forces,
`src/planner/request.ts`, `app/welcome/`, the equipment form, `app/hub/`,
`src/db/server.ts`, tests.

---

## PR 9 — date of birth is three dropdowns

**Branch `welcome-birth-date`.** The owner reported that the welcome flow's date
of birth will not take a year ending in zero — 1990, 2000 — and asked for it to
be split into dropdown menus.

### What is known, and what is not

**I could not reproduce the year behaviour, and this plan does not pretend to
explain it.** What was checked:

- `birthDateField()` accepts any real ISO date from `1900-01-01` on, so 1990 and
  2000 pass validation. The refusal is not the app's.
- The welcome step's control is a bare `<input type="date">` with **no `min` and
  no `max`** (`app/welcome/Steps.tsx`), unlike the Settings one, which carries
  both. So whatever is happening is inside the browser's own date widget.

That is enough to act on without a diagnosis, because the fix the owner asked
for removes the widget from the path entirely. A native date input is also the
worst of the three controls on a phone: its segments are typed blind, its value
stays empty until all three are filled, and nothing about that is visible.

### Three selects, and a pure function to join them

`birthDay`, `birthMonth` and `birthYear`, composed into the ISO date the schema
already validates.

- **The composition is a pure function in `src/onboarding/schema.ts`**, not in
  the action. Nothing under `app/` is in the unit suite — `vitest.config.ts`
  includes `src/**` and `tests/unit/**` — so a rule written there is one no test
  can fail on. That argument is PR 8's, made twice and then broken once in the
  same PR; this is the third time it applies.
- **Partial answers are refused with their own sentence**, the way the four-or-
  none biometrics guard is. Two of three selects answered is not a date, and
  silently treating it as blank is the class of silent loop PR 8 closed.
- **February the thirty-first is caught by `isRealDate`**, which the schema
  already runs — so the impossible combination a three-select control makes
  reachable is refused by a check that exists, with a message that exists.

### The year list stops at this year, computed on the server

`docs/specs/mobile-interface.md` and Settings' own comment both say a picker must
not offer what the save will refuse: `isFutureBirthDate` rejects a future date,
so the years run from `EARLIEST_BIRTH_DATE` to the user's current year and no
further.

**On the SERVER**, and passed in — the same reasoning Settings records for
`maxBirthDate`: this is a client component, so a year built here would be the
DEVICE's, and a user whose phone is in another timezone would get a picker that
disagrees with the action's own check (CLAUDE.md #9).

### Settings keeps its date input, for now

It carries `min` and `max`, so it does not have the reported problem, and
`readSettingsForm`'s AI-NOTE is explicit that a surface writing these fields must
post the whole form rather than a subset — so changing it is a change to that
reader too. Recorded as a deliberate asymmetry rather than an oversight: two
surfaces asking one question two ways is the thing the sex control already had to
argue, and if the owner wants one control everywhere, this is the follow-up.

**Files:** `src/onboarding/schema.ts` + test, `app/welcome/Steps.tsx`,
`app/welcome/actions.ts`, `app/welcome/page.tsx`, `app/globals.css`.

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

---

## Outcomes

### PR 1 — the persona picker is a menu, 2026-09-12

Shipped as [#58](https://github.com/haimlevtov/Samson/pull/58). Five chips and a
`Hear {name}` button became a `Change persona` menu and a primary **Try**.

The two claims this PR rested on both held, and both were checked rather than
assumed: `--accent` is already the purple the request asked for and the base
`button` rule already uses it, so "purple" was a token change from `.secondary`
and no hex was added; and the base `select` rule already carries
`min-height: var(--tap)`, so the 44px rule in
[mobile-interface.md](../specs/mobile-interface.md) §3 needed no new CSS. It also
carries `font-size: 16px`, which is the iOS-zoom rule the same spec sets and
which nobody thought about in advance.

**What the two reviewers found, and it was eleven things.** Three are worth
keeping here:

- **The accessible name stopped changing.** An `aria-label` of
  `Try {name}'s voice` is a constant, and `aria-busy` announces nothing on a
  button in any of the three major screen readers — so a screen-reader user got
  silence for the whole fetch, which [ADR 0025](../adr/0025-coach-voices.md)
  measured live at about eight seconds. The visible word was also no longer
  contained in the accessible name, which WCAG 2.5.3 asks for. The fix is
  `.sr-only` content rather than a label: it tracks the state, so the press is
  audible, and it contains what is drawn.
- **A `disabled` that protected nothing.** The select was disabled during a plan
  delivery. React serialises the form at submit, so a later choice cannot reach a
  request already in flight; and the mismatch it looked like it prevented — a
  delivered plan rendered under a coach who did not deliver it — is free again
  the instant the delivery lands. It also contradicted the button's own reason
  for staying live, six lines below it. That mismatch is real and older than this
  PR, and is left as its own task.
- **The plan's Files line named a spec that does not exist**, which is why two
  docs that DID name the control were missed: §4's state table one row below the
  row that was updated, and `.claude/skills/add-persona/SKILL.md`, which tells
  the next persona author that `name` is "what the chip says". A wrong pointer in
  a plan is worse than no pointer, because it is followed.

**And a copy collision nobody planned for:** the failure sentence read "The voice
did not come through. Try again in a moment." — directly under a button now
labelled **Try**, where it stops being a reassurance and becomes an instruction
to press the control that just failed. It is now "The voice did not come
through." and nothing else.

**Not opened in a browser.** The browser pass this plan's Verification section
demands is still owed, and PR 1 does not discharge it.

### PR 2 — the coach remembers, 2026-09-12

Shipped as [#60](https://github.com/haimlevtov/Samson/pull/60), with
[ADR 0030](../adr/0030-what-the-coach-remembers.md) committed first and ADR 0015
amended in the same commit — because this is the PR that made one of that ADR's
guarantees false, and the table it was quoted from is where it had to be said.
_"A jailbroken chat cannot persist anything" is retired rather than reworded._

**A detour came first.** Designing this leaned on "a note survives `scanOutput`",
and checking that turned up a hole open since phase 0: the gateway scanned the
RAW completion, which is a JSON document, so `{"reply":"you are \u0067ay"}`
contained no word the scanner knew. All four checks, evadable by anything that
could influence how the model spelled its answer. That is
[#59](https://github.com/haimlevtov/Samson/pull/59), and it had to land first for
this plan's claim to be true.

**What review found, and twenty-seven findings is the number.** Three were
defects, and two of them were rules that did not do what their own documents said:

- **A zero-width space defeated the duplicate rule entirely.** `String.trim`
  does not strip U+200B and the whitespace class does not match it, so the same
  sentence with one appended passed every turn — and `sanitizeUntrusted` strips
  them again on the way into the prompt, so twenty of those would evict twenty
  real memories and leave the model reading twenty identical lines. The rule's
  own failure producing the outcome the rule exists to prevent.
- **"No numeral" is not "no figure", and three documents said it was.** "user
  squats two hundred kilos" passed every check, and a note is re-fed every turn,
  so the model could restate it and neither reply guard would fire — both read
  numerals. The unit is the boundary now, as it is for `CALORIE_FIGURE`.
- **A note that trips layer 4 costs the user their answer.** `scanValue` reports
  no field, so the gateway cannot drop the note and keep the reply.
  `PROTECTED_ATTRIBUTE` matches "disability" — so a user saying "I have a
  disability in my right shoulder" got three blocked attempts and a generic
  error. A denial path aimed at exactly the users the conduct rule protects. The
  prompt now asks for what someone can and cannot do and never why; the real fix
  is per-leaf attribution in `scanValue`, and it is named rather than made.

**And a test that tested nothing, twice.** ADR 0030 calls the reader's `LIMIT`
the control and the trigger hygiene — and nothing pinned the limit, because every
other case leaves twenty rows. The first replacement also passed with the limit
deleted: the trigger is a TABLE trigger and clears rows whoever inserts them,
service role included. It now disables the trigger over a direct connection to
reach the one state the limit exists for.

**Departures from this plan, both argued rather than quiet:** the surface is
Settings rather than Profile (ADR 0013's amendment moved this class of control
there), and `acceptableNote` does not call `scanOutput`, because the gateway
already has — reimplementing it would have looked like a second control.

**Docker twice, stopped twice.** Once for the types regeneration the migration
forces, once to run the db suite against the rewritten reader test rather than
ship it unverified. The additive migration went to hosted before the merge, per
the deploy-order rule.

**Still not opened in a browser.** This plan's Verification section owes that and
PR 2 does not discharge it.

### PR 3 — talk to it during a session, 2026-09-12

Shipped as [#61](https://github.com/haimlevtov/Samson/pull/61), with
[ADR 0031](../adr/0031-talking-during-a-session.md) first. Hold the button,
speak, release; the coach answers in the chat and — opt-in, per session — aloud.

**The owner's decision, and the arithmetic behind it:** a spoken reply is $0.02
against a $0.50 week, so twenty-five presses spend it. Off by default, toggled on
the session card rather than in Settings, and the label says what it costs in
words rather than dollars — the money is the project's.

**Four review rounds, and this is the PR to read if you want to know how this
project actually goes wrong.** Two findings stand out:

- **I broke an invariant that was written at me.** `src/speech/script.ts` says
  "known text only — nothing here takes what the browser sent", and an AI-NOTE
  beneath it names the PR that speaks model-written prose and says it must strip
  brackets and the script's own labels first. This was that PR and did none of
  it. The speech model's input is an instruction channel: `[whispers]` is
  performed, and a second `### DIRECTOR'S NOTES` block is a second set of
  directions. `spokenLine` is the control now — and its FIRST version stripped
  the labels before the whitespace collapse and before `sanitizeUntrusted`, both
  of which rebuild what the matcher just missed. Five spellings walked through,
  including a curly apostrophe, which is what a model actually emits.
- **Four of the resilience findings were bugs `src/speech/player.ts` had already
  found and fixed**, reintroduced because this PR wrote playback and in-flight
  bookkeeping from scratch instead of reading the module next door. That file's
  header says in as many words that those bugs live in the press, cache and
  in-flight bookkeeping, and that it exists so they can be tested.

And twice a fix was wrong on the first attempt while its test passed anyway — the
`holding` latch's regression test asserted only that `release()` did not throw,
which was true of the broken code as well. A test that cannot fail is a claim,
not a check.

ADR 0031 carries a section listing all of it, because the pattern repeated: a
guard written, a sentence written to match, and nothing measuring whether the
sentence held.

**Not opened in a browser** — and `SpeechRecognition` is the one part no test
here reaches. The state machine is proved; what Chrome does with a held button is
not. _Partially discharged on 2026-09-12: the voice switch was rendered against
the real stylesheet at 375x812 in both themes and its tap target, role and focus
ring measured. That is the CONTROL, not the feature — nothing signed in, and no
microphone held._

### PR 4 — a user who starts from nothing, 2026-09-12

Shipped as [#63](https://github.com/haimlevtov/Samson/pull/63), with
[ADR 0032](../adr/0032-a-user-who-starts-from-nothing.md) first. A sixth account
with no `users` row at all, a five-step welcome flow, and a reset on the main
page where the owner asked for it.

**The design decision everything else followed from:** starting from nothing
means no profile row, not a row of nulls. `currentUser` already read with
`maybeSingle` and defaulted every field, so the path existed and nothing had
walked it — and walking it surfaced a live bug rather than a quirk.
`updateSettings` wrote with `.update().eq(…)`, and an UPDATE matching no rows is
a silent success, so a real sign-up's settings would have appeared to save and
not.

**Four review rounds and two Docker sessions. Three findings are worth keeping:**

- **The reset could not delete four of the nine tables it named.** I read the
  policies for `public.users`, found it had no delete, wrote a paragraph about
  it — and assumed `for all` for the rest. `achievement_events`, `xp_events` and
  `challenges` are select-only; `plan_runs` is select and insert. RLS filters
  such a delete to zero rows and PostgREST returns SUCCESS, so the app reported a
  reset while the XP, the badges and the accepted plan survived — and the card
  had named them. Because `plan_runs` survived, onboarding decided the plan step
  was answered and never offered it.
- **The fix's own gate was a string an attacker could claim.** The
  `security definer` function keyed on `auth.users.email`. Sign-up is open and
  confirmations are off, so anybody could register `fresh@samson.test` and call a
  function that deletes `achievement_events` — whose unique constraint is what
  makes a badge once-only. **I rejected `..._delete_own` policies for exactly
  that cheat and then rebuilt it behind a weaker gate.** Verified free on hosted
  at the time. It reads `raw_app_meta_data` now, which only the service role can
  write.
- **My own test was holding the door open.** It deleted whoever held the address
  and recreated it, and `tests/db/helpers.ts` records that a machine without
  Docker runs that suite against HOSTED. Running the tests freed the address.

**And a test that could not exist where it mattered.** The replacement — an
impostor holding the address without the mark — failed in CI, because CI seeds
first and the address is legitimately taken there. It asserts the sharper
property instead: an account that marked ITSELF, in the column a user can write,
is refused.

**Two things CI caught that local runs did not**, both because I ran one file
rather than the suite: a definer function revoked `from public` where every other
one here revokes `from public, anon`, and a fixture that inserted a composite-PK
row twice. The revoke needed its own migration, because the first had already
been pushed and an applied migration is not re-run — an edit in place would have
fixed every fresh build and left the deployed database wrong forever.

**Not opened in a browser**, and this is the PR that most needs it: it is almost
entirely surface, and the whole point is meeting empty states nobody has seen.

### PR 8 — the welcome flow, after somebody used it, 2026-09-12

Shipped as [#64](https://github.com/haimlevtov/Samson/pull/64), with two ADR
amendments committed ahead of the code and a third written mid-PR when the owner
changed a decision. Five things asked for, two of them changed while it was open,
and sixteen review findings.

**The fault worth keeping is not in either half of it.** Hub redirects a user
whose `onboarded_at` is null to `/welcome` — ADR 0032 §2, and correct. The demo
account's `onboarded_at` is null by design, because that is what makes it the
fixture. The reset lived on Hub. **So the control that exists to restart the demo
could only be reached by somebody who had already finished the demo.** Two rules
that each hold, composing into a dead control; nothing but a user was going to
find it, and the owner did.

It moved twice. The first fix rendered the same card on `/welcome` as well. The
owner then asked for something simpler — one button on the sign-in page, no
explanation, no confirmation — and that is better than either version, for a
reason neither could reach: **Hub and `/welcome` are both behind a session**, so
where the control lives depends on where the app has decided to send this user.
`/sign-in` is the one page with no such decision in front of it. One press signs
in, resets, and lands on `/welcome`, which is the state the button exists to
produce.

**The owner overruled me on sex, and was right.** I shipped three options — male,
female, and `unspecified` labelled "Prefer not to say" — arguing a health profile
should carry a way to decline, and wrote that argument into the ADR. The reply
was "this is for scientific calculation, its a must". `mifflinStJeor` selects its
constant by sex, so a calorie target computed from `unspecified` is a figure
derived from a value nobody stated. Safe, because that value takes the higher
constant; still not an answer, in a project whose whole position is that a number
the user sees comes from real inputs. Two options behind an unselectable "Choose
one", because a two-option select with no placeholder records anybody who never
looked at it as male.

**A comment was load-bearing and false.** `PLAN_DAYS_PER_WEEK` was `[2,3,4,5,6]`
because seven "leaves no rest day, **which the rules reject anyway**". There are
six rules and not one of them looks at rest. Nothing rejected a seven-day week;
the form never offered one, behind a claim nothing enforced, and the test
asserting the refusal carried the same sentence. The reservation is real and is
recorded rather than acted on — ADR 0027 now carries it beside its block-weeks
sibling.

### What sixteen review findings were about

**Three were security or resilience, and the first is the one to remember:**

- **The reset left behind everything the app never writes**, and this PR deleted
  the note that said so. Eight tables carry a `user_id` and a write policy the
  app does not use; the reset cleared none of them. `src/db/demo-reset.ts` had an
  AI-NOTE naming that residue precisely — including that `exercises` was the one
  that mattered, because `exercises_read` admits a user's own row into the
  planner's candidate set. The note sat on `RESET_KEEPS`, this PR deleted the
  arrays because nothing rendered them any more, and took the only record of the
  gap with it. **A known gap whose record has been removed is worse than either
  the gap or the note.** And it mattered more than when the note was written: the
  account is shared, the reset is now one unauthenticated button, and this PR
  added the surface that renders `listPersonas` — which includes the caller's own
  rows. A persona planted under the demo account greeted whoever demoed next.
- **A failed reset could never render its message.** The sign-in runs before the
  RPC, so the error redirect landed on `/sign-in` holding a session, which
  bounced to `/hub` and on to `/welcome` — the same destination as success. A
  destructive control that fails silently reads as working.
- **A failed onboarding stamp was an infinite redirect.** `/welcome` calls
  `finishOnboarding` during render when every question is answered, so a failing
  write went `/hub` → `/welcome` → `/hub` until the browser gave up. Blank page,
  no message, for a user whose data was intact. The comment above it said "not
  worth stopping for: the worst case is the welcome flow asking again". This one
  pre-dated the branch and was found because the branch added a step to the flow.

**Five were comments that stated something false**, which this repo treats as
defects rather than untidiness, and every one of them was mine:

- `isAnswered('coach')` accepted an empty slug while the test comment I wrote
  beside it said an empty slug is not an answer.
- Four sites described `openingCoach`'s fallback as ADR 0031 §5's "first shared,
  voiced coach alphabetically". It returns the first coach the CALLER listed —
  and §5 records a review correcting that exact conflation.
- The `DEMO_ACCOUNT_EMAIL` note said three copies of the address and named the
  function's gate as one. That gate has not been the address since
  `20260912200000`, whose own header says so. **Two** copies, and nothing holds
  them together — a count recited rather than rechecked, which is how that note
  had already been wrong once.
- A CSS comment counted three specificity notes in the sheet. Two.
- `app/history/actions.ts` said "there is no stored persona choice anywhere to
  make the two agree" — in the PR that added the column.

**And two conventions this PR argued for and then broke in the same diff:**
`isCompleteBody` and `openingCoach` were both extracted to `src/` with the
reasoning that nothing under `app/` is in the unit suite, so a rule written there
is one no test can fail on. The select-all shipped as three decisions inside a
component. It is `src/catalogue/selection.ts` now. The coach step was the one
refused form in `Steps.tsx` that dropped what the user had picked, in a file
whose header says keeping values is the entire reason those components are
clients.

**The browser found something nobody had looked at.** The sign-in fixture table
has been scrolling the page sideways since it was written — 536px of columns
against a 375px viewport. Adding a third column for the reset took it to 631 and
put the button off the screen, which is the only reason it was noticed.

**Not covered:** the Coach tab's picker opening on a stored choice is held by
`openingCoach`'s unit test and was not seen in a browser — no seeded account has
both an accepted plan (which is what makes that console render) and a stored
coach. Persisting a change made with that picker is PR 6's, and ADR 0031 §5 now
records that only half of what it asked for shipped: a column with one writer,
and no settings control.

### PR 5 — a sixth coach, and a voice you can tell apart, 2026-09-12

Shipped as [#65](https://github.com/haimlevtov/Samson/pull/65). Three things
asked for, a fourth asked for while it was open, and twenty-seven review
findings across four reviewers.

**The finding worth keeping is not about the new coach at all.**

`phraseUsed` replaces every run of non-alphanumerics with a space before
matching, so **a full stop is not a word boundary** and a banned phrase can be
assembled out of the end of one sentence and the start of the next. `man up`
fires on "you moved that like a man. Up you get". `deliverPlan` has no fallback
by design (ADR 0006), so a hit rejects the delivery, retries, rejects again and
hands the user an error instead of the block the critic already approved.

The Austrian shipped with `man up` and `ill be back`, and the comment three lines
above the array argued the exact rule it was breaking. **But the Sergeant has
carried `man up` since 2026-09-08**, and nothing caught it — because
`tests/db/personas.test.ts`'s VOCABULARY paragraph, which exists for precisely
this class after the `weak`/"weakness" outage, contained no sentence that could
fire it.

_A regression test whose fixture cannot reach the bug passes and protects
nothing._ That is the lesson, and it generalises past this file: the guard was
written, reviewed and green for four days while the defect it was written for sat
in a shipped row.

**And the fix had to be a second migration.** The first was already pushed to
hosted, and an applied migration is never re-run — editing its array would have
corrected every fresh build and left the deployed database wrong forever. That
trap is recorded in `docs/plans/rework-hub-history-coach.md` and it caught this
PR anyway, one commit after the push.

### The rest of what review found

- **`hearCoach` was the only paid action in the app with no recency guard**, and
  this PR put six of its buttons on the onboarding step — which is where
  `/sign-in`'s credential-free demo button lands. A scripted loop could spend the
  demo account's week, silencing the planner and the chat with it. It has the
  guard its two siblings already had, filtered to `stage = 'speech'` so a chat
  question and a preview do not take each other's cooldown.
- **The race six buttons actually run had no test.** Every existing supersede
  case went through `select()` or a cached replay; the welcome step calls
  neither, because picking a radio there is deliberately independent of the
  audio. One uncached press overtaking another was uncovered.
- **The refusal sentence was inside the radio's `<label>`**, so it joined the
  control's accessible name — with no key configured, six radios each announced
  with "The coach voices are not set up here" on the end.
- **The player only existed after the effect flushed**, so a press landing before
  that did nothing at all: no "Finding…", no sentence, no log.

**Three things this PR argued for and then did not do**, all caught: `canHear`
was written twice and differently (one spelling trimmed the line, one did not);
the Try button's markup was copied while its sentences were single-sourced,
under a comment explaining why sentences must not be copied; and `.coach-row`
restated a flex primitive the sheet records sharing four separate times.

**And a roster that forgot a coach for the second time.** `src/persona/tone.test.ts`
enumerates every persona to prove the gentle override applies regardless of which
one is selected. It missed the Austrian — under an AI-NOTE claiming the database
test checks the mirror, which it does not: that test asserts the slug SET, not
the per-slug intensity and humour. The note now says so.

### Two decisions, recorded rather than taken quietly

**The archetype, not the man.** The owner asked for a coach as close as possible
to a particular Austrian bodybuilder. What shipped is a former champion from a
village in Styria — the accent, the cadence, the unembarrassed love of the work,
and no name, no title, no film lines. `add-persona` and the achievement skill
both say to twist a reference toward lifting rather than quote it, and a persona
row speaks to users in the app's voice.

**Every coach is male-voiced now.** Five of the six already were; the two recasts
the owner asked for made it six, so the product has no female-voiced coach. ADR
0025 records it as a content decision waiting to be taken rather than one this PR
took.

**Verified in a browser at 375px**, and one Try press spent $0.02 against the
$5 key to prove the paid path end to end — one press, not six.
