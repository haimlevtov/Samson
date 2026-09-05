-- Samson 0027 — workout templates
--
-- Contract: docs/specs/workout-templates.md
-- Decision: docs/adr/0010-templates-prescribe-sets-record.md
--
-- INVARIANT: RLS on, user_id on every row, no service-role bypass — CLAUDE.md #10
-- INVARIANT: content lives in rows, not in code — CLAUDE.md #7. There is no
--            hard-coded "starter template" anywhere; a user's templates are
--            theirs, and the coach's come from an accepted plan_runs block.
--
-- AI-NOTE: nothing in this migration writes to `sets`, and nothing later
--          should. A template is what was asked for; `sets` is what was done.
--          ADR 0010 has the failure mode that rule prevents.

create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,

  name text not null check (length(btrim(name)) between 1 and 80),

  -- Provenance, not permission. Both kinds are owned and editable by the user;
  -- this only answers "where did this come from" after they have edited it.
  source text not null default 'user' check (source in ('user', 'coach')),

  -- AI-NOTE: untrusted free text, same standing as workouts.notes. Never
  --          interpolate into a system prompt; always pass as user-role content.
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workout_templates_user_idx
  on public.workout_templates (user_id, created_at desc);

create trigger workout_templates_set_updated_at
  before update on public.workout_templates
  for each row execute function public.set_updated_at();

-- One prescribed set group — "3x5 at 60 kg" is one row, not three.
--
-- WHY grouped: ADR 0007 measured the alternative for the planner and this is
--      the same unit, deliberately. A coach import is then a copy rather than a
--      translation, and a translation is where numbers get quietly changed.
create table public.workout_template_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (user_id) on delete cascade,
  template_id uuid not null
    references public.workout_templates (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,

  position int not null check (position >= 0),

  -- Bounds match prescribedSetGroupSchema in src/planner/schema.ts, so a block
  -- that already passed the planner's rules cannot fail this check.
  set_count int not null check (set_count between 1 and 20),
  reps int not null check (reps between 1 and 50),

  -- INVARIANT: canonical units — CLAUDE.md #8. Kilograms and seconds.
  -- Null weight is bodyweight: no external load, which is not the same claim
  -- as a load of zero (src/metrics/tonnage.ts draws the same distinction).
  weight_kg numeric(7, 2) check (weight_kg >= 0 and weight_kg <= 500),
  rpe numeric(3, 1) check (rpe >= 1 and rpe <= 10),
  rest_seconds int check (rest_seconds between 0 and 900),

  created_at timestamptz not null default now(),

  constraint workout_template_items_position_unique unique (template_id, position)
);

create index workout_template_items_template_idx
  on public.workout_template_items (template_id, position);

-- Which template a session was started from, if any.
--
-- WHY `set null` and not `cascade`: deleting a template must not delete the
-- training that was done from it. The history survives; only the link to the
-- prescription goes, and the session stops showing targets.
alter table public.workouts
  add column template_id uuid
    references public.workout_templates (id) on delete set null;

alter table public.workout_templates enable row level security;
alter table public.workout_template_items enable row level security;

create policy workout_templates_own on public.workout_templates
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy workout_template_items_own on public.workout_template_items
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
