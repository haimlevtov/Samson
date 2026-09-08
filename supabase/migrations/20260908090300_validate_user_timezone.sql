-- Samson 0038 — users.timezone must be a timezone Postgres recognises
--
-- FOUND IN REVIEW, 2026-09-08, on the branch that added `before-the-birds` —
-- the first achievement predicate to evaluate `w.started_at at time zone
-- u.timezone`.
--
-- THE BYPASS, which is the same one 20260907190000 §1 documented for
-- display_name: `users.timezone` is bare `text not null default 'UTC'` and the
-- phase-0 column comment says why — "Validated as an IANA name in Zod at the
-- app boundary; Postgres cannot check it here because the lookup is not
-- immutable." But `authenticated` holds UPDATE on public.users and
-- `users_update_own` permits it, so one PATCH /rest/v1/users with
-- {"timezone":"nope"} skips the Zod boundary entirely. A validation that only
-- the application performs is a validation the database does not have.
--
-- It is not injection — AT TIME ZONE consumes a value, not SQL — and it is not
-- cross-user. The damage is self-inflicted silence, and there are now two
-- consumers with different failure modes:
--
--   * `evaluate_achievements` wraps every predicate in `exception when others`,
--     so a bad timezone makes `before-the-birds` stop firing for that user with,
--     in that function's own words, no error reaching anyone.
--   * `accept_challenge` (20260907140000) does NOT catch it, so the same value
--     makes accepting a challenge throw.
--
-- One user, two symptoms, no message connecting either to the cause.
--
-- WHY a trigger rather than a CHECK: the phase-0 comment is right that the
-- lookup is not immutable — the tz database is loaded at runtime and can change
-- with a Postgres upgrade — so it cannot go in a CHECK constraint. A trigger
-- has no such requirement, and it is evaluated at exactly the moment the value
-- arrives, which is the only moment that matters.
--
-- WHY pg_timezone_names rather than a try/catch around AT TIME ZONE: that
-- expression also accepts abbreviations (EST) and POSIX offsets (UTC+5), and
-- the app's contract, stated in the column comment and enforced in Zod, is an
-- IANA name. Accepting more here would mean the database and the application
-- disagreed about what a valid value is, which is how this class of bug starts.
--
-- AI-NOTE: existing rows are not rewritten. The trigger fires on insert and
--          update only, so a row already holding a bad value keeps it until it
--          is next written. There are none today; this is the cheap, reversible
--          half, and a backfill would be a separate migration with a decision
--          behind it about what to replace a bad value WITH.

create or replace function public.validate_user_timezone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'timezone % is not an IANA timezone name', new.timezone
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists users_validate_timezone on public.users;
create trigger users_validate_timezone
  before insert or update of timezone on public.users
  for each row execute function public.validate_user_timezone();

comment on column public.users.timezone is
  'IANA timezone name, validated against pg_timezone_names by a trigger — see migration 20260908090300. Calendar achievements and accept_challenge both read it.';
