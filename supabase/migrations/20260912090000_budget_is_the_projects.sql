-- Samson 0061 — the weekly LLM budget is the project's, not its owner's
--
-- ADR 0026 §1, committed first.
--
-- THE BYPASS, the same shape migrations 20260907190000 (display_name) and
-- 20260908090300 (timezone) closed for other columns: `authenticated` holds
-- table-wide UPDATE on public.users (ADR 0003) and `users_update_own` permits
-- it, so one `PATCH /rest/v1/users {"llm_weekly_budget_usd": 999999}` lifted
-- the ceiling the gateway's budget gate reads — and `users_insert_own` let a
-- user choose it when the row was created. The only check was `>= 0`, which
-- NaN passes: Postgres sorts NaN above every number.
--
-- Since ADR 0025 the key is funded and that ceiling is the one control between
-- a signed-in user and the project's OpenRouter credit.
--
-- WHY a trigger rather than a column privilege: a column-level REVOKE does
-- nothing while the table-level UPDATE grant stands, and narrowing that grant
-- means re-listing every column Settings writes — a list the next column would
-- silently fall out of.
--
-- WHY the insert case rewrites rather than refuses: a row a user creates for
-- themselves is legitimate, and the value it carries for this column is simply
-- not theirs to choose. The service role — the seeder, an operator — passes
-- untouched in both cases.

create or replace function public.guard_llm_budget()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- WHY current_user: PostgREST runs a signed-in request as `authenticated`,
  -- and an invoker-rights trigger sees that role. A SECURITY DEFINER function
  -- writing this table would run as its owner and pass — there are none today.
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      -- AI-NOTE: the column's default (migration 20260824150139), restated as a
      --          literal and NOT read from it: a BEFORE INSERT trigger runs
      --          after the default has been substituted, so there is nothing
      --          left here to tell "asked for 0.50" from "asked for nothing".
      --          $0.50 therefore lives in two places. Change both together.
      new.llm_weekly_budget_usd := 0.50;
    elsif new.llm_weekly_budget_usd is distinct from old.llm_weekly_budget_usd then
      raise exception 'the weekly LLM budget is not the user''s to change'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

-- A trigger fires whatever the writer's EXECUTE rights; nobody calls this.
revoke all on function public.guard_llm_budget() from public, anon, authenticated;

drop trigger if exists users_guard_llm_budget on public.users;
create trigger users_guard_llm_budget
  before insert or update on public.users
  for each row execute function public.guard_llm_budget();

-- `>= 0` stays; this adds the value it let through.
alter table public.users
  add constraint users_llm_budget_not_nan
    check (llm_weekly_budget_usd <> 'NaN'::numeric);

comment on column public.users.llm_weekly_budget_usd is
  'The ceiling the gateway''s weekly budget gate reads. Set by the database, never by its owner: a trigger resets it on a user''s insert and refuses a user''s change — migration 20260912090000, ADR 0026.';
