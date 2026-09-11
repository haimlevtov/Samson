-- Samson 0058 — a coach can be heard before it is chosen
--
-- Plan: docs/plans/rework-hub-history-coach.md, PR 6, committed first.
-- Skill: .claude/skills/add-persona/SKILL.md.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. A
--            coach's sample line is content, so it is a column rather than a
--            Record<string, string> beside the component that speaks it.
--
-- WHY a stored line rather than one generated through the persona stage: a
-- generated line would be in character and would need an API key, which makes a
-- preview button that cannot preview. A stored line works offline, and a demo
-- runs offline.
--
-- WHY nullable: `personas_write` still lets a user own a persona row, and
-- nothing in the app authors one. A required column that no form asks for would
-- turn such an insert into an error about a field nobody offered. Every SHIPPED
-- coach has a line, and tests/db/personas.test.ts pins that instead of the
-- schema.
--
-- The lines obey what every word a persona says obeys, checked for each shipped
-- row by tests/db/personas.test.ts: no numeral (a coach states no figure it was
-- not given — invariant #1), none of the row's own banned phrases, and a clean
-- pass through `scanOutput` (src/llm/safety.ts). 280 characters is a few seconds
-- spoken, and a preview is a taste rather than a speech.
--
-- AI-NOTE: adding a column means regenerating src/db/types.ts from a LOCAL stack
--          with the pinned CLI — CLAUDE.md. It was, in the same commit.

alter table public.personas
  add column sample_line text
    constraint personas_sample_line_length
      check (sample_line is null or char_length(sample_line) between 1 and 280);

comment on column public.personas.sample_line is
  'What the Coach tab previews before a plan exists, in the coach''s own voice. No numerals, none of the row''s banned phrases — migration 20260911130000.';

update public.personas
set sample_line = 'I''ve trained already today. Your move. Match last week and we''re level. Beat it and I''ll have to start taking you seriously.'
where user_id is null and slug = 'rival';

update public.personas
set sample_line = 'Here is how I work. I read what you logged, tell you what it supports and what it doesn''t, and explain the reason for every change before I ask you to make it.'
where user_id is null and slug = 'analyst';

update public.personas
set sample_line = 'Everybody wants a better programme. Almost nobody wants to turn up on a wet Tuesday. Turn up on the Tuesday.'
where user_id is null and slug = 'old-master';

update public.personas
set sample_line = 'On your feet! That rest timer ran out a lifetime ago. Hands on the bar, brace, and move it like you mean it. Tempo is not a suggestion!'
where user_id is null and slug = 'sergeant';

update public.personas
set sample_line = 'Before we add anything, tell me how the last session felt. If something hurt, that matters more than the plan, and we will change the plan.'
where user_id is null and slug = 'physio';

-- A missed slug would update nothing and say nothing, so count.
do $$
declare
  n int;
begin
  select count(*) into n
  from public.personas
  where user_id is null and sample_line is not null;

  if n <> 5 then
    raise exception 'expected every one of the five shipped personas to have a sample line, found %', n;
  end if;
end $$;
