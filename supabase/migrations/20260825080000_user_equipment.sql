-- Samson 0008 — user equipment, and a category for exercises
--
-- INVARIANT: the planner selects only from a pre-filtered candidate list, and
--            equipment filtering happens in SQL — CLAUDE.md #5.
--
-- WHY this table did not exist before: phase 0 built the equipment *catalogue*
--      (equipment_tags) and the exercise↔equipment join (exercise_equipment),
--      but nothing recorded which equipment a given user actually has. Without
--      it there is no way to filter candidates before the model sees them, so
--      invariant #5 was unimplementable. PLAN.md's phase 0 table list omitted it
--      too — this is a genuine gap rather than deferred work.

create table public.user_equipment (
  user_id uuid not null references public.users (user_id) on delete cascade,
  equipment_tag_id uuid not null references public.equipment_tags (id) on delete cascade,

  -- WHY nullable with a positive check: the home-gym archetype in the seeder has
  --     dumbbells that stop at 30 kg. NULL means "no ceiling" (a full rack),
  --     which is different from 0 and must not be conflated with it.
  -- AI-NOTE: the planner must respect this when prescribing load, not merely
  --          when choosing an exercise. Owning dumbbells is not the same as
  --          being able to press 40 kg with them.
  max_load_kg numeric(6, 2) check (max_load_kg > 0),

  created_at timestamptz not null default now(),

  primary key (user_id, equipment_tag_id)
);

create index user_equipment_tag_idx on public.user_equipment (equipment_tag_id);

alter table public.user_equipment enable row level security;

create policy user_equipment_own on public.user_equipment
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- WHY a category column: the source catalogue mixes strength work with
-- stretching and cardio. The planner programmes the former, and filtering it out
-- belongs in the same SQL pass as the equipment filter rather than in a model
-- prompt that can be talked out of it.
alter table public.exercises add column category text;

create index exercises_category_idx on public.exercises (category);
