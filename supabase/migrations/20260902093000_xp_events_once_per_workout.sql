-- Samson 0016 — one adherence award per workout, as a database guarantee
--
-- FOUND IN VERIFICATION, 2026-09-02: award_session_xp was idempotent for
-- achievements — achievement_events carries unique (user_id, achievement_id) —
-- but not for XP. Calling it twice for the same completed workout awarded the
-- session XP twice. Measured: a second call returned {"awarded": 64}.
--
-- It is reachable. `finishWorkout` updates the workout to 'completed' and then
-- calls the RPC; the update is idempotent, so a double submit, a retry, or a
-- resubmitted form runs the award again. The weekly ceiling bounds the damage
-- but does not prevent it, and bounded inflation is still inflation.
--
-- WHY a constraint rather than a guard in the function: the same reasoning as
-- ADR 0009 §2 and as achievement_events. A check inside the function is a
-- property of that function; a unique index is a property of the data, and it
-- holds for every future caller including ones written by someone who has not
-- read this comment.

alter table public.xp_events
  add column if not exists workout_id uuid references public.workouts (id) on delete cascade;

-- WHY partial, and keyed on source as well as workout: a workout legitimately
-- produces at most one 'adherence' row and at most one 'achievement' row, and
-- the rows that have no workout at all (a streak milestone, a challenge
-- payout) must stay unconstrained rather than colliding on a null.
create unique index if not exists xp_events_once_per_workout_source
  on public.xp_events (workout_id, source)
  where workout_id is not null;

comment on column public.xp_events.workout_id is
  'The workout that earned this XP, where one did. Unique per (workout, source) so an award cannot be granted twice — see migration 20260902093000.';
