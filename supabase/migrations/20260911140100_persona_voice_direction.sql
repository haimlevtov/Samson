-- Samson 0060 — each coach speaks in a voice cast for it
--
-- ADR 0025, and its correction before the code. Plan:
-- docs/plans/rework-2.md, PR 6b. Skill:
-- .claude/skills/add-persona/SKILL.md §2.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. How a
--            coach sounds is a choice about the character, so it is two
--            columns on the row: which of the speech model's voices, and a
--            direction for it written as you would brief an actor.
--
-- WHY nullable: `personas_write` lets a user own a persona row and nothing in
-- the app authors one — the same reasoning as `sample_line` (migration
-- 20260911130000). And a user's own row is never spoken at all: the voice is
-- read from shared rows only, ADR 0025 §4, because a row the user can write is
-- text the user chose. Every SHIPPED coach has both, pinned by the count check
-- below and by tests/db/personas.test.ts.
--
-- WHY 600 characters of direction: a paragraph about the speaker. The model
-- reads it on every call, and past a paragraph it stops being a character
-- brief and starts competing with the line it is meant to perform.
--
-- WHY `tts_voice_id` and `tts_voice_variant` are NOT dropped here: nothing
-- reads them after this change, but the app running when this is pushed still
-- selects them, and pushing a drop before the deploy breaks it until the
-- deploy lands. The first migration after the deploy drops them — ADR 0025 §6.
--
-- AI-NOTE: `tts_voice` must be one of the model's voices — SPEECH_VOICES in
--          src/speech/script.ts. No CHECK enforces it here, because that list
--          belongs to a model and changes when the model does;
--          tests/db/personas.test.ts is the enforcement. Changing the model
--          means recasting every row below in one migration.

alter table public.personas
  add column tts_voice text
    constraint personas_tts_voice_length
      check (tts_voice is null or char_length(tts_voice) between 1 and 64),
  add column tts_instructions text
    constraint personas_tts_instructions_length
      check (tts_instructions is null or char_length(tts_instructions) between 1 and 600);

comment on column public.personas.tts_voice is
  'Which of the speech model''s voices this coach speaks in, e.g. Algenib. One of SPEECH_VOICES in src/speech/script.ts — ADR 0025.';

comment on column public.personas.tts_instructions is
  'How this coach speaks, written for a person: pace, weight, what they never do. Read by the speech model as director''s notes and never spoken — ADR 0025.';

-- Cast against Google's one-word descriptions of the model's voices, from each
-- persona's own system_prompt: Algenib is "gravelly", Alnilam "firm", Puck
-- "upbeat", Erinome "clear", Sulafat "warm". A first draft of a performance,
-- tuned by ear once the key is set; a retune is a migration like this one.

update public.personas
set tts_voice = 'Algenib',
    tts_instructions = 'An old samurai sword master who has trained thousands and is impressed by none of them, and quietly believes in this student. Deep, grave and unhurried. Short deliberate phrases, with long pauses between them. A dry trace of amusement. Never raises his voice, never hurries.'
where user_id is null and slug = 'old-master';

update public.personas
set tts_voice = 'Alnilam',
    tts_instructions = 'A drill sergeant on the parade ground, barking at a recruit who is late for the bar. Loud, clipped and commanding, in short bursts with hard stops, every line an order. Gruff rather than shrill. Never laughs, never softens, never trails off.'
where user_id is null and slug = 'sergeant';

update public.personas
set tts_voice = 'Puck',
    tts_instructions = 'A cocky training partner who is one rep ahead and enjoying it. Quick, dry and teasing, with a smirk you can hear. Conversational, never shouting. Throws the challenge down casually, as if the result were already settled.'
where user_id is null and slug = 'rival';

update public.personas
set tts_voice = 'Erinome',
    tts_instructions = 'A sports scientist walking a client through their own numbers. Calm, precise and even, at a measured pace, every word clearly articulated. No hype and no rising excitement. Sounds like someone explaining, never like someone selling.'
where user_id is null and slug = 'analyst';

update public.personas
set tts_voice = 'Sulafat',
    tts_instructions = 'An experienced physiotherapist talking to a patient on the table. Warm, gentle and unhurried, low and reassuring. Leaves a pause after a question so it can land. Never dramatic about pain, never rushed.'
where user_id is null and slug = 'physio';

-- An update that matches no row writes nothing and raises nothing. Counted, so
-- a renamed slug fails here rather than shipping a silent coach.
do $$
declare
  cast_count int;
begin
  select count(*) into cast_count
  from public.personas
  where user_id is null
    and slug in ('old-master', 'sergeant', 'rival', 'analyst', 'physio')
    and tts_voice is not null
    and tts_instructions is not null;

  if cast_count <> 5 then
    raise exception 'expected 5 shipped coaches with a voice and a direction, found %', cast_count;
  end if;
end $$;
