# Phase 3 — Normalizer and persona

Branch: `phase-3-normalizer-persona`, off `main` at `6bbcd24`.

## Context

Phases 0–2 are merged and green in CI. The app logs, measures, and can produce a
validated training block. What it cannot do is **talk**, and that is the half of
"it coaches" — the prototype definition of done in `docs/FRAMING.md` — that is
still missing.

Two stages remain unbuilt. `normalizer` and `persona` exist today only as
entries in `LlmStage` and rows in `STAGE_MODELS`; nothing calls them.

This phase is also where phase 2's deferral comes due. `plan_runs.block` holds
JSON that no surface renders, so nothing in the running app has ever shown a
plan to anyone.

### The constraint, unchanged

There is still no `OPENROUTER_API_KEY`. As in phase 2, everything is built
behind injected dependencies and proved offline against a scripted model; what
needs a real model is named rather than quietly skipped.

| Acceptance criterion                                                             | This phase         |
| -------------------------------------------------------------------------------- | ------------------ |
| Persona layer cannot alter any number in the plan it receives — asserted by test | ✅ fully offline   |
| Tone override forces a gentler register on injury or missed-session flags        | ✅ offline         |
| Drift eval scores recorded for all three personas                                | ❌ **needs a key** |

### Decisions taken before planning

- **Voice is the browser's `speechSynthesis`**, not a TTS provider. No key, no
  second secret, no storage decision, and `RestTimer.announceRestOver()` already
  isolates the cue behind one function for exactly this swap. The cost is honest
  and worth stating: persona voice becomes _tone and word choice_, not timbre,
  and nothing is precomputed.
- **Both surfaces ship.** A coach page that renders a delivered plan, and
  free-text set entry on the session screen. Without them "delivered in a
  persona's voice" is not observable, and the demo is the point.
- **Third persona is the Old Master**, alongside the Rival and the Analyst. It
  contrasts hardest with the Rival, which is what makes a drift eval mean
  anything.

---

## Build order

### 1. Three persona rows — migration

`personas` already has every column this needs: `system_prompt`, `tts_voice_id`,
`intensity`, `humor_level`, `banned_phrases`. Invariant #7 — content is rows,
not code — so this is a migration, not a constant.

**`system_prompt` is a column, therefore data.** ADR 0005 §1 forbids
concatenating it into the stage's system prompt. It is passed as a fenced
persona _description_ inside the per-call half. This is unusual enough to be
worth a test of its own.

### 2. `src/persona/` — delivery that cannot touch a number

The stage receives a `TrainingBlock` and returns **prose only**. Its schema has
no numeric field at all, so "cannot alter a number" is structural before it is
tested.

- `schema.ts` — `deliveredPlanSchema`: an opening line, a paragraph per week,
  a closing line. Strings, nothing else.
- `guard.ts` — `assertNoInventedNumbers(block, prose)`. Extracts every numeral
  from the prose and rejects any that does not appear in the block. This is the
  acceptance criterion made executable: a persona that says "add 5 kg" when the
  block says 2.5 is rejected in code, not discouraged in a prompt.
- `tone.ts` — deterministic flags from the metrics engine: an injury note
  present, or adherence below a threshold. When either is set, a mandatory
  gentler-register instruction is appended **regardless of persona**, and
  `intensity` is clamped. `users.humor_max_level` clamps `humor_level` the same
  way.
- `deliver.ts` — the stage, taking `LlmCaller` as an injected dependency exactly
  as `src/planner/loop.ts` does.

### 3. `src/normalizer/` — free text into validated sets

- `schema.ts` — `{ exercise_slug, sets: [{ weight_kg, reps, rpe, is_warmup }] }`.
  Slug, not free text, and resolved against the candidate list — the same
  invariant #5 boundary the planner uses.
- `parse.ts` — the stage. Input is **untrusted user text**, so it is fenced with
  `fenceUntrusted` (ADR 0005 §2). Schema retry is already the gateway's job.

**One definition of "a set is logged."** `app/workouts/actions.ts:logSet` owns
the set-index read and the insert today. That insert moves into
`src/db/training.ts` as `insertSet()`, and both the form action and the
normalizer action call it. A second write path would be a second definition of
the invariant, and they would drift.

### 4. Surfaces

- **`app/coach/page.tsx`** — the newest accepted `plan_runs` row, rendered as
  the block's numbers plus the persona's prose beside them. A persona picker.
  A "read it aloud" control using `speechSynthesis`.
- **Session screen** — a free-text box: _"three by five at sixty, last one was a
  grind"_. Shows what it parsed for confirmation before writing. Never writes
  silently: a misheard set is worse than no set.
- **`src/ui/speak.ts`** — one wrapper over `speechSynthesis`, and the single
  call site `announceRestOver()` switches to it.

### 5. Seed an accepted plan

`npm run seed` gains one accepted `plan_runs` row. Without it the coach page has
nothing to render until a key exists, and the surface cannot be demonstrated or
tested end to end.

---

## Files

New: `src/persona/{schema,guard,tone,deliver,index}.ts`,
`src/normalizer/{schema,parse}.ts`, `src/db/personas.ts`, `src/ui/speak.ts`,
`app/coach/page.tsx`, `app/coach/actions.ts`, a personas seed migration,
`docs/plans/phase-3.md`, `docs/adr/0006-persona-boundary.md`.

Modified: `src/db/training.ts` (gains `insertSet`), `app/workouts/actions.ts`
(calls it), `app/workouts/[id]/SessionConsole.tsx` (free-text box),
`app/workouts/[id]/RestTimer.tsx` (speaks instead of beeping), `scripts/seed.ts`.

Reused rather than rebuilt: `callLLM` + the safety layers (`src/llm/`),
`fenceUntrusted` / `scanOutput` (`src/llm/safety.ts`), `PlanRunStore`
(`src/planner/types.ts`), `availableExercises` (`src/db/exercises.ts`),
`adherence` (`src/metrics/`), and the `LlmCaller` injection pattern from
`src/planner/loop.ts`.

## Verification

| Criterion                                          | Proof                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persona cannot alter a number                      | `npm test` — `guard.test.ts` rejects prose containing a number absent from the block; `deliver.test.ts` asserts it across all three personas with a scripted model |
| Tone override fires regardless of persona          | Assert the override instruction is present in the request for every persona when the injury or adherence flag is set                                               |
| Persona prompt is never concatenated into `system` | Extends the ADR 0005 §1 invariant test to cover the persona row                                                                                                    |
| Normalizer writes through one path                 | A test asserting the form action and the normalizer action reach the same `insertSet`                                                                              |
| Drift eval                                         | **Not met.** Recorded as unmet, as phase 2 did with cache and cost.                                                                                                |

Plus the existing gates: `npm run typecheck && npm run lint && npm test`,
`npm run test:db`, `npm run build`, and both `eval:planner` modes.

End to end in the browser at 375×812, per `docs/specs/mobile-interface.md`:
sign in as a seeded user, open `/coach`, switch persona, hear it read aloud,
then log a set by typing a sentence.

## Notes

- The plan and both ADRs are committed **before** the code they govern, in their
  own commit — `CLAUDE.md` → the artifact trail.
- A persona that trips `scanOutput`'s demeaning check is a finding worth
  recording, not a reason to weaken the check. The Rival is the likely candidate
  and that is a useful adversarial case.
- Docker is not needed; the hosted project takes the migration.

---

## Outcome

_Pending. Filled in when the phase meets its acceptance criteria._
