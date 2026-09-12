-- Samson 0074 — how to earn a badge, as its own text
--
-- ADR 0017's 2026-09-12 amendment, and rework PR 7.
--
-- The badge catalogue shows a person badges they do NOT hold, and what to do to
-- earn each one. The plan said `description` would serve. Read against the
-- shipped rows, none does: a description is written for the moment of earning,
-- in the past tense — "You trained on the first of January" — and two are not
-- even the condition. `hundred-tonnes` omits its thirty logged days;
-- `new-years-day` says "trained" and a planned rest day earns it too.
--
-- Rewriting the descriptions would take the reward copy from everyone who holds
-- a badge, so this is a second text for the second moment.
--
-- INVARIANT: content lives in the database — CLAUDE.md #7. The catalogue renders
--            this column and never composes an unlock condition of its own.
--
-- AI-NOTE: every sentence below was written against the predicate as it stands
--          on 2026-09-12, not against the badge's name. A migration that changes
--          a predicate must change its `how_to_earn` in the same file, or the
--          catalogue tells people to do something that no longer earns it.
--          .claude/skills/add-achievement/SKILL.md carries the same rule.

alter table public.achievements add column how_to_earn text;

comment on column public.achievements.how_to_earn is
  'ADR 0017 (2026-09-12 amendment). What to do to earn the badge, for someone who does not hold it — true to the predicate. `description` is the reward copy for someone who does. Required on shared rows. As secret as the rest of a hidden definition.';

update public.achievements as a
   set how_to_earn = v.how_to_earn
  from (values
    ('one-year-on',
     'Train, or take a planned rest day, on the date of the first day you ever logged — in any later year.'),
    ('new-years-day',
     'Train, or take a planned rest day, on the first of January.'),
    ('three-weeks-away',
     'Finish a session after three weeks or more without one.'),
    ('first-full-week',
     'Keep seven days in a row — a finished session or a planned rest day on every one of them.'),
    ('twenty-of-twenty-eight',
     'Keep twenty days out of twenty-eight. Finished sessions and planned rest days both count.'),
    ('twenty-percent-up',
     'On any one lift, work up to a set twenty percent heavier than your first working set of it, with at least six working sets of that lift logged.'),
    ('ten-rest-days',
     'Take ten rest days as planned.'),
    ('five-patterns',
     'Log working sets across five different movement patterns — squat, hinge, push, pull, core, carry or isolation work.'),
    ('hundred-tonnes',
     'Move a hundred thousand kilograms in working sets — weight times reps, warm-ups excluded — spread over at least thirty separate days.'),
    ('before-the-birds',
     'Finish a session you started before five in the morning, your time.'),
    ('groundhog-set',
     'Log twenty working sets of one lift at the same weight for the same reps, across as many sessions as it takes.')
  ) as v(slug, how_to_earn)
 where a.slug = v.slug
   and a.user_id is null;

/*
 * Fails loudly rather than shipping a blank card. Every shared row must have been
 * matched above — a slug renamed since, or a row this file does not know about,
 * stops the migration here. The constraint below would catch it too, but with a
 * message naming a constraint rather than the rows.
 */
do $$
declare
  missing text;
begin
  select string_agg(slug, ', ' order by slug)
    into missing
    from public.achievements
   where user_id is null
     and how_to_earn is null;

  if missing is not null then
    raise exception 'shared achievements with no how_to_earn: %', missing;
  end if;
end $$;

/*
 * Required on SHARED rows, so the next achievement migration that forgets it
 * fails when it is applied. A user-owned row may omit it: its predicate is never
 * executed (ADR 0009 §3), it can never be earned, and the catalogue does not list
 * it.
 */
alter table public.achievements
  add constraint achievements_shared_rows_say_how_to_earn
  check (user_id is not null or length(btrim(coalesce(how_to_earn, ''))) > 0);
