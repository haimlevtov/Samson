-- Appearance, per user — ADR 0012's profile screen.
--
-- WHY a column rather than localStorage: every other control on that screen is
-- a `users` column, and the root layout stamps this one onto <html> on the
-- server, so the very first paint is already the right theme. A preference
-- read in the browser arrives after the document does, which is a white flash
-- on every navigation for anyone who chose dark.
--
-- 'system' is the default and stamps no attribute at all, leaving
-- `prefers-color-scheme` to decide. An explicit choice has to beat the device
-- in both directions, which is why the value is three-valued rather than a
-- boolean.
--
-- INVARIANT: RLS is already enabled on this table with an owner-only policy,
--            and it covers this column with everything else — CLAUDE.md #10.
alter table public.users
  add column theme text not null default 'system'
    check (theme in ('light', 'dark', 'system'));

comment on column public.users.theme is
  'Appearance preference. system follows prefers-color-scheme; see app/globals.css.';
