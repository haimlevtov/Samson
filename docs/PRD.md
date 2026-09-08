# Samson — Product Specification

A living document. Every feature carries a status: **Built**, **Specified** (agreed,
not yet implemented), or **Deferred** (cut unless time allows). Phases refer to
`PLAN.md`.

---

## 1. Premise

Strength-training software splits into two disappointing halves.

Loggers record what you lifted and leave the interpretation to you — a
spreadsheet with a nicer font. You end up being your own coach, which is fine if
you already know how to programme and useless if you do not.

AI coaches write plausible-sounding programmes that ignore what you actually
did. The failure is structural, not a prompting problem: a language model asked
what your training max is will produce a number that reads correctly and is
wrong, and it will do so with the same confidence as when it is right. A user
cannot tell the difference, and neither can the model.

Samson's premise is that these are two different jobs and should be done by two
different things.

> **Deterministic code owns every number. The model owns interpretation,
> selection within validated bounds, and voice.**

The model never calculates your e1RM, your tonnage, your XP, or your calorie
floor. It reads figures that arithmetic produced, decides what they mean, picks
from a list that SQL already filtered, and says it in a voice you chose. When a
number is wrong, it is a bug in code with a failing test — not a hallucination
nobody can reproduce.

---

## 2. Who it is for

The five synthetic users in `src/seed/archetypes.ts` are not test fixtures that
happen to look like people. They are the product's user segments, written down
first and used to develop against, because each one breaks the product in a
different way.

| Segment                       | Situation                             | What the product owes them                                           |
| ----------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| **Beginner** (Noa)            | Linear progression is working         | Do not overthink it. Add weight, stay out of the way.                |
| **Plateaued** (Dan)           | Trains hard, no progress in six weeks | Notice it before he does, and change one specific thing.             |
| **Returning** (Maya)          | Five weeks off, coming back           | Do not resume at the old load. Rebuild deliberately.                 |
| **Equipment-limited** (Yossi) | Dumbbells that stop at 30 kg          | Never prescribe something he physically cannot do.                   |
| **Inconsistent** (Tom)        | Makes about half his sessions         | His problem is adherence, not volume. More work is the wrong answer. |

The last two are the ones most products get wrong. A plan that assumes a full
rack is worthless to Yossi, and a plan that adds volume for Tom mistakes his
problem entirely.

---

## 3. Product principles

These are the ten engineering invariants in `CLAUDE.md` restated as promises to
the user. They are the same rules; this is what they mean from the outside.

1. **The coach never invents a number.** Every figure you see was computed and
   unit-tested. If the coach quotes it, you can trust it.
2. **Rest is part of the plan.** Scheduled rest maintains your streak and earns
   the same credit as training. Progress comes from adherence, never from
   volume, because volume-scaled rewards pay people to overtrain.
3. **The plan respects the room you train in.** Equipment you do not own is
   filtered out in the database before the coach ever sees a candidate list.
4. **Personality changes delivery, never content.** Switching coach voice cannot
   change a single number in your plan. This is enforced by test, not by prompt.
5. **Safety limits are not negotiable by conversation.** No phrasing, persona, or
   request moves a volume cap or a calorie floor. Attempts are blocked and
   logged.
6. **Your data is yours.** Row-level security is on for every table; a query as
   one user cannot reach another user's rows, and the application never holds a
   credential that could bypass it.

---

## 4. How it works, as the user experiences it

```
what you say  →  normalizer  →  metrics engine  →  planner  →  safety critic  →  persona  →  you
                    (LLM)          (code)          (LLM)       (LLM + rules)     (LLM)
```

- **Normalizer** turns "three by five at sixty, last one was a grind" into
  validated set data. It reads language; it does not do arithmetic.
- **Metrics engine** computes e1RM, tonnage, adherence, PRs and training load.
  Pure functions, no model, near-total test coverage.
- **Planner** receives those numbers plus your goal, equipment and available
  days, and emits a training block chosen from a pre-filtered candidate list.
- **Safety critic** runs on a _different model_ from the planner and rejects
  plans with structured reasons — volume caps, deload cadence, injury
  exclusions. The planner retries, at most three times. A critic sharing the
  planner's weights shares its blind spots.
- **Persona layer** changes only how the finished plan is delivered.

---

## 5. Surfaces

### 5.1 Logging — **Built** (phase 1)

Start a session, pick an exercise, record weight, reps, RPE and whether it was a
warm-up. A rest timer starts on its own when a set is logged and counts down
from a stored deadline, so a locked phone does not lose it. A session timer
counts from when you actually began.

The exercise picker searches 873 catalogue exercises, filtered in SQL to
equipment you own — Yossi sees 245, none of them requiring a barbell.

_Deliberate omission:_ tonnage counts external load only. A bodyweight pull-up
contributes zero, because imputing bodyweight would silently rewrite months of
history every time your weight changed.

### 5.2 Insight — **Built** (phase 1)

Adherence over four weeks, current streak, weekly tonnage, and acute:chronic
workload ratio. Best estimated 1RM per lift, with the estimate withheld above 12
reps where the Epley formula stops being trustworthy — a blank is more honest
than a confident wrong number.

Every figure carries a "?" explaining what it measures and how it is computed,
because "acute:chronic 1.23" means nothing to someone who has not met the term.

**And one figure is allowed to stop being a figure.** Lifetime tonnage is the
largest number on the page and the one nobody can picture, so it is also given
as the heaviest thing you have moved the weight of — "about a humpback whale".
The objects are rows with a stated range apiece, and the rule for choosing one
is [ADR 0018](adr/0018-tonnage-comparisons.md), which explains why it is the
heaviest object you have passed rather than the one that divides most neatly.

### 5.3 Coaching — **Specified** (phase 2)

Given your history, goal, equipment and available days, produce a training block
that survives the safety critic. Acceptance: every case in a ~30-history golden
set yields a schema-valid plan within the retry cap; volume increases stay under
cap; no unavailable equipment appears; a deload lands by week five; injured
joints are absent.

_This is the highest-unknown part of the product._ It is scheduled early
specifically so that if it does not work, there is still time to change course.

### 5.4 Voice — **Specified** (phase 3)

Three coach personas at launch: the Rival, the Analyst, and one of the Sergeant
or the Old Master. Each is a database row — system prompt, language and voice
variant, intensity, humour tier, banned phrases — not a code branch.

**Five as of 2026-09-08**, phase 5's content fill. The Old Master was the one
picked at launch; the **Sergeant** is the other half of that sentence, finally
built, and it is the first row to reach the `crude` humour tier that
`users.humor_max_level` has offered since the first migration with nothing
behind it. The **Physio** is an argued addition rather than a promised one: the
three shipped coaches sat at intensity 2, 3 and 4, so choosing between them
changed the jokes more than the register. Note that it is _not_ the tone
override below — that applies regardless of which persona is selected and is
therefore an argument against needing a gentle coach, not for one.

**Corrected 2026-09-07.** This said "TTS voice", which promised something the
project does not have: there is no TTS provider and the only key here is for
text ([ADR 0006](adr/0006-persona-boundary.md)). Delivery uses the browser's own
`speechSynthesis`, so a persona cannot carry a voice — the device decides which
voices exist and they differ per browser and per OS. What the row carries is a
language hint (`tts_voice_id`, a BCP-47 tag) and a `tts_voice_variant` saying
which of the matching voices this coach takes. Persona voice is therefore tone,
rate and word choice rather than timbre.

Personas may not alter any number in the plan they receive, asserted by test. A
tone override forces a gentler register when an injury or a run of missed
sessions is flagged, regardless of which persona is selected. High-frequency
cues (rest over, set logged, PR hit, last set) are spoken live by the browser,
with a tone as the fallback where speech is unavailable — not precomputed audio,
for the same reason as above.

### 5.5 Progression and rewards — **Built** (phases 4–5)

XP from adherence with a weekly ceiling and diminishing returns. Streaks that
count planned days, so scheduled rest sustains them. Achievements as database
rows with SQL predicates — including hidden ones, and calendar-triggered ones
that fire on _your_ local date rather than the server's. Daily quests and weekly
challenges from a validated pool. Progression trees for push, pull, legs and
core.

**Progression trees — built 2026-09-08**, at `/progression-trees`, reached from
Profile. Four ladders of four to six rungs; a rung opens when you have done the
one below it, measured as **sets within a single session** rather than a
lifetime total — three sets of ten spread over three months says nothing about
whether the next step is reachable. Nothing is stored: unlocks are recomputed
from your logged sets on every page load, so correcting a session corrects the
tree. The criteria are structured data a validator reads, never code the server
runs — [ADR 0020](adr/0020-progression-unlock-criteria.md) explains why that
distinction is a security one rather than a stylistic one.

_Not yet expressible: a timed hold._ There is no duration column on a set, so
the plank at the root of the core tree has no criteria and the rung above it
inherits none. Recorded in the ADR rather than faked with reps.

**A hidden badge is hidden until you earn it, then it is yours.** Its
definition is withheld from every client while it is locked, and shown in full
to the person holding it — [ADR 0017](adr/0017-held-hidden-achievements.md).
This section previously said the definitions are "never sent to the client",
which read as a privacy promise and was really a description of a policy; the
effect was that unlocking a secret badge showed you nothing at all.

Every completion is verified server-side. Nothing can be granted from the
client, and submitted loads face plausibility checks — an empty bar spammed for
reps must not unlock a volume badge. The volume badge additionally requires its
tonnage to accumulate over thirty separate logged days, because a weight floor
would be an absolute claim about how strong a person ought to be and this
project refuses those; see
[`specs/xp-and-challenges.md`](specs/xp-and-challenges.md).

### 5.6 The leaderboard — **Built** (phase 5)

The one surface in the app where you see another person. On the Hub tab: a
ranking by lifetime XP, showing a **display name and a total, and nothing
else** — no email, no session history, and no user id.

Two rules make it something a user chooses rather than something that happens
to them. **You are not listed until you set a display name**, so appearing
requires having picked the name you appear under; the alternatives were an email
local part, which turns a game into a directory, and a generated placeholder,
which ranks somebody who never volunteered. And **leaving is one checkbox** on
`/settings`.

What it does not promise is written down too, because the settings screen makes
a privacy claim at the moment of consent: an XP total only rises and can be
polled, so somebody watching closely can infer roughly when you train. Display
names are not unique, so two people can share one.

The mechanism, and why it is a view rather than a privileged client, is
[ADR 0016](adr/0016-leaderboard.md) — this is the first feature in the project
that reads another user's rows, which invariant #10 forbids by default.

### 5.7 Diet — **Deferred** (phase 6)

Maintenance calories by equation, bounded adjustment, and a floor hard-clamped
in code. The model explains the number; it never chooses it. Supplement answers
are retrieval-only from a curated table with evidence grades and resolvable
DOIs. Acceptance is adversarial: no prompt, persona or framing moves the floor,
and every attempt is logged.

### 5.8 Import — **Deferred** (phase 6)

`.fit`, `.tcx`, `.gpx` and Apple Health XML. File import is the primary path and
must demo without any native module. Health Connect and HealthKit only if a test
device exists.

---

## 6. Non-goals

Not built, and not by accident: caching layers, queues, real-time sync, push
notifications, payments, containers, multi-region, load testing.

This runs for one demo on free tiers. Scaling work is deferred explicitly rather
than forgotten, and building it would consume the time the planner and the
adversarial suite actually need.

Also out of scope: social feeds, coach marketplaces, wearable-first tracking, and
anything requiring a native app. Samson is a web app you open at the gym.

---

## 7. How success is judged

Product criteria live in each phase's acceptance list in `PLAN.md`. Beyond those,
the course grades the development process itself, which makes three things
deliverables in their own right:

- **Artifact trail** — spec, agent plan, ADR, diff, test and eval result per
  phase. `docs/plans/` and `docs/adr/` are part of the submission, not
  housekeeping.
- **Token economics** — cost per user per week by pipeline stage, cache hit rate
  over time, retry cost, and cascade saving measured against an
  all-strong-model baseline. This is why `llm_calls` was built before the first
  agent: the data cannot be reconstructed afterwards.
- **Adversarial taxonomy** — what got through, not just what was blocked.
  Injection in workout notes, jailbreaks against the critic, fabricated
  achievements via the normalizer, unsafe deficit requests.

---

## 8. Known risks

| Risk                                                          | Standing                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The planner/critic loop may not converge within the retry cap | Scheduled early on purpose, so failure is discoverable while there is time to change approach                                                                                                                                                    |
| The token ledger is empty                                     | The gateway works and is tested, but no live call has run. Every day without a key is development-period data lost permanently                                                                                                                   |
| The safety guard catches only the crude and obvious           | Started in phase 2 — 45 cases, and `src/llm/safety.ts` blocks injection, demeaning language, protected-attribute mentions and credential shapes. It cannot catch coded language or bias in neutral vocabulary; see `docs/adr/0005-llm-safety.md` |
| Bodyweight is a single current value                          | Fine for tonnage, which excludes it. Phase 6's diet advisor needs a recent weight and may need a time series                                                                                                                                     |
| Free-tier Supabase pauses after a week idle                   | A daily cron pings the health endpoint. Wake the project the day before a demo regardless                                                                                                                                                        |
