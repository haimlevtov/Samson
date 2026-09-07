---
name: add-persona
description: Add or change a coach persona in Samson. Use when adding a fourth coach, editing a shipped one's character, changing its banned phrases, intensity or humour tier, or assigning its device voice. Covers the migration, the voice-variant rule that silently breaks, and the tests that must ship with it.
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
| `name` | what the chip says — "The Rival" |
| `system_prompt` | a description of a **character**, see below |
| `tts_voice_id` | a BCP-47 language tag, e.g. `en-GB`. Not a voice name |
| `tts_voice_variant` | which voice within that language. **See §2** |
| `intensity` | 1–5, drives how hard delivery pushes |
| `humor_level` | `clean`, `cheeky`, `crude` — a ceiling, clamped by the user's own setting |
| `banned_phrases` | text[], enforced in code, not by the prompt |

### `system_prompt` is data, and that changes how you write it

It is a database column, so ADR 0006 has `src/persona/prompts.ts` **fence** it
into the per-call message. It is never concatenated into the stage's system
prompt — a persona row cannot escalate its own privileges.

The consequence for the author: **write a description of a character, not
instructions to a model.** Anything phrased as an instruction is read as part of
the character's description and will not take effect the way you expect.

> Good: "Short, clipped sentences. Dry rather than loud — never shouting."
> Bad: "You must respond in under three sentences and never use exclamation marks."

## 2. The voice variant — the rule that breaks silently

`tts_voice_id` narrows to a **language**; `tts_voice_variant` picks the Nth
device voice within it.

**INVARIANT: two personas sharing a `tts_voice_id` must not share a variant.**

This was a real bug. Voices were selected by language alone, so the two `en-GB`
personas resolved to the same voice object — and on a device with no en-GB voice
installed, the `en-US` persona fell back to it too. All three coaches spoke
identically, under a control labelled "Voice".

Current allocation:

| Slug | `tts_voice_id` | `tts_voice_variant` |
| --- | --- | --- |
| `old-master` | en-GB | 0 |
| `rival` | en-GB | 1 |
| `analyst` | en-US | 0 |

**A fourth en-GB coach takes variant 2, not the default 0.** Nothing enforces
this — the column defaults to 0 and no constraint spans rows — so it is checked
by reading the table and by the test in §4.

There is no TTS provider (ADR 0006): delivery uses the browser's own
`speechSynthesis`. The device decides which voices exist and they differ per
browser and per OS, so a stored voice **name** would be wrong on most machines.
Persona voice is tone, rate and word choice rather than timbre.

## 3. Banned phrases are a ban, not a preference

`banned_phrases` is checked in `src/persona/deliver.ts` against the delivered
prose, and a hit triggers a retry. A list that only holds when the model
cooperates is a preference.

Put the phrases the character must never use **and** the ones the product must
never say — every shipped persona bans `no pain no gain` and
`push through the pain`, because the user's body is a stakeholder that cannot
complain (`docs/FRAMING.md`).

## 4. Tests, in the same commit

**Unit** — `src/persona/deliver.test.ts` builds personas from literals, so a new
one needs a case only if it exercises something new (a humour tier no shipped
persona has, an intensity at a boundary).

**Database** — assert the row landed and the allocation still holds. The
voice-variant rule is the one worth pinning, because nothing else catches it:

```ts
it('gives no two personas of one language the same voice variant', async () => {
  const { data } = await anon.from('personas').select('tts_voice_id, tts_voice_variant');
  const pairs = (data ?? []).map((p) => `${p.tts_voice_id}:${p.tts_voice_variant}`);
  expect(pairs).toHaveLength(new Set(pairs).size);
});
```

**Also update `SHIPPED_PERSONA_SLUGS`** in `src/persona/schema.ts`. It is not a
source of truth — the rows are — but it is what tests and fixtures enumerate.

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
- `docs/adr/0005-llm-safety.md` §1 — why a column is fenced, not concatenated
- `supabase/migrations/20260901154757_shipped_personas.sql` — the three to copy
- `supabase/migrations/20260907120000_persona_voice_variant.sql` — why the
  variant is a column rather than an array index
