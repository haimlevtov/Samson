-- Samson 0065 — what the coach is allowed to remember
--
-- ADR 0030. The chat stage had no write path at all, and ADR 0015 §1 named that
-- as the thing that made "a jailbroken chat cannot persist anything" a guarantee
-- rather than a hope. Memory needs one, so the guarantee changes — and ADR 0015's
-- table says so in the same change rather than quietly losing the row.
--
-- What is NOT weakened: the model does not write here. It proposes a sentence in
-- a structured field, code decides whether it is stored, and the user can delete
-- any of it. `user_id` comes from the session, never from a field.

create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,

  -- WHY a length CHECK when the application already bounds it: the application
  -- bound is a decision about what a note IS (a sentence, not a paragraph) and
  -- lives beside the rest of that decision. This is the bound that survives a
  -- hand-written POST, which `coach_notes_own` permits by design — the same
  -- reasoning 20260912140000 applied to max_load_kg, and the same last moment to
  -- apply it, since nothing has written this column yet.
  --
  -- 120 is the application's own cap, not a multiple of it: a row longer than a
  -- note is not a note, and leaving headroom here would only mean the two
  -- numbers disagree about what happened.
  text text not null check (char_length(text) between 1 and 120),

  created_at timestamptz not null default now()
);

create index coach_notes_user_created_idx on public.coach_notes (user_id, created_at desc);

alter table public.coach_notes enable row level security;

-- The same shape user_equipment has: own rows, read and write, no exceptions and
-- no shared rows — CLAUDE.md #10. There is no null-user_id case here, because a
-- note is about one person by definition.
create policy coach_notes_own on public.coach_notes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The bound, as a property of the table
-- ---------------------------------------------------------------------------
--
-- At most 20 notes per user, newest kept. ADR 0030 gives three reasons and only
-- one of them is storage: every note is re-sent on every turn (a cost leak), and
-- a long enough block pushes the rules out of attention (ADR 0015 §5's argument
-- for the transcript window, one table along).
--
-- WHY a trigger rather than a delete in the action: the reader already takes the
-- newest 20, so the PROMPT is bounded whatever this does. What the trigger bounds
-- is the table and the list the user audits on Settings, and both of those should
-- hold for a row written by any means — including the hand-written POST the RLS
-- policy permits. A bound enforced only by the one caller is a bound until the
-- second caller.
--
-- `security invoker`: the deleted rows belong to the inserting user, so RLS
-- permits the delete without any elevation. `search_path = ''` per
-- 20260824150441, so everything below is schema-qualified.
create or replace function public.trim_coach_notes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.coach_notes
  where user_id = new.user_id
    and id not in (
      select id from public.coach_notes
      where user_id = new.user_id
      -- id breaks the tie: created_at defaults to now(), which is TRANSACTION
      -- time, so a bulk insert gives every row one identical value and
      -- `order by created_at` alone would evict arbitrarily. The same trap
      -- ADR 0021 records for achievements, in a smaller place.
      order by created_at desc, id desc
      limit 20
    );

  return null;
end;
$$;

-- AFTER INSERT, so the row being counted is already there — a BEFORE trigger
-- would keep 21. FOR EACH ROW rather than FOR EACH STATEMENT because the new
-- row's user_id is what scopes the delete.
drop trigger if exists coach_notes_trim on public.coach_notes;
create trigger coach_notes_trim
  after insert on public.coach_notes
  for each row execute function public.trim_coach_notes();
