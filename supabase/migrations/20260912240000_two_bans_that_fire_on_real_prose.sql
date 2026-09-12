-- Samson 0072 — banned phrases that fire on ordinary coaching prose
--
-- FOUND IN REVIEW of rework PR 5, and it is the `weak`/"weakness" outage in a
-- new form.
--
-- ---------------------------------------------------------------------------
-- What is wrong
-- ---------------------------------------------------------------------------
--
-- `phraseUsed` in src/persona/deliver.ts matches whole words and their plural,
-- after lowercasing and **replacing every run of non-alphanumerics with a
-- space** (ADR 0019). So a full stop is not a boundary: a banned phrase can be
-- assembled out of the end of one sentence and the start of the next.
--
-- The Austrian shipped with `man up` and `ill be back`. Both were measured
-- firing on sentences a coach would legitimately write:
--
--   "You moved that like a man. Up you get, my friend."   -> fires `man up`
--   "If you are ill, be back when you feel able."         -> fires `ill be back`
--
-- `deliverPlan` has NO FALLBACK by design (ADR 0006): a banned phrase rejects
-- the delivery, retries, rejects again, and the user gets an error instead of
-- the block the critic already approved. So a ban that can fire on real prose
-- does not merely annoy — it costs somebody the plan they waited a minute for.
--
-- The migration that added them argued this exact rule three lines above the
-- array and then broke it. It is left as it was applied, with a pointer here.
--
-- ---------------------------------------------------------------------------
-- And THE SERGEANT has carried `man up` since 2026-09-08
-- ---------------------------------------------------------------------------
--
-- This is the part that is not about the new coach. `20260908110000` gave the
-- Sergeant a fourteen-phrase list, `man up` among them, and it has been live
-- ever since. Nothing caught it because `tests/db/personas.test.ts`'s VOCABULARY
-- paragraph — the guard written for exactly this class after the
-- `weak`/"weakness" outage — contained no sentence that would fire it.
--
-- So the Sergeant has been able to reject its own delivery, on prose as ordinary
-- as "you moved that like a man. Up you get", for four days. It was found by
-- adding the sentence, which is the only reason it is visible: a regression test
-- whose fixture cannot reach the bug is a test that passes and protects nothing.
--
-- Both rows are fixed here. The Sergeant's other thirteen were checked against
-- the same trap and none of them can be assembled across a sentence break —
-- `walk it off`, `suck it up`, `grow a pair`, `like a girl`, `princess` and the
-- rest are sequences no delivery reaches by accident.
--
-- ---------------------------------------------------------------------------
-- What replaces them
-- ---------------------------------------------------------------------------
--
-- Nothing. The remaining list is the two universals plus three sequences no
-- delivery reaches by accident, and that is the right trade: `system_prompt` is
-- what keeps this coach an archetype rather than an impression,
-- `src/llm/safety.ts` scans every completion for demeaning language, and a ban
-- that can cost a user their block buys less than either.
--
-- AI-NOTE: `tests/db/personas.test.ts`'s VOCABULARY paragraph now contains both
--          sentences above, so this cannot come back silently. Add the sentence
--          that would fire a new phrase there when adding one —
--          .claude/skills/add-persona/SKILL.md §3 carries the rule.

update public.personas
set banned_phrases = array[
      'no pain no gain',
      'push through the pain',
      'hasta la vista',
      'dont be a baby',
      'stop being a girl'
    ]
where user_id is null and slug = 'austrian';

-- `array_remove` rather than a rewritten list: the Sergeant's other thirteen are
-- correct and re-typing them here would be a second copy of a list this file has
-- no business owning.
update public.personas
set banned_phrases = array_remove(banned_phrases, 'man up')
where user_id is null and slug = 'sergeant';

-- An update that matches no row writes nothing and raises nothing.
do $$
declare
  n int;
begin
  select count(*) into n
  from public.personas
  where user_id is null
    and slug in ('austrian', 'sergeant')
    and not ('man up' = any (banned_phrases))
    and not ('ill be back' = any (banned_phrases));

  if n <> 2 then
    raise exception 'expected both coaches to carry neither retired phrase, matched %', n;
  end if;

  -- The Sergeant keeps everything else it had.
  select array_length(banned_phrases, 1) into n
  from public.personas
  where user_id is null and slug = 'sergeant';

  if n <> 13 then
    raise exception 'expected the Sergeant to keep thirteen phrases, found %', n;
  end if;
end $$;
