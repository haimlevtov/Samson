-- Samson 0059 — the ledger admits the speech stage
--
-- ADR 0025: a coach's voice is synthesised through the gateway, and every
-- attempt writes an llm_calls row — CLAUDE.md #3. `stage` is a CHECK
-- constraint, not an enum derived from `LlmStage`, so the new stage needs this
-- migration as well as the TypeScript union.
--
-- WHY this is the step that is easy to miss: the chat stage shipped without it,
-- passed typecheck, lint and the whole unit suite, and failed on its first live
-- message — migration 20260907160000. The unit suite mocks the ledger and never
-- inserts a row.
--
-- AI-NOTE: adding a stage means BOTH `LlmStage` in src/llm/types.ts and this
--          constraint, in the same change. tests/db/schema-invariants.test.ts
--          asserts the two admit exactly the same set.

alter table public.llm_calls
  drop constraint if exists llm_calls_stage_check;

alter table public.llm_calls
  add constraint llm_calls_stage_check
  check (
    stage in (
      'normalizer', 'planner', 'critic', 'persona', 'diet', 'challenge', 'chat', 'speech', 'smoke'
    )
  );
