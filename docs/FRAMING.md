# Samson — Framing

The four deliverables of project framing, produced by a reverse interview
conducted on 25/08/2026. Written in pencil: revise as the work teaches more.

The interview record and the two lists it produced are at the bottom. The second
list — the assumptions — is the part worth reading twice.

---

## 1. Problem statement

> People who live in front of screens — gamers, anime and film fans, the
> chronically online — abandon training. Not for lack of information: there is
> more of that than anyone needs. They abandon it because nothing about training
> rewards them the way the things they already love do. It stays a chore, and
> chores lose.

Several different solutions fit this problem, which is the test of whether it is
a problem statement rather than a solution wearing one. A social app, a game
with real-world inputs, a habit tracker, a human coach, and a companion that
knows your history would all be reasonable attempts.

Samson's attempt: a coach with a personality that reacts to what you actually
did, wrapped in a progression system that pays out for turning up.

## 2. Stakeholder list

| Stakeholder                      | Stake                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The user**                     | Nerds, gamers, screen-heavy. Any training experience, from never lifted to daily scientific bodybuilding — the segment is cultural, not experiential. |
| **Haim**                         | Sole developer, sole maintainer, and the first tester.                                                                                                |
| **The course instructor**        | Approves it. Grades how well the agent was directed, not the app that ships — and only what can be opened and verified.                               |
| **The beta crowd**               | Later, unnamed. Their absence is why the product definition of done is deferred.                                                                      |
| **The user's body**              | Does not use the app and cannot complain to it. Bears the cost of a plan that overreaches.                                                            |
| **Model and platform providers** | OpenRouter is metered; Supabase and Vercel free tiers have limits that a runaway loop can reach.                                                      |

The fifth entry is the one most easily left off, and slide 20's test is that
nobody should discover themselves on the list too late. It is the reason
invariant #4 exists (XP from adherence, never volume — volume-scaled rewards pay
people to get hurt), the reason the safety critic runs on a different model from
the planner, and the reason the diet floor is clamped in code.

## 3. Definition of done

The interview surfaced that there are **three** of these, they are not the same,
and only one is being optimised for right now.

### Course — the one that governs, and the deadline that binds

What the instructor can open and verify: the artifact trail (spec, plan, ADR,
diff, test, eval result per phase), the token ledger analysis, and the
adversarial taxonomy. Judged on direction of the agent, not on the app.

### Prototype — the target, ~2 weeks from 25/08/2026

**"It coaches."** Observable, and two people could not disagree about it:

1. A model generates a training block from a real seeded history — not a fixture
2. A _different_ model rejects an unsafe one with structured reasons, and the
   retry loop is visible
3. The accepted plan is delivered in a persona's voice, recognisably in character
4. Every call above appears as a row in `llm_calls` with tokens and cost

This requires phases 2 and 3. Phase 2 has not started.

### Product — deferred

Whether it makes training feel less like a chore. Unobservable in this project's
lifetime: no users, no retention curve, no second cohort. Deferred to beta, and
explicitly _not_ what the next two weeks are judged against.

## 4. Out-of-scope

Entries earn a place only if someone could reasonably have expected them.

| Excluded                                                                  | Why it could have been expected                                                                                                                                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Social — guilds, friends, shared PRs** (leaderboard shipped, see below) | The audience is gamers and the retention mechanic is XP. Every game they play is social. Samson is a multiplayer idea shipped single-player for the showcase; direction recorded at the end of `PLAN.md`. |
| **Push notifications**                                                    | The standard re-engagement mechanic in this category. Without it XP only fires once the user has already opened the app.                                                                                  |
| **Native mobile app**                                                     | Phone-first is a requirement; a native app is not. It is a web app that must work well on a phone.                                                                                                        |
| **Real-time sync**                                                        | Multi-device training logs are a reasonable expectation of a fitness app.                                                                                                                                 |
| Caching layers, queues, payments, containers, multi-region, load testing  | Infrastructure nobody expected here. Listed in `PLAN.md` for completeness.                                                                                                                                |

**Amended 2026-09-07 — the leaderboard shipped.** The social row above excluded
it, and that exclusion no longer holds. It was built because the Hub tab needed
to own something (ADR 0013) and a ranking is the smallest social feature that
does not need a second user relationship: no friends, no guilds, no invitations,
no shared PRs — just a name and a number that other people can see. Those three
remain excluded for the original reason.

The decision, its four columns and the things it deliberately does not
guarantee are in [ADR 0016](adr/0016-leaderboard.md). It is also the first
feature in the project that reads another user's rows, which is why it has an
ADR at all.

**Amended 2026-09-09 — file import is deferred, and the acceptance criterion goes
unmet.** Phase 6 briefed `.fit`, `.tcx`, `.gpx` and Apple Health XML. Asked which
was meant, the stakeholder answered **"skip Apple Health for now, save it for
later"** — and Apple Health was the only one of the four with somewhere to land,
because it carries a bodyweight time series this schema has no other source for.
The other three are endurance formats and there is no table a GPS track belongs
in, so the whole item waits rather than half of it being built.

**It is recorded here as well as in the plan, deliberately.** `CLAUDE.md` names
this file as the one to read when a decision is disputed, and phase 5 is the
cautionary tale: a stakeholder answer lived in Q2 below, a plan was written
without reading it, and the plan said "that decision has not been made" when it
had. The reasoning and what the deferral costs are in
[`plans/phase-6.md`](plans/phase-6.md); this paragraph exists so the next person
does not have to already know that.

---

## The interview

Conducted per Module 6: one focused question at a time, pressing on vague
answers rather than accepting them.

**Q1 — What is it fundamentally for?** Offered two readings: a training app
where the LLM architecture is a means, or a trustworthy-LLM demonstration where
training is the vehicle. Pressed twice: first that "gamified" is a category and
not a mechanism, and that invariant #4's weekly XP ceiling fits a motivation
engine with a governor on it; then whether the mechanism is the points or the
character.

> **Answer:** A gamified training app for modern youth, making training engaging
> rather than a chore, with an AI coach as the user's "right arm". The two
> mechanisms do different jobs: **the AI acquires — "when someone hears about a
> personal AI trainer they want to try it" — and the XP retains.**

**Q2 — Who, precisely?** Pressed on an apparent contradiction: "get into fitness"
implies beginners, but three of the five seeded archetypes are established
lifters. Then pressed again, on `PLAN.md` filing the entire cultural layer under
"safe to cut down if time runs short."

> **Answer:** Nerds — gamers, anime, film and TV fans, people who spend a lot of
> time in front of screens. A nerd may be a complete beginner or deeply invested
> in scientific bodybuilding and training daily. **Phase 5 is not cut, only
> sequenced last.**

The premise of the press was wrong and the answer corrected it: the segmentation
axis is cultural, not experiential, which is precisely why the archetypes span
experience levels.

**Q3 — How would anyone know it had worked?** Noted that every acceptance
criterion in `PLAN.md` is an engineering criterion, all of which can pass while
the product is joyless, and that three different definitions of done were in play.

> **Answer:** Haim is the first tester; a wider beta comes later.

**Q4 — What are you choosing to leave out?** Observed that the existing
out-of-scope list is infrastructure nobody expected, and that the expectable
omission — social — was not on it at all, nor was any replacement for push
notifications as a re-engagement channel.

> **Answer:** Multiplayer as an idea; single-player for the class showcase;
> possibly shipped wider later.

**Q5 — Which constraints, and which did you only assume?**

> **Answer:** More than two weeks, ideally a working prototype sooner.
> **Phone-first, and it must work on the web too.**

**Q6 — What could someone observe to prove the work is done?** Offered three
readings of "working prototype": it logs and measures (done today), it plans
(phase 2), or it coaches (phases 2 + 3).

> **Answer: (c) — it coaches.**

---

## The assumptions list

Every decision made during phases 0 and 1 where nothing was said. Each is a
silence that now has to be a choice. **Load-bearing** marks the ones that change
the product if wrong.

### Numbers invented outright

> Started as the phases 0–1 list this section describes; extended since, because
> the category is the point rather than the phase. A row in _italics_ names a
> file that is planned rather than written — the number was chosen in an ADR
> before the code. There are none today.

| Assumption                                                             | Where                                     |                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secondary muscles receive 0.5 of a set's tonnage                       | `tonnage.ts`                              | **Load-bearing** — phase 2 volume caps are expressed against it                                                                                                                                                                                             |
| Epley is withheld above 12 reps                                        | `e1rm.ts`                                 | **Load-bearing** — decides when the app admits it does not know                                                                                                                                                                                             |
| ACWR is uncoupled, 7 days over 28, bands at 0.8 / 1.3 / 1.5            | `acwr.ts`                                 | **Load-bearing** — the critic will gate plans on this                                                                                                                                                                                                       |
| Bodyweight movements contribute zero tonnage                           | `tonnage.ts`                              | **Load-bearing** — a bodyweight-only user shows a flat zero line                                                                                                                                                                                            |
| Warm-ups are excluded from tonnage and can never set a PR              | `tonnage.ts`, `pr.ts`                     |                                                                                                                                                                                                                                                             |
| Adherence is shown over a 4-week window                                | `workouts/page.tsx`                       |                                                                                                                                                                                                                                                             |
| Default LLM budget is $0.50 per user per week                          | `users` column **and** `guard_llm_budget` | **Load-bearing** — a low cap silently truncates phase 2 evals; the figure is in two places since ADR 0026. `beginner@samson.test`, the account the sign-in page fills in, has $2.00 — `archetypes.ts` and migration `20260913090000` (ADR 0026's amendment) |
| 3 attempts, 60s timeout, 500ms backoff                                 | `config.ts`                               |                                                                                                                                                                                                                                                             |
| Speech: 2 attempts, 20s timeout                                        | `config.ts`                               |                                                                                                                                                                                                                                                             |
| A spoken preview is charged $0.02 against the budget                   | `config.ts`                               | **Load-bearing** — 25 previews spend a default week                                                                                                                                                                                                         |
| Rest defaults to 120s, presets 60/90/120/180                           | `RestTimer.tsx`                           |                                                                                                                                                                                                                                                             |
| Model per stage: flash-lite normalizer, sonnet-5 planner, flash critic | `models.ts`                               | **Load-bearing** — this is the cost structure                                                                                                                                                                                                               |
| Bodyweight under 1000 kg, height under 300 cm, born after 1900         | `diet/biometrics.ts`                      | Human bounds rather than the columns', and what excludes NaN                                                                                                                                                                                                |
| Calorie floor is `max(BMR, 1200)`                                      | `diet/energy.ts`                          | **Load-bearing** — the whole safety property of the diet advisor                                                                                                                                                                                            |
| Calorie ceiling is 6,000, and reaching it is a refusal                 | `diet/energy.ts`                          | **Load-bearing** — it is what stops a mistyped height rendering                                                                                                                                                                                             |
| Deficit capped at 20% of TDEE, surplus at 15%                          | `diet/energy.ts`                          | **Load-bearing** — the bound the model cannot argue with                                                                                                                                                                                                    |
| `unspecified` sex takes the male Mifflin constant, the higher one      | `diet/energy.ts`                          | Erring toward more food — ADR 0024 §3                                                                                                                                                                                                                       |
| Activity bands at 0.5 / 3 / 5 / 7 sessions per week                    | `diet/energy.ts`                          | Standard Mifflin multipliers, read off logged sessions                                                                                                                                                                                                      |
| Protein target is 1.8 g per kg of bodyweight                           | `diet/energy.ts`                          |                                                                                                                                                                                                                                                             |

### Product behaviour never discussed

**Added 2026-09-09 — the diet advisor withholds a calorie target from anyone
under 18.** Nobody was asked whether the product should have an age gate, and it
now has one: `MIN_AGE_YEARS` in `diet/energy.ts` refuses a target and points at a
professional instead. It is a real product decision — a whole feature withheld
from a class of user — made on the basis of a self-reported birth date that
nothing verifies. [ADR 0024](adr/0024-diet-advisor.md)'s does-not-guarantee table
says what it buys (the honest case, and an audit trail) and what it does not
(anything, against a minor who wants a number).

- **Detraining costs 65% of accumulated progress** after a layoff (`archetypes.ts`). Invented, then tuned when a test proved the first value invisible.
- **Every archetype's parameters** — weeks of history, days per week, adherence rate, starting loads, progression increments, and their timezones (Jerusalem, Berlin, New York, London).
- **Six bodyweight accessories in the shared programmes** (2026-09-08), added so the progression trees have someone standing on them. Each is the lift a rung asks for, at a rep count set against that rung: lying leg raises and push-ups at 16 where their criteria ask 15, and bodyweight squats at 21 where the lunge rung asks 20 — one rep over, because a later set drops a rep a quarter of the time; inverted rows and incline push-ups at 14 where theirs ask 12; and the hanging leg raise at exactly its rung's 12, so it opens on some sessions and not others. The squats replaced chair squats on 2026-09-11 (ADR 0020's amendment). Ordinary training to read, authored to demonstrate a feature in fact, and the distinction is the reason this line exists.
- **Everything a coach is** — five character descriptions, their banned-phrase lists, intensities and humour tiers, a sample line each since 2026-09-11 (migration `20260911130000`), and since the same day a voice and a written direction each (migration `20260911140100`), cast by one author against Google's one-word descriptions of the voices, and heard by one listener — the owner, on 2026-09-11 after #50 ("voice perfect", ADR 0025). The device-voice allocation this line used to list is gone (ADR 0025). Written by one author and judged "recognisably its own" by the same one; the persona drift eval that would measure any of it does not exist (`docs/PLAN.md` phase 3).
- **Eleven challenge-pool rows** — their kinds, targets, windows and XP rewards. The seven originals were invented outright; the four added on 2026-09-09 were **calibrated against the demo users' own histories** so that every archetype is offered something, which is a stronger admission: their targets (5 sessions, 25 hard sets, 6 movements a day, 6 hard sets a day) exist because of what the seeded lifters already do, not because of what a coach would prescribe. Same category as the six bodyweight accessories above, and named here for the same reason.
- **Which exercise categories count as programmable** — strength, powerlifting, olympic, strongman, plyometrics. Stretching and cardio are filtered out of every planner candidate list.
- **The canonical equipment vocabulary** and which source names collapse onto which tag.
- **Movement patterns for ~30 compound lifts**, curated by keyword; everything else is left NULL.
- **`samson-demo-fixture`** as the password for every seeded account, published on the live sign-in page.
- The **visual system** — violet `#6c4df6`, light theme, 16px radius. Three directions were offered and one chosen; every specific value is mine.
- All **hint copy** explaining reps, RPE, adherence, streak, tonnage and ACWR.

### Method assumptions, now known to conflict with the course

- **I wrote every test for my own code.** Lesson 7 names this failure directly — _"the agent writes the code, then writes its tests. It writes them by reading the code"_ — and prescribes separating the author of the tests from the author of the code, showing the second only the specification.
- **The PRD sits outside `CLAUDE.md`**, referenced rather than inlined, on token-cost grounds. The lesson 7 pipeline slide says specs and PRD go _into_ `Claude.md`.
- **No design step ran before the UI was built.** Lesson 5 specifies four things an interface specification must contain — user flow, information hierarchy, interaction model, and feedback with its bad states. None were written. The design rework already requested traces directly to this.
- **Desktop-first.** A 1000px shell, data tables, a form that collapses only below 760px. Now known to be backwards: the answer to Q5 was phone-first.
- **No hooks.** Invariants are advised in `CLAUDE.md` and checked by tests and lint. Lesson 6: _"a file advises; a hook enforces."_
- **No subagents, ever.** Lessons 8 and 14–15 cover multi-agent decomposition; the one use that clearly earns its keep here — an independent test author — was not used.
- **Branch per phase, merged to `main`.** Never discussed.
