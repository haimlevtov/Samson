-- Samson 0007 — pin the trigger function search_path
--
-- WHY: a SECURITY INVOKER function with a mutable search_path can be steered by
--      whatever the caller has on their path, which is how a trigger ends up
--      resolving a shadowed function. Supabase's own database linter flags it
--      (0011_function_search_path_mutable) and it was the only security finding
--      on the hosted project.
--
-- An empty search_path is safe here: the body touches only NEW and now(), and
-- pg_catalog is always searched implicitly.
-- AI-NOTE: any future function in this schema needs the same `set search_path`,
--          or the advisor and tests/db/schema-invariants.test.ts will flag it.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
