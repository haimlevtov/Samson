-- Samson 0034 — close three ways onto the board that are not a name
--
-- FOUND IN REVIEW, 2026-09-07, against the migrations two numbers below this.
-- A third migration rather than an edit to those: they are already applied, and
-- an applied migration does not re-run — CLAUDE.md, "migrations only".
--
-- See docs/adr/0016-leaderboard.md §3, which these make true.

-- 1. A length bound the database enforces --------------------------------
--
-- `display_name` was bare `text`, with `max(60)` living only in the Zod schema
-- at app/settings/actions.ts. That was harmless while the column was read only
-- by its owner. It is now cross-user readable, and the view ships the string
-- BEFORE `clampDisplayName` sees it — clamping happens after the network hop —
-- so a 100 KB name would be multiplied across every cohort member's Hub load.
--
-- `authenticated` holds UPDATE on public.users and `users_update_own` permits
-- it, so the Zod cap is bypassed by one PATCH to /rest/v1/users. This is the
-- second gate — ADR 0003.
alter table public.users
  drop constraint if exists users_display_name_length;

alter table public.users
  add constraint users_display_name_length
  check (display_name is null or char_length(display_name) <= 60);

-- 2. A blank check that actually catches blanks --------------------------
--
-- `btrim(x)` with one argument strips ASCII SPACE and nothing else, so
-- `btrim(E'\t')` and a non-breaking space were both non-empty and passed the old
-- guard. A tab or an NBSP took a numbered slot on everybody's board and rendered
-- as a blank row, which falsifies ADR 0016 §3: appearing is supposed to require
-- having chosen a name to appear under.
--
-- The settings form closed this on its own path — JavaScript's `.trim()` covers
-- both — but the form is not the boundary, and `authenticated` holds UPDATE on
-- public.users, so one PATCH skips it.
--
-- WHY it is inlined in the view rather than a `has_visible_name()` helper: it
-- WAS a helper, and that split the security boundary across two objects. ADR
-- 0016 §1 chose a view precisely because the definition is "a single object, in
-- a migration, that a reviewer can read top to bottom" — a predicate living
-- somewhere else is the thing that argument rules out. It also put a new
-- function into the generated types for one call site.
--
-- AI-NOTE: the character list is explicit rather than `[[:space:]]`, because
--          that class resolves through the collation's ctype and whether it
--          includes U+00A0 is not portable. `chr()` rather than E'' or U&''
--          escapes: one unambiguous spelling that does not depend on
--          standard_conforming_strings. Enumerated, it is the same set on every
--          machine that runs this.

-- 3. The view, rebuilt with the better check and a barrier ----------------
--
-- `security_barrier` is not required today and is set anyway. A caller's filter
-- cannot currently be pushed below this view's WHERE clause, but only because
-- `rank() OVER ()` makes every output column non-pushdown-safe — an accident of
-- the ranking living in SQL. The obvious future simplification, computing rank
-- from the array index in TypeScript, would remove the window function and
-- silently make the opt-out filter bypassable.
--
-- AI-NOTE: do not drop `security_barrier` if the window function ever leaves
--          this view. It is the difference between the property being
--          guaranteed and being emergent.
drop view if exists public.leaderboard;

create view public.leaderboard
with (security_invoker = false, security_barrier = true) as
select
  u.display_name,
  coalesce(sum(x.amount), 0)::int as lifetime_xp,
  rank() over (order by coalesce(sum(x.amount), 0) desc, u.display_name asc)::int as rank,
  (u.user_id = auth.uid()) as is_you
from public.users u
left join public.xp_events x on x.user_id = u.user_id
where btrim(
    coalesce(u.display_name, ''),
    ' '
      || chr(9) -- tab
      || chr(10) -- newline
      || chr(13) -- carriage return
      || chr(160) -- no-break space
      || chr(8199) -- figure space
      || chr(8239) -- narrow no-break space
      || chr(12288) -- ideographic space
  ) <> ''
  and u.leaderboard_opt_out = false
group by u.user_id, u.display_name;

comment on view public.leaderboard is
  'Display name, lifetime XP, rank and is_you for opted-in users with a visible display name. The only cross-user read in the schema — see docs/adr/0016-leaderboard.md.';

revoke all on public.leaderboard from public, anon, authenticated;
grant select on public.leaderboard to authenticated;
