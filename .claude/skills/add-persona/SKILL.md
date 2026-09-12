---
name: add-persona
description: Add or change a coach persona in Samson. Use when adding a sixth coach, editing a shipped one's character, changing its banned phrases, intensity, humour tier or preview line, or giving it a voice. Covers the migration, the voice direction a coach speaks with, and the tests that must ship with it.
---

# Adding a persona

Personas are **rows**, not code — CLAUDE.md #7. Adding one is a migration and a
test; no application logic changes.

`src/persona/schema.ts` holds `SHIPPED_PERSONA_SLUGS`, which names what the
migration inserted and nothing more. There is no persona branch anywhere.

## 1. Write the row

A new migration inserting into `personas` with `user_id = null`, the same
shared-content pattern the exercise catalogue uses — `personas_read` is
`user_id is null or user_id = auth.uid()`, so a null row is visible to everyone.

| Column | Notes |
| --- | --- |
| `slug` | stable, lowercase, never reused |
| `name` | what the persona menu on Coach lists — "The Rival" |
| `system_prompt` | a description of a **character**, see below |
| `tts_voice` | the speech model's voice name, e.g. `Algenib`; 64 characters at most. **See §2** |
| `tts_instructions` | how the character speaks, in words; 600 characters at most. **See §2** |
| `intensity` | 1–5, drives how hard delivery pushes |
| `humor_level` | `clean`, `cheeky`, `crude` — a ceiling, clamped by the user's own setting |
| `banned_phrases` | text[], enforced in code, not by the prompt |
| `sample_line` | what the Coach tab's Voice card speaks when a coach is previewed. See below |

### `sample_line` is the coach's first impression

A few short sentences, 280 characters at most, in the character's own voice —
it is spoken, so write it to be heard. The same rules bind it as bind every
word the persona says: **no numeral** (a coach states no figure it was not
given — CLAUDE.md #1), **none of the row's own banned phrases**, and a clean
pass through `scanOutput` in `src/llm/safety.ts`. `tests/db/personas.test.ts`
checks all three for every shipped persona, so a new row without a line, or
with one that breaks a rule, fails there.

### `system_prompt` is data, and that changes how you write it

It is a database column, so ADR 0006 has `src/persona/prompts.ts` **fence** it
into the per-call message. It is never concatenated into the stage's system
prompt — a persona row cannot escalate its own privileges.

The consequence for the author: **write a description of a character, not
instructions to a model.** Anything phrased as an instruction is read as part of
the character's description and will not take effect the way you expect.

> Good: "Short, clipped sentences. Dry rather than loud — never shouting."
> Bad: "You must respond in under three sentences and never use exclamation marks."

## 2. The voice — a direction, not a device

A coach speaks in a synthesised voice (ADR 0025): `tts_voice` names one of the
speech model's voices, and `tts_instructions` says, in words, how the character
speaks. Both go to `google/gemini-3.1-flash-tts-preview`, through the gateway's
`speech` stage.

**`tts_voice` must be one the model has.** `SPEECH_VOICES` in
`src/speech/script.ts` lists them — Google gives each a word, `Algenib`
"gravelly", `Sulafat` "warm" — and `tests/db/personas.test.ts` fails on a
shipped coach whose voice is not in it, or that shares a voice with another.
There is no fallback model, because a voice name belongs to one model.

**Write the direction for a person, not for a model**, the same rule as
`system_prompt`: who is speaking, and how — pace, weight, what they never do.

> Good: "An old samurai sword master: deep, grave, unhurried; short deliberate
> phrases with long pauses; never raises his voice."
> Bad: "Use voice Algenib at 0.7 speed and sound old."

The direction is read, not spoken: the model is told to perform only the text
under `TRANSCRIPT`. Keep the notes about the speaker, not about the line.

Current voices:

| Slug         | `tts_voice` | Direction, in short                                  |
| ------------ | ----------- | ---------------------------------------------------- |
| `old-master` | `Algenib`   | an old samurai sword master: deep, grave, unhurried  |
| `sergeant`   | `Alnilam`   | a drill sergeant on the parade ground: loud, clipped |
| `rival`      | `Puck`      | a cocky training partner: dry, quick, a smirk in it  |
| `analyst`    | `Erinome`   | a sports scientist: calm, precise, no hype           |
| `physio`     | `Sulafat`   | an experienced physio: warm, gentle, unhurried       |

**A voice that does not fit the coach is worse than none** — the user's rule, and
why there is no device-voice fallback: without the key or the budget, the coach's
words are shown and nothing speaks. The old device-voice columns
(`tts_voice_id`, `tts_voice_variant`) were dropped on 2026-09-12 by migration
`20260912160000` — they no longer exist, so an insert naming either one fails.
The variant rule that went with them is gone.

## 3. Banned phrases are a ban, not a preference

`banned_phrases` is checked in `src/persona/deliver.ts` against the delivered
prose, and a hit triggers a retry. A list that only holds when the model
cooperates is a preference.

Put the phrases the character must never use **and** the ones the product must
never say — every shipped persona bans `no pain no gain` and
`push through the pain`, because the user's body is a stakeholder that cannot
complain (`docs/FRAMING.md`). A `tests/db/personas.test.ts` case asserts those
two are on every row.

### What this list is for, given the scanner already exists

`src/llm/safety.ts` scans **every** completion for demeaning language, and it
matches **second-person targeting** — "you're pathetic" — rather than bare
words, deliberately, so that "your pathetic squat" and "body fat" stay sayable.
Its own AI-NOTE explains why: a guard that fires on ordinary coaching
vocabulary gets switched off, and then it protects nobody.

So `banned_phrases` is for what that construction misses: the idiom **this
character** would reach for, and advice that is dangerous rather than rude. The
Sergeant's list is the longest in the table for exactly that reason.

### The matcher matches whole words — and it did not always

A phrase matches on whole words **plus its plural**, after both sides are
lowercased, stripped of invisible characters and cleared of punctuation —
`phraseUsed` in `src/persona/deliver.ts`, argued in
[ADR 0019](../../../docs/adr/0019-banned-phrase-matching.md).

So `quitter` catches "quitters", and `no pain no gain` catches "no pain, no
gain". But `weak` catches neither "weakness" nor **"weakling"**. The plural is
free; every other inflection is not.

**State the cost with the example that bites.** An earlier version of this
section said "`quit` does not catch quitter" — true, and worthless, because
`quit` is on no persona's list. The one that mattered was `weakling`: the Rival
banned `weak`, substring matching had been catching "weakling" by accident, and
`src/llm/safety.ts` does not catch "you are a weakling" either. Both rows now
list it explicitly.

It used `String.includes` until 2026-09-08, which meant a short word banned
every word containing it. The Rival had banned `weak` since phase 3, so
"your weakness is the lockout" — ordinary coaching language — failed the guard.
`deliverPlan` has no fallback by design (ADR 0006), so that delivery was
rejected, retried, rejected again, and the user got an error rather than the
block the critic had already approved. It was found by a test written for a
different persona.

**Prefer the shortest unambiguous fragment.** The Physio shipped with
`it is probably nothing` and `you will be fine`, and neither could ever fire,
because a model writes "it's probably nothing" and "you'll be fine". A whole
sentence matches that sentence; a model has a hundred ways to write one.

Still check a new entry against real vocabulary before adding it. The word
boundaries make short words safe; they do not make a badly chosen one correct.

## 4. Tests, in the same commit

**Unit** — `src/persona/deliver.test.ts` builds personas from literals, so a new
one needs a case only if it exercises something new (a humour tier no shipped
persona has, an intensity at a boundary).

**Database** — assert the row landed. `tests/db/personas.test.ts` already holds
every shipped coach to having a voice and a direction, so a new row without one
fails there.

**The sample line** needs no new case: `tests/db/personas.test.ts` already
checks every shipped persona's line — present, unlike the others, no numeral,
none of its own banned phrases, clean through `scanOutput` — so a new row is
held to it the moment it lands.

**Also update `SHIPPED_PERSONA_SLUGS`** in `src/persona/schema.ts`. It is not a
source of truth — the rows are — but `tests/db/personas.test.ts` asserts the two
agree, so a migration that adds a row without touching it fails there.

_That sentence used to end "it is what tests and fixtures enumerate", and
nothing enumerated it: the constant appeared only in its own declaration and one
doc comment. A constant nobody reads cannot drift loudly. The test was written
in the same change that added the fourth and fifth personas._

## 5. Verify

```bash
npm run verify && npm run test:db
```

A persona is a migration plus a database test, so `npm test` alone proves
nothing about the row — the unit run has no database and cannot see it. The db
suite is where the roster, the voice casting and the banned-phrase lists are
actually checked.

## What this skill does not cover

**The persona drift eval does not exist.** `CLAUDE.md` describes this skill as
covering "config and eval entry", and `docs/PLAN.md` phase 3 carries "does turn
80 still sound like turn 3" as its one **unmet** acceptance criterion. There is
no harness to add an entry to.

When it is built, adding a persona should mean adding a case to it, and this
section should be replaced with how. Until then, do not claim a new persona has
been evaluated for drift — it has not.

## Related

- `docs/adr/0006-persona-boundary.md` — the persona changes delivery, never content
- `docs/adr/0025-coach-voices.md` — how a coach is voiced, and why not on the
  device
- `docs/adr/0005-llm-safety.md` §1 — why a column is fenced, not concatenated
- `supabase/migrations/20260908110000_remaining_personas.sql` — the most recent
  pair, and the closest model to copy. Its insert predates `sample_line`,
  `tts_voice` and `tts_instructions`; add all three, and leave out its
  `tts_voice_id` and `tts_voice_variant`, which no longer exist
- `supabase/migrations/20260911140100_persona_voice_direction.sql` — the five
  voices and directions, and the model for casting a new coach
- `supabase/migrations/20260911130000_persona_sample_line.sql` — the preview
  line, and the rules it is held to
- `supabase/migrations/20260901154757_shipped_personas.sql` — the original three
- `supabase/migrations/20260907120000_persona_voice_variant.sql` — history: the
  device-voice variant ADR 0025 removed
