-- Samson 0031 — the ledger accepts the chat stage
--
-- INVARIANT: every gateway call writes a row, including failures — CLAUDE.md #3
--
-- The stage list is a CHECK constraint rather than an enum, so adding a
-- pipeline stage in TypeScript alone leaves the database rejecting every row it
-- writes. Which is what happened: `chat` was added to `LlmStage`, the unit
-- suite passed (it mocks the gateway, so no row is ever inserted), and the
-- first live message failed with
--
--   new row for relation "llm_calls" violates check constraint
--   "llm_calls_stage_check"
--
-- The failure mode was the right one — invariant #3 means a call whose ledger
-- row will not insert is a call that fails, not one that runs unlogged — but it
-- is only reachable with a key, a database and a real message.
--
-- AI-NOTE: adding a stage means BOTH `LlmStage` in src/llm/types.ts and this
--          constraint, in the same change. There is a companion assertion in
--          tests/db/schema-invariants.test.ts so the next stage is caught by the db
--          suite rather than by a user.
--
-- See docs/adr/0015-coach-chat.md.

alter table public.llm_calls
  drop constraint if exists llm_calls_stage_check;

alter table public.llm_calls
  add constraint llm_calls_stage_check
  check (
    stage in ('normalizer', 'planner', 'critic', 'persona', 'diet', 'challenge', 'chat', 'smoke')
  );
