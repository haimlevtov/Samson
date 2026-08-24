-- Samson 0004 — gamification content and event ledgers
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7
-- Personas, achievements and challenge templates are rows. Adding one is a
-- migration, never an application code change. See .claude/skills/.

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (user_id) on delete cascade,
  slug text not null,
  name text not null,
  system_prompt text not null,
  tts_voice_id text,
  intensity int not null default 3 check (intensity between 1 and 5),
  humor_level text not null default 'cheeky'
    check (humor_level in ('clean', 'cheeky', 'crude')),
  banned_phrases text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint personas_slug_unique unique nulls not distinct (user_id, slug)
);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (user_id) on delete cascade,

  -- AI-NOTE: never reuse a released slug for different criteria — users already
  --          hold it. See .claude/skills/add-achievement/SKILL.md.
  slug text not null,
  name text not null,
  description text not null,

  -- INVARIANT: the LLM never computes a number — CLAUDE.md #1
  -- WHY: unlock conditions are SQL over logged data, evaluated server-side, so
  --      the same history always yields the same result. No model is consulted.
  predicate text not null,

  tier text not null
    check (tier in ('volume', 'consistency', 'comeback', 'pr', 'recovery', 'variety', 'hidden', 'calendar')),
  humor_level text not null default 'cheeky'
    check (humor_level in ('clean', 'cheeky', 'crude')),
  hidden boolean not null default false,
  source_hint text,
  created_at timestamptz not null default now(),
  constraint achievements_slug_unique unique nulls not distinct (user_id, slug)
);

create table public.achievement_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,
  achievement_id uuid not null references public.achievements (id) on delete cascade,
  unlocked_at timestamptz not null default now(),

  -- The user local date at unlock, for calendar-tier correctness — CLAUDE.md #9
  local_date date not null,

  -- WHY: this constraint is what makes "fires exactly once" a database
  --      guarantee rather than a property of whichever code path evaluates it.
  constraint achievement_events_once unique (user_id, achievement_id)
);

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,

  -- INVARIANT: XP derives from adherence, never volume — CLAUDE.md #4
  -- WHY: there is deliberately no 'tonnage' or 'volume' source. Volume-scaled
  --      XP pays people to overtrain. Adding one here breaks the invariant even
  --      if the arithmetic elsewhere is correct.
  source text not null
    check (source in ('adherence', 'streak', 'achievement', 'challenge', 'quest')),
  amount int not null check (amount >= 0),

  occurred_at timestamptz not null default now(),
  local_date date not null,

  -- WHY: the weekly ceiling is enforced against this bucket, so it is stored
  --      rather than derived — a user changing timezone must not retroactively
  --      move XP between weeks and reopen a spent ceiling.
  week_start date not null,

  created_at timestamptz not null default now()
);

create index xp_events_user_week_idx on public.xp_events (user_id, week_start);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  -- NULL user_id is an unassigned pool template; a set user_id is an assignment.
  user_id uuid references public.users (user_id) on delete cascade,
  slug text not null,
  kind text not null check (kind in ('daily', 'weekly')),

  -- Deterministic completion criteria, verified server-side — CLAUDE.md #1
  spec jsonb not null default '{}'::jsonb,

  window_start date,
  window_end date,
  status text not null default 'offered'
    check (status in ('offered', 'active', 'completed', 'failed', 'rejected')),

  -- WHY: phase 4 requires that a rejected challenge is inspectable. The
  --      validator writes its reasons here rather than only logging them.
  validation_reasons jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  constraint challenges_window check (window_end is null or window_start is null or window_end >= window_start)
);

create index challenges_user_status_idx on public.challenges (user_id, status);

alter table public.personas enable row level security;
alter table public.achievements enable row level security;
alter table public.achievement_events enable row level security;
alter table public.xp_events enable row level security;
alter table public.challenges enable row level security;

create policy personas_read on public.personas
  for select to authenticated using (user_id is null or user_id = auth.uid());
create policy personas_write on public.personas
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- INVARIANT: hidden achievement definitions are never sent to the client.
-- WHY: PLAN.md phase 5 requires this. Enforcing it in the policy rather than in
--      a query means no future endpoint can leak them by forgetting a filter.
-- AI-NOTE: server-side unlock evaluation must therefore run in a SECURITY
--          DEFINER function, not through the user client, or hidden
--          achievements will never fire.
create policy achievements_read_visible on public.achievements
  for select to authenticated
  using ((user_id is null or user_id = auth.uid()) and hidden = false);
create policy achievements_write on public.achievements
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- INVARIANT: no completion can be granted from the client — PLAN.md phase 4.
-- WHY: read-only policies. Unlocks and XP are written by SECURITY DEFINER
--      functions after server-side verification, never by the user session.
create policy achievement_events_read_own on public.achievement_events
  for select to authenticated using (user_id = auth.uid());

create policy xp_events_read_own on public.xp_events
  for select to authenticated using (user_id = auth.uid());

create policy challenges_read on public.challenges
  for select to authenticated using (user_id is null or user_id = auth.uid());
