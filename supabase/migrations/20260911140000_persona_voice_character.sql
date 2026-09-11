-- Samson 0059 — a coach's voice is chosen by kind, and shaped by its row
--
-- Plan: docs/plans/rework-hub-history-coach.md, PR 6b, committed first.
-- Decision: docs/adr/0006-persona-boundary.md, amended 2026-09-11.
-- Skill: .claude/skills/add-persona/SKILL.md §2.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. How a
--            coach should sound is part of who the coach is, so it is columns
--            on the row, never a per-slug branch beside the code that speaks.
--
-- FOUND by the user, after PR 6's preview made it audible: "coach doesn't have
-- fitting voice to persona". Measured on a Windows browser offering only David,
-- Mark and Zira: the Sergeant took Zira — a light female voice — at the highest
-- pitch and rate of the five, and the Old Master spoke faster than normal. The
-- voice was the Nth of a language sorted by name, and pitch and rate rose with
-- intensity. Position is not character.
--
-- WHY these three columns:
--   * `tts_voice_gender` — the kind of device voice to take first. Device voices
--     carry nothing else a browser can read: no age, no timbre. Null means no
--     preference.
--   * `tts_pitch`, `tts_rate` — the coach's own voice shape, 0.5 to 1.5, where
--     the Web Speech API still sounds like speech. Intensity keeps driving the
--     words, and no longer the voice.
--
-- THE LIMIT, stated here as in the ADR: the browser speaks only with voices
-- installed on the device. This chooses the right kind and shapes it; it cannot
-- make David a samurai master. That needs audio, which the project has no
-- provider for.
--
-- The en-GB variants are renumbered so the two most different coaches separate
-- first on a device with few voices: Old Master 0, Sergeant 1, Rival 2. The
-- variant now picks WITHIN the coach's kind of voice.
--
-- AI-NOTE: a new persona row must set all three, with a pitch/rate pair no other
--          coach has — add-persona §2 — because on a device with one voice of
--          that kind, the pair is all that tells two coaches apart.
--          tests/db/personas.test.ts holds both.

alter table public.personas
  add column tts_voice_gender text
    constraint personas_tts_voice_gender_valid
      check (tts_voice_gender is null or tts_voice_gender in ('male', 'female')),
  add column tts_pitch numeric(3, 2) not null default 1.00
    constraint personas_tts_pitch_range check (tts_pitch between 0.5 and 1.5),
  add column tts_rate numeric(3, 2) not null default 1.00
    constraint personas_tts_rate_range check (tts_rate between 0.5 and 1.5);

comment on column public.personas.tts_voice_gender is
  'The kind of device voice this coach takes first — male, female, or null for no preference. Migration 20260911140000.';
comment on column public.personas.tts_pitch is
  'Speech pitch for this coach, 0.5–1.5. From the row, not from intensity — migration 20260911140000.';
comment on column public.personas.tts_rate is
  'Speech rate for this coach, 0.5–1.5. A gentle week slows it by a fixed factor in src/ui/speak.ts.';

-- The samurai master: deep, slow, spare.
update public.personas
set tts_voice_gender = 'male', tts_pitch = 0.70, tts_rate = 0.80, tts_voice_variant = 0
where user_id is null and slug = 'old-master';

-- The parade ground: low, clipped, fast.
update public.personas
set tts_voice_gender = 'male', tts_pitch = 0.80, tts_rate = 1.20, tts_voice_variant = 1
where user_id is null and slug = 'sergeant';

-- Dry and quick, never shouting.
update public.personas
set tts_voice_gender = 'male', tts_pitch = 1.00, tts_rate = 1.10, tts_voice_variant = 2
where user_id is null and slug = 'rival';

-- Calm and precise, unhurried.
update public.personas
set tts_voice_gender = 'female', tts_pitch = 1.00, tts_rate = 0.95, tts_voice_variant = 0
where user_id is null and slug = 'analyst';

-- Quietly warm, the slowest but one.
update public.personas
set tts_voice_gender = 'female', tts_pitch = 1.05, tts_rate = 0.88, tts_voice_variant = 1
where user_id is null and slug = 'physio';

-- A missed slug would update nothing and say nothing, so count.
do $$
declare
  n int;
begin
  select count(*) into n
  from public.personas
  where user_id is null and tts_voice_gender is not null;

  if n <> 5 then
    raise exception 'expected all five shipped personas to have a voice character, found %', n;
  end if;
end $$;
