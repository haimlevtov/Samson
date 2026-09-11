-- Samson 0002 — content catalogue
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7
-- INVARIANT: every table has user_id and RLS — CLAUDE.md #10
--
-- WHY: catalogue rows are shared content, so user_id is nullable and NULL means
--      "system content, readable by everyone". The invariant stays literally
--      true, and user-authored custom exercises need no new column — though
--      `sets` and `workout_template_items` needed 20260911100000 before they
--      were safe to point at one, and `exercise_equipment` still is not. See
--      docs/adr/0002-catalogue-user-id.md.
-- AI-NOTE: a new catalogue table needs the READ policy below. Add a write
--          policy only when a named feature needs one — ADR 0002's 2026-09-08
--          amendment — with a test that a user cannot write a null-user_id
--          row; progression_nodes (20260908120100), tonnage_comparisons
--          (20260908100100) and supplement_evidence have none. And a write
--          policy on a table with a foreign key into another user-ownable
--          table must ALSO check the referenced row is the writer's own or
--          shared: `exercise_equipment_write` below does not, and is pinned in
--          tests/db/schema-invariants.test.ts — ADR 0003's 2026-09-11
--          amendment.
--
-- FOUND IN REVIEW of PR #43, 2026-09-11: the note above used to say "copy both
-- policies". Amended in place, and 20260908090400 set the precedent: a comment
-- outside a function body is not stored in any schema object, so no database
-- changes.

create table public.equipment_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (user_id) on delete cascade,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  constraint equipment_tags_slug_unique unique nulls not distinct (user_id, slug)
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (user_id) on delete cascade,
  slug text not null,
  name text not null,
  primary_muscle text not null,
  secondary_muscles text[] not null default '{}',
  movement_pattern text
    check (movement_pattern in ('push', 'pull', 'squat', 'hinge', 'carry', 'core', 'isolation')),
  is_unilateral boolean not null default false,
  instructions text,
  source text check (source in ('wger', 'free-exercise-db', 'custom')),
  source_id text,
  created_at timestamptz not null default now(),
  constraint exercises_slug_unique unique nulls not distinct (user_id, slug)
);

-- INVARIANT: the planner selects only from a pre-filtered candidate list — CLAUDE.md #5
-- WHY: equipment filtering happens in SQL through this join before the model
--      sees anything, so an unavailable barbell is never in the context window
--      to be chosen in the first place.
create table public.exercise_equipment (
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  equipment_tag_id uuid not null references public.equipment_tags (id) on delete cascade,
  user_id uuid references public.users (user_id) on delete cascade,
  primary key (exercise_id, equipment_tag_id)
);

create index exercise_equipment_tag_idx on public.exercise_equipment (equipment_tag_id);

create table public.progression_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (user_id) on delete cascade,
  tree text not null check (tree in ('push', 'pull', 'legs', 'core')),
  slug text not null,
  name text not null,
  exercise_id uuid references public.exercises (id) on delete restrict,
  parent_id uuid references public.progression_nodes (id) on delete cascade,
  level int not null default 0 check (level >= 0),
  unlock_criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint progression_nodes_slug_unique unique nulls not distinct (user_id, slug)
);

create index progression_nodes_parent_idx on public.progression_nodes (parent_id);

alter table public.equipment_tags enable row level security;
alter table public.exercises enable row level security;
alter table public.exercise_equipment enable row level security;
alter table public.progression_nodes enable row level security;

create policy equipment_tags_read on public.equipment_tags
  for select to authenticated using (user_id is null or user_id = auth.uid());
create policy equipment_tags_write on public.equipment_tags
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy exercises_read on public.exercises
  for select to authenticated using (user_id is null or user_id = auth.uid());
create policy exercises_write on public.exercises
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy exercise_equipment_read on public.exercise_equipment
  for select to authenticated using (user_id is null or user_id = auth.uid());
create policy exercise_equipment_write on public.exercise_equipment
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy progression_nodes_read on public.progression_nodes
  for select to authenticated using (user_id is null or user_id = auth.uid());
create policy progression_nodes_write on public.progression_nodes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
