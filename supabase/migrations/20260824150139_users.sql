-- Samson 0001 — users
--
-- INVARIANT: RLS is on for every table, and every table has user_id — CLAUDE.md #10
-- WHY: enabling RLS in the same migration as the CREATE TABLE means no table
--      ever exists unprotected, not even between two migrations on a branch.

create extension if not exists pgcrypto;

-- Shared updated_at trigger, used by every table that has the column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.users (
  -- WHY: the primary key is named user_id rather than id so that "every table
  --      has a user_id column" is literally true and the RLS coverage test in
  --      tests/db needs no per-table exemptions.
  user_id uuid primary key references auth.users (id) on delete cascade,

  display_name text,

  -- INVARIANT: timestamps are UTC plus the user's IANA timezone — CLAUDE.md #9
  -- WHY: calendar-triggered achievements evaluate against this, never the
  --      server date. Validated as an IANA name in Zod at the app boundary;
  --      Postgres cannot check it here because the lookup is not immutable.
  timezone text not null default 'UTC',

  -- INVARIANT: units are stored canonically — CLAUDE.md #8
  -- Display conversion only. This column says what to render, never what to store.
  unit_preference text not null default 'metric'
    check (unit_preference in ('metric', 'imperial')),

  -- Gates crude-tier achievement and persona copy. Default is cheeky.
  humor_max_level text not null default 'cheeky'
    check (humor_max_level in ('clean', 'cheeky', 'crude')),

  birth_date date,
  sex text check (sex in ('male', 'female', 'unspecified')),
  height_cm numeric(5, 1) check (height_cm > 0),

  -- AI-NOTE: a single current value. The phase 6 diet advisor needs a recent
  --          bodyweight; if it needs a trend, promote this to a time series
  --          table rather than widening this row.
  bodyweight_kg numeric(6, 2) check (bodyweight_kg > 0),

  -- INVARIANT: the gateway checks this before every call — CLAUDE.md #2
  -- WHY: a runaway retry loop on a free-tier budget is the failure mode that
  --      ends the project the week before the demo.
  llm_weekly_budget_usd numeric(10, 4) not null default 0.50
    check (llm_weekly_budget_usd >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

alter table public.users enable row level security;

create policy users_select_own on public.users
  for select to authenticated using (user_id = auth.uid());

create policy users_insert_own on public.users
  for insert to authenticated with check (user_id = auth.uid());

create policy users_update_own on public.users
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No delete policy: profiles disappear by cascade from auth.users.
