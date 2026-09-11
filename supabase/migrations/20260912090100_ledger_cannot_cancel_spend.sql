-- Samson 0062 — a planted ledger row cannot cancel spend
--
-- ADR 0026 §2, committed first.
--
-- `llm_calls_insert_own` lets a signed-in user insert their own ledger rows,
-- and has to: the gateway writes the ledger with the user's own client, because
-- CLAUDE.md #10 keeps the service role out of application code. The phase-0
-- migration (20260824150308) justified it with "Inserting extra rows only
-- spends their own budget faster, so it is not worth defending against".
--
-- FOUND IN REVIEW of #49, and false three ways:
--   * a row with a negative or NaN `cost_credits` subtracted from, or poisoned,
--     the week's spend;
--   * a row dated 2099 stayed inside every future window;
--   * `sumSpendSince` fetched rows and summed them in JavaScript, and PostgREST
--     stops at 1,000 — so a thousand planted zero-cost rows pushed real spend
--     out of the sum. The same cap migration 20260902100200 fixed for XP.
--
-- After this migration the claim is true: a row a user writes can only ever
-- add to their own spend.

-- Costs are money spent: never negative, never NaN (which a `>= 0` check alone
-- admits, because Postgres sorts NaN above every number).
alter table public.llm_calls
  add constraint llm_calls_cost_credits_spent
    check (cost_credits is null or (cost_credits >= 0 and cost_credits <> 'NaN'::numeric)),
  add constraint llm_calls_upstream_cost_spent
    check (upstream_cost is null or (upstream_cost >= 0 and upstream_cost <> 'NaN'::numeric));

-- A row is dated by the database, never by its writer. Insert only: there is no
-- update policy on this table, so only the service role could re-date a row.
create or replace function public.date_llm_call()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

revoke all on function public.date_llm_call() from public, anon, authenticated;

drop trigger if exists llm_calls_dated_by_the_database on public.llm_calls;
create trigger llm_calls_dated_by_the_database
  before insert on public.llm_calls
  for each row execute function public.date_llm_call();

-- The week's spend, summed where the rows are.
--
-- WHY counts rather than a total: two kinds of row are charged an assumption
-- rather than their `cost_credits` — a timeout, which is billed and never read
-- (ADR 0007), and a speech attempt that reached a 200, which carries no price
-- (ADR 0025). The assumed prices are config (`TIMEOUT_ASSUMED_COST_USD`,
-- `SPEECH_ASSUMED_COST_USD` in src/llm/config.ts), so the database counts the
-- rows and src/db/ledger.ts applies the prices. The ledger records only what
-- was measured; the estimates never enter a row.
--
-- WHY security invoker AND a user id: RLS scopes the rows to the caller, as it
-- does for xp_totals; the explicit filter says whose spend is meant, and keeps a
-- future caller on an elevated client from summing everybody's.
--
-- AI-NOTE: the three categories here are the rule `chargedFor` used to apply
--          row by row in src/db/ledger.ts. A new unpriced kind of row needs a
--          count here and a price there, in the same change.
create or replace function public.llm_spend_summary(p_user_id uuid, p_since timestamptz)
returns table (measured numeric, timeouts bigint, unpriced_speech bigint)
language sql
security invoker
stable
set search_path = ''
as $fn$
  select
    coalesce(sum(c.cost_credits) filter (where c.cost_credits is not null), 0),
    count(*) filter (where c.cost_credits is null and c.status = 'timeout'),
    count(*) filter (
      where c.cost_credits is null
        and c.stage = 'speech'
        and c.status in ('ok', 'schema_invalid')
    )
  from public.llm_calls c
  where c.user_id = p_user_id
    and c.created_at >= p_since;
$fn$;

-- INVARIANT: RLS and grants are two independent gates — ADR 0003.
revoke all on function public.llm_spend_summary(uuid, timestamptz) from public, anon;
grant execute on function public.llm_spend_summary(uuid, timestamptz) to authenticated;
