-- Samson 0019 — the weekly ceiling holds against UPDATE, and against a race
--
-- Design and reasoning: docs/adr/0009-gamification-trust.md
-- Contract: docs/specs/xp-and-challenges.md
--
-- FOUND IN REVIEW, 2026-09-02. 0013 wrote the ceiling as a database guarantee
-- and left two ways around it, both of which make the phase 4 criterion "no
-- sequence of sessions can breach the weekly ceiling" false as written:
--
--   1. The trigger fired `before insert` only. 20260824150321_grants.sql grants
--      UPDATE on every public table to `authenticated` and `service_role`, so
--      `update xp_events set amount = ...` walked straight past the floor. The
--      threat model in ADR 0009 is "a bug, a migration, a future RPC, or a
--      careless admin script" — none of which is limited to inserting.
--   2. The check read `sum(amount)` with no lock. Under READ COMMITTED two
--      concurrent writers each saw the same room under the ceiling and each
--      took it, so a *sequence* stayed inside the cap while a *pair* did not.
--
-- WHY this is a new migration rather than an edit to 0013: 0013 is applied to
-- the hosted project, and the artifact trail is meant to show what was believed
-- when, then what was found. Editing it in place would erase the finding.

-- AI-NOTE: 500 is WEEKLY_XP_CEILING in src/gamification/xp.ts. The two are
--          pinned together by tests/db/gamification.test.ts, which brackets the
--          database's number from both sides rather than restating it.
create or replace function public.enforce_weekly_xp_ceiling()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  ceiling constant int := 500;
  spent int;
begin
  -- WHY a lock and not just a read: two transactions inserting at the same
  -- moment would each read the same `spent`, each find room for their award,
  -- and each take it. The key is the exact bucket the ceiling is enforced
  -- against — (user, week) — so this serialises only writers actually
  -- competing for the same allowance, and it is released at commit.
  --
  -- award_session_xp takes the same lock before it reads, so the intended path
  -- is serialised across its whole read-compute-insert rather than only across
  -- this check. Advisory locks are re-entrant within a transaction, so taking
  -- it in both places costs nothing.
  perform pg_advisory_xact_lock(
    hashtextextended(new.user_id::text || ':' || new.week_start::text, 0)
  );

  -- `is distinct from new.id` is what makes this correct on UPDATE: the row
  -- being changed must not be counted against its own new amount, or raising
  -- an award from 10 to 20 would be measured as 10 + 20. On INSERT the id is
  -- already assigned from the column default and matches no stored row, so the
  -- clause is a no-op there.
  select coalesce(sum(amount), 0) into spent
  from public.xp_events
  where user_id = new.user_id
    and week_start = new.week_start
    and id is distinct from new.id;

  if spent + new.amount > ceiling then
    raise exception
      'weekly XP ceiling exceeded: % already awarded for week %, refusing % more (ceiling %)',
      spent, new.week_start, new.amount, ceiling
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

-- Idempotent so the migration can be replayed against a database that already
-- has it, which is what tests/db and a local reset both do.
drop trigger if exists xp_events_ceiling on public.xp_events;
create trigger xp_events_ceiling
  before insert or update on public.xp_events
  for each row execute function public.enforce_weekly_xp_ceiling();
