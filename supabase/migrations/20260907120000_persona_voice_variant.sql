-- Samson 0029 — which voice a persona takes is content, not an array index
--
-- FOUND IN REVIEW, 2026-09-07. The persona→voice allocation was the coach's
-- position in the list returned by `listPersonas`, which is `order by name`.
-- That is a code branch wearing a column's clothes, and CLAUDE.md #7 says
-- persona content is rows — as does docs/PRD.md §5.4 ("not a code branch") and
-- 20260901154757_shipped_personas.sql itself ("adding a fourth persona is a
-- migration, never an application change").
--
-- It was also a live bug, not only a rule violation. Ordering by name means
-- inserting ANY persona whose name sorts early shifts every persona after it:
-- a fourth shared coach, or a user's own row — `personas_read` is
-- `user_id is null or user_id = auth.uid()` and `listPersonas` has no filter —
-- silently reassigns the voices of coaches the migration never touched.
--
-- WHY a variant number rather than a device voice name: there is no TTS
-- provider (ADR 0006). The device decides which voices exist, and they differ
-- per browser and per OS, so a stored voice name would be wrong on most
-- machines. The variant says "take the Nth voice matching your language",
-- which is stable content the app can honour with whatever it finds.

alter table public.personas
  add column if not exists tts_voice_variant int not null default 0
    check (tts_voice_variant >= 0);

comment on column public.personas.tts_voice_variant is
  'Which of the device voices matching tts_voice_id this persona takes, when the language leaves several. Distinct per language group — see migration 20260907120000.';

-- INVARIANT: personas sharing a tts_voice_id must not share a variant, or they
--            collapse onto the same device voice — which is the bug this
--            column exists to fix. rival and old-master are both en-GB, so they
--            take 0 and 1; analyst is the only en-US and takes 0.
--
-- AI-NOTE: the `add-persona` skill must set this. A new en-GB coach needs 2,
--          not the default 0, or it speaks in the Old Master's voice.
update public.personas set tts_voice_variant = 0 where user_id is null and slug = 'old-master';
update public.personas set tts_voice_variant = 1 where user_id is null and slug = 'rival';
update public.personas set tts_voice_variant = 0 where user_id is null and slug = 'analyst';
