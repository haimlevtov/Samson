-- Samson 0025 — a pool template's slug is unique, so a replay cannot duplicate it
--
-- FOUND IN REVIEW, 2026-09-02. 20260902090200 inserts the seven pool templates
-- with no `on conflict`, and `challenges` has no unique constraint on slug — its
-- only constraint is `challenges_window`. Re-running it against a database that
-- already holds the pool inserts a second copy of every template, and the
-- generator then draws from a duplicated pool and can assign the same slug to a
-- user twice.
--
-- The sibling migration 20260902090000 states, of itself, "Idempotent so the
-- migration can be replayed against a database that already has it, which is
-- what tests/db and a local reset both do." Three migrations landed together
-- with three different replay behaviours: 090000 idempotent, 090100 hard-fails
-- on achievements_slug_unique, 090200 silently duplicates.
--
-- WHY an index rather than editing 090200 to add `on conflict`: 090200 is
-- applied to the hosted project and editing an applied migration erases the
-- finding. This also puts the guarantee on the DATA rather than on one insert
-- statement, which is the same reasoning as achievement_events_once and
-- xp_events_one_adherence_per_workout — it holds for the generator and for
-- every future writer, not just for the migration that happened to prompt it.
--
-- The honest trade-off: with this index a replay of 090200 now FAILS instead of
-- duplicating. That is the better of the two — a loud abort beats a silently
-- doubled pool that only shows up as a user holding the same challenge twice —
-- but it is not the same thing as making 090200 idempotent, and it should not
-- be mistaken for it.
--
-- WHY partial on `user_id is null`: a null user_id is an unassigned pool
-- template; a set user_id is an assignment to a person. Slugs are unique among
-- templates, and deliberately NOT unique across assignments, because every user
-- who is offered `weekly-three-sessions` holds a row carrying that slug.

create unique index if not exists challenges_pool_slug_unique
  on public.challenges (slug)
  where user_id is null;
