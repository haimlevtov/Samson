# Samson — Build Plan

Phases are ordered by **risk**, not importance. Known-solution work compresses
under deadline pressure; unknown work expands. The planner/critic loop is the
only part where it is genuinely unclear whether the approach works, so it runs
early while there is still time to change course.

Each phase is written as a brief. Hand one to an agent in plan mode, review the
plan it produces, then implement. Do not start a phase before the previous one
meets its acceptance criteria.

**Current phase: 5** — phases 0 to 4 are complete; see `docs/plans/` for the
plan and recorded outcome of each. Phase 3 carries one unmet
criterion (persona drift), waiting on live runs rather than on work. Phase 4
met all four of its criteria, and every gap its outcome named is now closed.

---

## Phase 0 — Foundations

Nothing here is visible to a user. All of it is expensive to retrofit.

**Build**

- Repo, TypeScript strict, lint, format, `CLAUDE.md`, this file
- Supabase project; migration tooling; RLS enabled on every table from the
  first migration
- Full schema for the whole product, even where unimplemented: users,
  workouts, sets, exercises, equipment tags, personas, achievements,
  achievement_events, xp_events, challenges, progression_nodes, llm_calls
- `src/llm/gateway.ts` — OpenRouter client with usage accounting on,
  `max_tokens` always set, `models` fallback array, Zod validation of
  responses, retry with backoff, per-user budget check, one `llm_calls` row
  per call including failures
- CI: typecheck, lint, unit tests. Must pass with no API key present.
- Vercel deploy of an empty app; GitHub Actions daily cron pinging Supabase so
  the free-tier project never sleeps before a demo

**Acceptance criteria**

- `npm test` passes in CI with no secrets configured
- A scripted call through the gateway writes a complete `llm_calls` row with
  prompt, completion, and cached token counts plus native cost
- A query as user A cannot read user B's rows
- `npm run migrate` rebuilds the schema from zero

**Why first:** every agent written before the gateway exists is an agent
rewritten afterwards, and the token data from the whole development period is
lost. That data is part of what the project is graded on.

---

## Phase 1 — Deterministic substrate

**Build**

- Workout logging: sessions, exercises, sets with weight/reps/RPE, rest timer
- Exercise catalogue seeded from wger and the Free Exercise DB, with
  normalised equipment tags
- Metrics engine: e1RM (Epley), session and weekly tonnage, tonnage by muscle
  group, adherence rate, PR detection, acute:chronic workload ratio
- **Seeder**: synthetic users with 8+ weeks of realistic history — a beginner,
  a plateaued lifter, someone returning after a layoff, a home-gym user with
  capped dumbbells, someone who misses half their sessions

**Acceptance criteria**

- Metrics engine has near-total unit coverage and runs in milliseconds
- `npm run seed` produces a fully populated, demoable database in under a
  minute from an empty schema
- Every synthetic user's metrics look plausible on manual inspection

**Why here:** the seeder is on the critical path and looks like throwaway work.
Without it there is no way to develop or evaluate the planner, because real
history takes months to accumulate. Do not defer it.

---

## Phase 2 — Planner and critic

The highest-unknown phase. If something is going to break the timeline, it is
this, and it needs to break now.

The arrangement is the **evaluator-optimizer** pattern: one agent produces, a
second judges, the first revises until the work passes. It suits work where
quality outweighs speed, which this is.

**Build**

- Planner: given metrics, goal, equipment profile, and available days, emits a
  validated training block
- **Deterministic rule checks — `src/planner/rules.ts`.** Weekly volume increase
  against cap, deload cadence, injured-joint exclusion, equipment availability
  and per-item load ceilings. Pure functions over the plan, unit-tested, run on
  every plan **regardless of what the critic model says**.
- Safety critic, on a different model from the planner: judges what the rules
  cannot — is this sensible training for this person. Rejects with structured
  reasons; planner retries; hard cap of 3 loops
- Golden eval set: ~30 synthetic histories with property-based assertions
- Prompt structured static-first, dynamic-last, so the cache prefix holds
- **Coordination design — `docs/adr/0004-planner-critic.md`**, written before any
  agent runs. Names the pattern and where it applies; each agent's role, input,
  output and boundary; how work passes between them; what happens when one
  fails; what the arrangement costs and buys.

**WHY the rules are code and not the critic's opinion.** Schema validation is a
form check: it catches a malformed plan and nothing else. A plan prescribing
twenty sets of squats is schema-valid. A model asked to enforce a volume cap
will usually enforce it and will sometimes produce a fluent, confident,
well-formed answer that does not — and no shape check can tell the difference.
The cap is arithmetic, so it is arithmetic that enforces it. The critic model
adds judgement on top of a deterministic floor; it does not replace the floor.

**AI-NOTE:** if a rule can be expressed as a comparison against a number, it
belongs in `rules.ts`. Only send to the critic what genuinely requires reading
the plan as a whole.

**Handoffs carry structure, never prose.** The critic receives the plan as data
and returns rejection reasons as data. Flattening either to prose loses the
shape and the next stage has to guess it back — occasionally wrong, always
silently. This is also the mechanism that makes phase 3's "the persona cannot
alter a number" testable.

**On repeated failure, escalate rather than repeat.** A schema failure that
survives one corrective retry should move to a stronger model rather than asking
the same one again. The cost of that escalation is exactly what the cascade
analysis is measuring.

**Acceptance criteria**

- Every golden case produces a schema-valid plan within the retry cap
- Property assertions hold across all cases: volume increase within cap, no
  unavailable equipment, deload present by week 5, injured joints absent
- **Every rule in `rules.ts` has a test that fails a plan violating it**, and a
  plan that passes the rules but is rejected by the critic is recorded as such —
  the two rejection sources are never conflated in the ledger
- Cache hit rate measured and recorded in the report notes
- Cost per plan generation recorded per model tried

---

## Phase 3 — Normalizer and persona

**Build**

- Normalizer: free text or voice into validated set JSON, schema retry on
  failure
- Persona layer: receives a finished plan, changes only delivery. Personas are
  config rows — system prompt, TTS voice id, intensity, humor tier, banned
  phrases
- Ship three personas: the Rival, the Analyst, and one of the Sergeant or the
  Old Master
- Precomputed audio clips for high-frequency live events (rest over, set
  logged, PR hit, last set), generated once at persona creation
- Persona drift eval: does turn 80 still sound like turn 3

**Acceptance criteria**

- Persona layer cannot alter any number in the plan it receives — asserted by
  test, not by prompt
- Drift eval scores recorded for all three personas
- Tone override forces a gentler register on injury or missed-session flags,
  regardless of selected persona

---

## Phase 4 — Gamification vertical slice

One of each, end to end. This is about plumbing, not content.

**Build**

- XP: one source, adherence-based, with weekly ceiling and diminishing returns
- Streaks counting planned days, so scheduled rest maintains them
- One achievement: row, SQL predicate, unlock evaluation, visible badge in UI
- Daily quests reusing the challenge validator with a shorter window
- Weekly challenge batch job: generate a pool, validate, assign from the pool
- Server-side verification of every completion; plausibility checks on
  submitted loads

**Acceptance criteria**

- Property tests: XP is monotonic, never exceeds the weekly cap, and no
  sequence of sessions can breach the ceiling
- A rejected challenge is inspectable — the validator logs why
- A badge visibly fires in the UI on unlock
- No completion can be granted from the client

---

## Phase 5 — Content fill

Compressible and parallelisable. Safe to cut down if time runs short.

**Build**

- Remaining achievements across all tiers, including hidden ones and calendar
  events evaluated in local date
- Cumulative-tonnage comparisons (bus, elephant, whale)
- Remaining personas
- Progression trees: push, pull, legs, core
- Curated evidence table: one row per supplement with evidence grade, dosing
  range, interaction flags, and backing DOIs, sourced from NIH ODS fact sheets
  and ISSN position stands

**Acceptance criteria**

- Hidden achievement definitions are never sent to the client
- A test asserts every evidence-table claim has a resolvable DOI
- Calendar achievements fire on the correct local date for a user in a
  non-server timezone

---

## Phase 6 — Optional features

Both are self-contained. Cut either without breaking anything above.

**Build**

- File import: `.fit`, `.tcx`, `.gpx`, Apple Health XML
- Health Connect and HealthKit, only if time allows and a test device exists
- Diet advisor: maintenance computed by equation, bounded adjustment,
  hard-clamped floor in code, retrieval-only supplement answers

**Acceptance criteria**

- File import is the primary path and demos without any native module
- Adversarial suite: no prompt, persona, or user framing moves the calorie
  floor. Every attempt blocked and logged.

---

## Cross-cutting, running throughout

- **Adversarial suite** grows every phase: injection in workout notes,
  jailbreaks against the critic, fabricated achievements via the normalizer,
  unsafe deficit requests. Report the taxonomy of what got through.
  **Started in phase 2** — `src/llm/safety.test.ts`, 45 cases, design in
  `docs/adr/0005-llm-safety.md`. Half of them assert that ordinary coaching
  language is _not_ caught: a guard that fires on "keep your back straight" is
  one somebody switches off, and then it protects nobody. The suite also
  records what it deliberately does not catch, because the taxonomy asked for
  here is the list of what got through.
- **Token ledger analysis**: cost per user per week by pipeline stage, cache
  hit rate over time, retry cost, cascade saving measured against an
  all-strong-model baseline.
- **Artifact trail**: spec, agent plan, ADR, diff, test, eval result for each
  phase. For a course grading agentic development, this trail is the
  submission.

### The merge gate

Defined here, before the work, because a standard invented afterwards bends to
fit the work it is meant to judge. Nothing enters `main` without it, every time.

Cheap gates run first and need nobody present — typecheck, lint, format, unit
tests, the DB suite. Attention is never spent on work the tests already reject.
The human gate sits last, at the merge boundary.

At that boundary a change presents a **merge-readiness pack**, and each item is
shown by evidence rather than asserted:

|                         | Evidence                                                               |
| ----------------------- | ---------------------------------------------------------------------- |
| Functional completeness | The acceptance criterion it claims to satisfy, and how it was observed |
| Sound verification      | What the tests actually assert — not a coverage figure                 |
| Engineering hygiene     | Typecheck, lint, format, migrations applied from zero                  |
| Rationale               | Why this approach, and what was rejected                               |
| Audit trail             | Plan, ADR if a decision was made, and the diff                         |

**Coverage is not evidence.** It records which lines ran, never whether anything
was checked. The 95% threshold in `vitest.config.ts` is a smoke alarm, not a
verification gate, and must not be cited as one.

## Demo preparation

- Demo account pre-seeded with a plateau, a PR, an injury note, and a
  half-filled achievement wall. Never rely on live logging on stage.
- Wake the Supabase project the day before.
- `npm run seed` must rebuild everything from zero in under a minute.

---

## Beyond this plan — direction, not commitment

Nothing here is scheduled. It is written down so that decisions made during the
phases above do not quietly foreclose it.

**Samson is a multiplayer idea shipped single-player.** The class project is a
single-player showcase. If it proves worth continuing, the social layer is the
obvious next product: leaderboards, guilds, shared challenges, comparing a PR
against people whose training you can see.

**What that will cost, stated now rather than discovered later.** Every table is
restricted to `user_id = auth.uid()`, and no policy anywhere permits a
cross-user read — see `docs/adr/0002-catalogue-user-id.md`. That is correct for
a single-player app and it is not a mistake to undo, but it means social
features are real work rather than an additive feature flag. They need either
policies scoped to a group the viewer belongs to, or `SECURITY DEFINER`
aggregate views that expose a ranking without exposing the rows behind it.
Invariant #10 survives either way; the effort is in choosing which.

**Re-engagement has no channel.** Push notifications are on the out-of-scope
list above, which is right for one demo. But XP is the retention mechanism, and
without notifications it only fires once the user has already decided to open
the app. A streak that nobody is reminded of is a scoreboard, not a habit. Any
serious attempt at retention starts here.
