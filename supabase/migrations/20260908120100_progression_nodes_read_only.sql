-- Samson 0047 — a write policy with no feature behind it, again
--
-- FOUND IN REVIEW, 2026-09-08, on the migration one file earlier.
--
-- `progression_nodes` shipped with the ADR 0002 catalogue policy PAIR, because
-- every catalogue table repeats it. That ADR's amendment — written yesterday,
-- for `tonnage_comparisons`, after review found the identical thing — says the
-- write half is justified by a NAMED FUTURE FEATURE and not by symmetry:
--
--   "the pair granted INSERT on that table to every authenticated session in
--    exchange for nothing, and PostgREST is a path whether or not the UI has a
--    button."
--
-- There is no node-authoring feature and there is not going to be one. Nothing
-- under src/ or app/ writes a progression node, and `loadProgressionTrees`
-- deliberately reads only `user_id is null` rows — so a user-owned node would
-- be visible to nobody, including its author.
--
-- WHAT IT ACTUALLY LET SOMEBODY DO, which is why this is not tidying:
-- `progression_nodes_slug_unique` is `unique nulls not distinct (user_id, slug)`,
-- so a user row may REUSE A SYSTEM SLUG. `unlockStates` keys its map by slug and
-- the reader orders by (level, slug), so a user row duplicating a system slug at
-- the same level ties on both sort keys and which verdict lands in the map is
-- unspecified. A row carrying `{}` at the right level would mark an ancestor
-- unlocked and cascade down the tree.
--
-- Unreachable today, because the reader filters. That filter is now the second
-- gate rather than the only one.
--
-- AI-NOTE: `user_id` stays on the table and stays nullable. It is what makes
--          CLAUDE.md #10 literally true and what the RLS coverage test looks
--          for. If node authoring ever becomes a feature, the policy comes
--          back — with the null-user_id negative test ADR 0002 now requires.

drop policy if exists progression_nodes_write on public.progression_nodes;

-- INVARIANT: RLS and grants are two independent gates — ADR 0003. With no write
-- policy the DML grants could never be satisfied anyway; revoking them closes
-- the second gate behind the first. Same shape as 20260908100100.
revoke all on public.progression_nodes from public, anon, authenticated;
grant select on public.progression_nodes to authenticated;
