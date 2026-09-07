-- Samson 0033 — the leaderboard, and the project's first cross-user read
--
-- INVARIANT: this view IS the security boundary — ADR 0016 §1. It is the only
--            object in the schema that returns rows the caller does not own, and
--            everything protecting the users it reads is in the SELECT list and
--            the WHERE clause below. Read them as one unit; widening either is
--            a privacy change, not a refactor.
--
-- INVARIANT: application code never uses the service role key — CLAUDE.md #10.
--            That is why this is a view owned by the table owner rather than a
--            privileged client. The tables carry no FORCE ROW LEVEL SECURITY,
--            so the owner reads across users and this view is the one place
--            that does.
--
-- WHY security_invoker is stated when false is already the default: a reader
-- should not have to know the Postgres default to know whether this view is the
-- boundary. Set to true, it would run as the caller, RLS would scope it to one
-- user, and the leaderboard would silently become a list of one — a failure
-- that looks like an empty feature rather than an error.

drop view if exists public.leaderboard;

create view public.leaderboard
with (security_invoker = false) as
select
  -- INVARIANT: user_id is NOT in this list — ADR 0016 §2. It is the join key to
  --            every other table and to auth.users. RLS would still refuse the
  --            follow-up queries, but a stable per-user identifier is how a leak
  --            becomes a correlation, and nothing on this surface needs one.
  u.display_name,

  -- Lifetime XP, summed here rather than stored. coalesce because a user with a
  -- display name and no sessions belongs on the board at zero, not missing from
  -- it: "you have not started" and "you are not here" are different facts.
  coalesce(sum(x.amount), 0)::int as lifetime_xp,

  -- WHY the tie-break is the name: two users on identical XP would otherwise
  -- swap places between renders. Deterministic beats fair here — a list that
  -- reorders itself on refresh reads as broken.
  rank() over (order by coalesce(sum(x.amount), 0) desc, u.display_name asc)::int as rank,

  -- The only identity claim this view makes, and it is about the CALLER. Lets
  -- the page highlight your own row without anybody's id crossing the network.
  (u.user_id = auth.uid()) as is_you

from public.users u
left join public.xp_events x on x.user_id = u.user_id

-- The two conditions that decide who exists here at all.
--
-- ADR 0016 §3: a user with no display name does not appear. The alternatives
-- were an email local part, which turns a game into a directory, and a
-- generated placeholder, which ranks somebody who never volunteered and cannot
-- be recognised anyway. Appearing requires having chosen a name to appear under.
--
-- ADR 0016 §4: opting out removes you.
where u.display_name is not null
  and btrim(u.display_name) <> ''
  and u.leaderboard_opt_out = false

group by u.user_id, u.display_name;

comment on view public.leaderboard is
  'Display name, lifetime XP, rank and is_you for opted-in users with a display name. The only cross-user read in the schema — see docs/adr/0016-leaderboard.md.';

-- INVARIANT: two independent gates — ADR 0003. RLS is one; grants are the
--            other, and they are revoked before they are given so this is not
--            sensitive to whatever a default privilege happened to be.
revoke all on public.leaderboard from public, anon, authenticated;

-- WHY authenticated only, never anon: an unauthenticated leaderboard is a
-- public directory of names and scores, and `is_you` is meaningless with no
-- auth.uid() to compare against.
grant select on public.leaderboard to authenticated;
