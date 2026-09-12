-- Samson 0067 — the anon role gets nothing from reset_demo_account
--
-- FOUND BY CI, and it is its own small lesson about process.
--
-- 20260912180000 created `reset_demo_account()` with
-- `revoke all on function ... from public`. Every other function in this schema
-- revokes `from public, anon` — 20260902090000 sets the shape — because Supabase
-- grants the anon role broadly and revoking PUBLIC alone leaves an explicit anon
-- grant standing. `tests/db/schema-invariants.test.ts` asserts that no
-- SECURITY DEFINER function is anon-executable, and it failed.
--
-- WHY IT IS A SEPARATE MIGRATION rather than a correction to that file: it had
-- already been pushed to hosted. An applied migration is not re-run, so an edit
-- in place would have fixed every fresh build and left the deployed database
-- with the grant forever — the difference between a schema that is right and a
-- schema that is right only where nobody has looked.
--
-- The function fails closed on a null `auth.uid()` regardless, which is exactly
-- the reasoning that test declines to rely on: grants and policies are two
-- independent gates — ADR 0003, and this project has shipped two grant defects
-- that were invisible because nothing looked (20260901145239, 20260902094000).

revoke all on function public.reset_demo_account() from public, anon;
grant execute on function public.reset_demo_account() to authenticated;
