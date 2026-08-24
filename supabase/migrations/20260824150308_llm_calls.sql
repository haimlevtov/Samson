-- Samson 0005 — the token ledger
--
-- INVARIANT: every gateway call writes a row here, including failed and retried
--            calls — CLAUDE.md #3
-- WHY: PLAN.md puts phase 0 first precisely so this table exists before the
--      first agent does. Cost per user per week by stage, cache hit rate over
--      time, retry cost and cascade saving are all graded outputs, and none of
--      them can be reconstructed after the fact. A missing row is data lost
--      permanently, which is why the gateway writes in a finally block.

create table public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,

  -- Which pipeline stage spent the tokens. Drives the per-stage cost breakdown.
  stage text not null
    check (stage in ('normalizer', 'planner', 'critic', 'persona', 'diet', 'challenge', 'smoke')),

  -- 1-based. A retry writes a second row, not an update to the first.
  attempt int not null default 1 check (attempt >= 1),

  status text not null
    check (status in ('ok', 'schema_invalid', 'http_error', 'timeout', 'budget_denied')),

  -- The fallback array as requested, and which model actually answered.
  -- WHY: the cascade saving in the token analysis is measured by comparing
  --      these two across the whole ledger.
  models_requested text[] not null default '{}',
  model_used text,
  openrouter_id text,

  prompt_tokens int,
  completion_tokens int,
  total_tokens int,

  -- OpenRouter reports cache reads and cache writes separately.
  -- AI-NOTE: cached_tokens are read from cache, cache_write_tokens are written
  --          to it. They are not interchangeable and must not be summed.
  cached_tokens int,
  cache_write_tokens int,
  reasoning_tokens int,

  -- usage.cost: credits charged by OpenRouter.
  cost_credits numeric(12, 8),
  -- usage.cost_details.upstream_inference_cost: what the provider charged.
  upstream_cost numeric(12, 8),

  latency_ms int check (latency_ms >= 0),

  -- WHY: phase 2 lays prompts out static-first so the cache prefix holds. This
  --      hash of the static prefix is what makes the resulting hit rate
  --      measurable per prompt version. It costs one hash at call time and
  --      cannot be recovered later.
  prompt_prefix_hash text,

  error text,

  created_at timestamptz not null default now()
);

create index llm_calls_user_created_idx on public.llm_calls (user_id, created_at desc);
create index llm_calls_stage_created_idx on public.llm_calls (stage, created_at desc);
create index llm_calls_prefix_idx on public.llm_calls (prompt_prefix_hash);

alter table public.llm_calls enable row level security;

-- WHY: select and insert only. No update and no delete policy exists, so a user
--      cannot erase their own spend to reset the weekly budget check that reads
--      this same table. Inserting extra rows only spends their own budget
--      faster, so it is not worth defending against.
create policy llm_calls_read_own on public.llm_calls
  for select to authenticated using (user_id = auth.uid());

create policy llm_calls_insert_own on public.llm_calls
  for insert to authenticated with check (user_id = auth.uid());
