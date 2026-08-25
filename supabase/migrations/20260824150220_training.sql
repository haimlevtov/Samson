-- Samson 0003 — training log

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,

  started_at timestamptz,
  ended_at timestamptz,

  -- INVARIANT: timestamps are UTC plus the user IANA timezone — CLAUDE.md #9
  -- WHY: streaks and calendar achievements count *local* days. This is the
  --      local date resolved once at write time from users.timezone, never
  --      re-derived later from a server date.
  local_date date not null,

  -- INVARIANT: XP derives from adherence, never volume — CLAUDE.md #4
  -- WHY: 'rest' and 'planned' are first-class statuses because a scheduled rest
  --      day maintains a streak. Without them, resting costs the user a streak
  --      and the app quietly rewards overtraining.
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'completed', 'skipped', 'rest')),

  -- AI-NOTE: untrusted free text and a prompt-injection surface for the
  --          cross-cutting adversarial suite. Never interpolate into a system
  --          prompt; always pass as user-role content.
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workouts_ends_after_start
    check (ended_at is null or started_at is null or ended_at >= started_at)
);

create index workouts_user_date_idx on public.workouts (user_id, local_date desc);

create trigger workouts_set_updated_at
  before update on public.workouts
  for each row execute function public.set_updated_at();

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,
  workout_id uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,

  set_index int not null check (set_index >= 0),

  -- INVARIANT: units are stored canonically — CLAUDE.md #8
  -- kg and seconds. Imperial users get conversion at display time only.
  weight_kg numeric(7, 2) check (weight_kg >= 0),
  reps int check (reps >= 0),
  rest_seconds int check (rest_seconds >= 0),

  rpe numeric(3, 1) check (rpe >= 1 and rpe <= 10),
  is_warmup boolean not null default false,

  completed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint sets_index_unique unique (workout_id, exercise_id, set_index)
);

create index sets_user_exercise_idx on public.sets (user_id, exercise_id);
create index sets_workout_idx on public.sets (workout_id);

alter table public.workouts enable row level security;
alter table public.sets enable row level security;

create policy workouts_own on public.workouts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy sets_own on public.sets
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
