-- Samson 0064 — the device-voice columns go
--
-- ADR 0025 §6, second step. Rework plan PR 6d.
--
-- `personas.tts_voice_id` (a BCP-47 language tag, despite the name) and
-- `personas.tts_voice_variant` (which device voice within that language) existed
-- to pick a voice out of the browser's own `speechSynthesis`. ADR 0025 took the
-- coaches off device speech entirely — they speak through the gateway's speech
-- stage now, with `tts_voice` and `tts_instructions` — so these two describe
-- nothing.
--
-- ---------------------------------------------------------------------------
-- WHY this is a separate migration from the one that stopped reading them
-- ---------------------------------------------------------------------------
--
-- Expand and contract. PR 6b (#49) removed every reader and shipped; this drops
-- the columns. Doing both in one push would have broken the running app for as
-- long as the deploy took, because the old bundle was still selecting them.
--
-- So the order is: 6b's code deploys, and only then does this run. Verified
-- before writing it — nothing under `src/`, `app/`, `tests/` or `scripts/` names
-- either column, and `main` has carried 6b since 2026-09-11. (A merge is not a
-- deploy: this must not reach hosted until that `main` is actually serving, which
-- is what makes the contract half of an expand-and-contract safe.)
--
-- AI-NOTE: this regenerates `src/db/types.ts`, which CI checks byte for byte
--          against `supabase gen types typescript --local`. The regeneration
--          must be in this same commit, from a LOCAL stack — never `--linked`,
--          which emits a `PostgrestVersion` the local generator does not.

alter table public.personas
  drop column if exists tts_voice_id,
  drop column if exists tts_voice_variant;
