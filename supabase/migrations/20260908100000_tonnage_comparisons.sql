-- Samson 0040 — things a lifetime of tonnage weighs as much as
--
-- Plan: docs/plans/phase-5-content-fill.md, PR 3.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. The
--            objects are rows; picking one is `compareTonnage` in
--            src/metrics/comparisons.ts, which is deterministic and unit-tested
--            like every other number in this project (CLAUDE.md #1).
--
-- WHY this exists at all: Profile prints a lifetime tonnage in kilograms, and
-- nobody has any intuition for 39,480 of them. "About a humpback whale" is the
-- one place in this app where a number is allowed to stop being a number.
--
-- That example is the real answer for the real figure, run through the shipped
-- rule against the shipped rows. FOUND IN REVIEW: it used to say 140,000 kg was
-- "about a double-decker bus", which the selector this migration exists to
-- serve does not agree with — at that total it says one Space Shuttle orbiter,
-- and a bus would have been eleven of them. A worked example nobody ran is the
-- one number in a file that a reader will check.
--
-- INVARIANT: units are stored canonically — CLAUDE.md #8. mass_kg, converted at
--            display only, like every other mass in the schema.
--
-- ---------------------------------------------------------------------------
-- On the numbers, and what `source_note` is and is not
-- ---------------------------------------------------------------------------
--
-- These are widely published approximate figures, and every row carries the
-- range it stands in for rather than implying a precision it does not have. An
-- elephant is not 6,000 kg; adult males are 4,000-7,000 kg and 6,000 is a fair
-- middle. Writing the range into the row is the difference between a number
-- somebody looked up and a number somebody typed.
--
-- AI-NOTE: `source_note` is NOT a citation and must not be read as one. Phase
--          5's supplement evidence table is the place where a claim needs a
--          resolvable DOI, because a wrong dose can hurt somebody. A whale
--          being 20 tonnes out changes a joke. Do not add DOIs here and do not
--          let the two tables' standards leak into each other.
--
-- WHY the ladder runs past anything anybody will reach: the top two rows are
-- aspirational on purpose. `compareTonnage` picks the heaviest object the user
-- has actually passed, so an unreachable row is inert until it is not — and a
-- ladder that stopped at the elephant would tell somebody at 240,000 kg that
-- they had lifted forty elephants, where the shipped ladder says one Statue of
-- Liberty. Both are true; only one is a sentence.
--
-- AI-NOTE: the ranges in `source_note` are written in metric, because the whole
--          column is. `users.unit_preference` allows 'imperial' and nothing
--          converts at display yet; when something does, these notes are
--          authored content and will not convert with it. That is a decision
--          for whoever builds the toggle — probably a second column rather than
--          a parser.

create table public.tonnage_comparisons (
  id uuid primary key default gen_random_uuid(),

  -- INVARIANT: every table has user_id and RLS — CLAUDE.md #10.
  -- NULL means shared system content, readable by every authenticated user —
  -- the same pattern the exercise catalogue and the personas use, argued in
  -- docs/adr/0002-catalogue-user-id.md.
  user_id uuid references public.users (user_id) on delete cascade,

  slug text not null,

  -- WHY two forms rather than one plus an "s": the article belongs to the
  -- singular ("a double-decker bus", "the Statue of Liberty") and English
  -- plurals are not a suffix rule ("rhinoceroses", "Statues of Liberty"). A
  -- pluraliser in code would be a second thing to get wrong in a row that is
  -- already content.
  singular text not null,
  plural text not null,

  mass_kg numeric(12, 2) not null check (mass_kg > 0),

  -- Not a citation. See the AI-NOTE above.
  source_note text not null,

  created_at timestamptz not null default now(),
  constraint tonnage_comparisons_slug_unique unique nulls not distinct (user_id, slug)
);

create index tonnage_comparisons_mass_idx on public.tonnage_comparisons (mass_kg);

alter table public.tonnage_comparisons enable row level security;

-- AI-NOTE: both policies, copied from the catalogue pattern — ADR 0002.
--          SUPERSEDED for this table by migration 20260908100100, which drops
--          the write half. The ADR justifies it by a named future feature,
--          user-authored custom exercises; there is no equivalent here, so the
--          pair granted INSERT to every authenticated session in exchange for
--          nothing. Read that migration before restoring it.
create policy tonnage_comparisons_read on public.tonnage_comparisons
  for select to authenticated using (user_id is null or user_id = auth.uid());
create policy tonnage_comparisons_write on public.tonnage_comparisons
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into public.tonnage_comparisons (user_id, slug, singular, plural, mass_kg, source_note)
values
  (null, 'domestic-cat', 'a domestic cat', 'domestic cats', 4.5,
   'Adult domestic cat, typically 4-5 kg'),
  (null, 'washing-machine', 'a washing machine', 'washing machines', 70,
   'Domestic front-loader, 65-80 kg empty'),
  (null, 'upright-piano', 'an upright piano', 'upright pianos', 220,
   'Typical upright, 200-350 kg'),
  (null, 'horse', 'a horse', 'horses', 500,
   'Adult riding horse, 400-600 kg'),
  (null, 'small-car', 'a small car', 'small cars', 1200,
   'Kerb weight of a European supermini, 1,000-1,400 kg'),
  (null, 'white-rhinoceros', 'a white rhinoceros', 'white rhinoceroses', 2300,
   'Adult male, 2,000-2,500 kg'),
  (null, 'african-elephant', 'an African elephant', 'African elephants', 6000,
   'Adult male, 4,000-7,000 kg'),
  (null, 'double-decker-bus', 'a double-decker bus', 'double-decker buses', 12000,
   'Unladen weight of a modern London double-decker, 11-13 tonnes'),
  (null, 'humpback-whale', 'a humpback whale', 'humpback whales', 30000,
   'Adult humpback, 25-30 tonnes'),
  (null, 'space-shuttle-orbiter', 'a Space Shuttle orbiter', 'Space Shuttle orbiters', 78000,
   'Empty orbiter at landing, about 78 tonnes'),
  (null, 'blue-whale', 'a blue whale', 'blue whales', 150000,
   'Adult blue whale, 100-150 tonnes'),
  (null, 'statue-of-liberty', 'the Statue of Liberty', 'Statues of Liberty', 225000,
   'Copper skin and steel frame, about 225 tonnes'),
  (null, 'saturn-v', 'a fuelled Saturn V', 'fuelled Saturn Vs', 2970000,
   'Fully fuelled at launch, about 2,970 tonnes'),
  (null, 'eiffel-tower', 'the Eiffel Tower', 'Eiffel Towers', 10100000,
   'Whole structure including foundations, about 10,100 tonnes');
