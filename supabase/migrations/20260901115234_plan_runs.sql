-- Samson 0009 — plan runs, and where rejections are kept apart
--
-- INVARIANT: RLS on, user_id on every row, no service-role bypass — CLAUDE.md #10
--
-- WHY this table exists and llm_calls could not serve: llm_calls records calls.
--      A deterministic rule rejection is not a call — no request is made, no
--      tokens are spent, no row could exist there. PLAN.md phase 2 requires that
--      "a plan that passes the rules but is rejected by the critic is recorded
--      as such — the two rejection sources are never conflated in the ledger",
--      and without somewhere to write a rules rejection that is unimplementable.
--
-- AI-NOTE: llm_calls stays the token ledger and this stays the outcome ledger.
--          Do not add token columns here. One plan run fans out to several
--          llm_calls rows, and joining them on user_id + created_at range is
--          deliberate: a run's cost is derived from the ledger, never duplicated
--          into it, so the two can never disagree.

create table public.plan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,

  status text not null
    check (status in ('accepted', 'rejected_rules', 'rejected_critic', 'exhausted', 'failed')),

  -- How many planner→rules→critic passes the run took. 1 means first-time pass.
  -- WHY recorded: the retry distribution is the evaluator-optimizer pattern's
  --      actual cost, and an average hides the case that matters — the run that
  --      needed all three.
  iterations int not null check (iterations >= 1),

  -- The accepted TrainingBlock. NULL on every non-accepted status.
  -- WHY not materialised into workouts/sets rows: phase 2 generates and
  --     validates; phase 3's persona layer delivers. Writing planned sessions
  --     into the training log before anything can present them would put rows in
  --     front of the user that no surface explains.
  block jsonb,

  -- INVARIANT: the two rejection sources are never conflated — PLAN.md phase 2.
  -- Every element is { source: 'rules'|'critic', code, detail, week_number }.
  -- WHY source is a field rather than two columns or two tables: the order they
  --      arrived in is the shape of the conversation, and splitting them loses
  --      which rejection prompted which revision.
  rejections jsonb not null default '[]',

  -- Hash of the planner input. Two runs with the same hash asked the same
  -- question, which is what makes prompt-version comparisons possible later.
  input_hash text,

  created_at timestamptz not null default now(),

  constraint plan_runs_block_present_when_accepted
    check ((status = 'accepted') = (block is not null))
);

create index plan_runs_user_created_idx on public.plan_runs (user_id, created_at desc);
create index plan_runs_status_idx on public.plan_runs (status, created_at desc);

alter table public.plan_runs enable row level security;

-- WHY select and insert only, matching llm_calls: a run is a record of what
-- happened. Letting a user rewrite or delete one would make the phase report's
-- rejection counts a claim rather than a measurement.
create policy plan_runs_read_own on public.plan_runs
  for select to authenticated using (user_id = auth.uid());

create policy plan_runs_insert_own on public.plan_runs
  for insert to authenticated with check (user_id = auth.uid());
