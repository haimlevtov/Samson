-- Samson 0010 — a ledger status for content-blocked responses
--
-- INVARIANT: every gateway call writes a row, including failures — CLAUDE.md #3
--
-- WHY a new status rather than reusing schema_invalid: a response rejected by
--      the content checks in src/llm/safety.ts is a different fact from one that
--      failed to parse, and PLAN.md's cross-cutting section asks for a taxonomy
--      of what got through. Folding the two together makes that taxonomy
--      uncountable. Tokens were spent either way, so the row exists either way.
--
-- See docs/adr/0005-llm-safety.md.

alter table public.llm_calls
  drop constraint if exists llm_calls_status_check;

alter table public.llm_calls
  add constraint llm_calls_status_check
  check (
    status in ('ok', 'schema_invalid', 'http_error', 'timeout', 'budget_denied', 'safety_blocked')
  );
