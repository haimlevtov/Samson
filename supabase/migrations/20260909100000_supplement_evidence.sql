-- Samson 0051 — the supplement evidence table
--
-- Plan: docs/plans/phase-5-content-fill.md, PR 6.
-- Contract: docs/adr/0023-evidence-rows.md, committed first.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7.
--
-- `dose` is PROSE and CLAUDE.md #8 does not apply to it. FOUND IN REVIEW: this
-- header claimed the doses were canonical grams and the display layer formatted
-- them. Neither is true — the column holds "3–6 mg per kg bodyweight, 60 minutes
-- before" and "No dose is recommended — eat the protein instead", and the page
-- prints it verbatim. The plan asked for "a dose range in canonical units"; a
-- range with a schedule, a per-kilogram basis and a "do not take this" case is
-- not a number with a unit, and pretending otherwise would have meant either
-- losing the caveats or inventing a parser for something nothing computes with.
--
-- AI-NOTE: nothing may do arithmetic on `dose`. If a feature ever needs to, add
--          typed columns beside it rather than parsing this one.
--
-- ONE ROW, ONE CLAIM, ONE DOI. A row that summarised a literature would have no
-- single statement for its source to back, which makes the citation decoration.
-- The grades are defined in the ADR; `D` means the evidence does NOT support the
-- popular claim, and the three D rows here are the reason the table is worth
-- shipping.
--
-- ---------------------------------------------------------------------------
-- What was checked, and what was not
-- ---------------------------------------------------------------------------
--
-- Every DOI below was resolved against Crossref while writing this, and every
-- claim was written against the source's ABSTRACT, fetched from PubMed. Titles,
-- journals and years were confirmed the same way.
--
-- No full text was read. ADR 0023 states the residual gap: a row can cite a real
-- paper, on the right subject, and still put its conclusion more strongly than
-- the paper does. `npm run verify:doi` cannot see that and neither can any other
-- check here.
--
-- AI-NOTE: adding a row means finding a source for THAT claim and reading its
--          abstract. Do not reuse a DOI already in the table for a different
--          claim — that is the "one row summarises a literature" failure the
--          ADR rejects, wearing a citation.

create table public.supplement_evidence (
  id uuid primary key default gen_random_uuid(),
  -- INVARIANT: every table has user_id — CLAUDE.md #10. Null means shared
  --            content, the same shape as the exercise catalogue (ADR 0002).
  user_id uuid references public.users (user_id) on delete cascade,
  slug text not null,
  supplement text not null,
  -- One sentence, in the user's language, that the DOI below backs.
  claim text not null,
  grade text not null check (grade in ('A', 'B', 'C', 'D')),
  -- Prose, read by a person and never parsed. See the header.
  dose text,
  -- What a reader has to know before acting on the row: paraesthesia, GI
  -- distress, an interaction. Null when the source names none.
  caution text,
  doi text not null,
  source_title text not null,
  source_year int not null check (source_year between 1990 and 2100),
  -- Ordering for the page, so the table does not sort alphabetically into
  -- nonsense. Lower sorts first.
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint supplement_evidence_slug_unique unique nulls not distinct (user_id, slug)
);

alter table public.supplement_evidence enable row level security;

-- Read-only to every signed-in user, and there is NO write policy.
--
-- WHY, and it is the lesson of migration 20260908120100 rather than caution:
-- `progression_nodes` shipped with the catalogue's read/write policy pair, and
-- the write half granted INSERT to every authenticated session for a feature
-- that did not exist — while the unique constraint above is
-- `nulls not distinct`, so a user row could reuse a SYSTEM slug. There is no
-- evidence-authoring feature and nothing under src/ or app/ writes one. The
-- pair is not written here, so it cannot be dropped later.
--
-- INVARIANT: RLS and grants are two independent gates — ADR 0003. The
--            authenticated role keeps its DML grant, as schema-invariants
--            requires of every table; RLS is what refuses the write.
create policy supplement_evidence_read on public.supplement_evidence
  for select to authenticated using (user_id is null or user_id = auth.uid());

create index supplement_evidence_order_idx on public.supplement_evidence (display_order);

-- ---------------------------------------------------------------------------
-- The rows
-- ---------------------------------------------------------------------------

insert into public.supplement_evidence
  (slug, supplement, claim, grade, dose, caution, doi, source_title, source_year, display_order)
values
  (
    'creatine-strength',
    'Creatine monohydrate',
    'Raises intramuscular creatine, which is how it improves high-intensity performance and, over a training block, the adaptations that follow from it.',
    'A',
    '3–5 g per day',
    null,
    '10.1186/s12970-017-0173-z',
    'International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine',
    2017,
    10
  ),
  (
    'caffeine-performance',
    'Caffeine',
    'Acutely improves several aspects of exercise performance — in many studies, though not all of them.',
    'A',
    '3–6 mg per kg bodyweight, 60 minutes before',
    'Disrupts sleep for hours after a late dose, and sleep is where training adaptation happens.',
    '10.1186/s12970-020-00383-4',
    'International society of sports nutrition position stand: caffeine and exercise performance',
    2021,
    20
  ),
  (
    'protein-intake',
    'Protein (total daily intake)',
    '1.4–2.0 g per kg of bodyweight per day is enough for most exercising people to build and hold muscle. More is needed only when dieting hard.',
    'A',
    '1.4–2.0 g per kg per day; 2.3–3.1 g/kg when in a deficit',
    null,
    '10.1186/s12970-017-0177-8',
    'International Society of Sports Nutrition Position Stand: protein and exercise',
    2017,
    30
  ),
  (
    'beta-alanine-carnosine',
    'Beta-alanine',
    'Four weeks at 4–6 g a day meaningfully raises muscle carnosine, which is the mechanism behind its effect on sustained high-intensity efforts.',
    'B',
    '4–6 g per day, for at least four weeks',
    'Causes paraesthesia — a harmless skin tingle — at higher single doses. Split the dose if it bothers you.',
    '10.1186/s12970-015-0090-y',
    'International society of sports nutrition position stand: Beta-Alanine',
    2015,
    40
  ),
  (
    'sodium-bicarbonate-buffering',
    'Sodium bicarbonate',
    'Improves high-intensity efforts lasting roughly 30 seconds to 12 minutes, in men and women alike. Outside that window there is nothing to buffer.',
    'B',
    '0.2–0.5 g per kg bodyweight; 0.2 g/kg is the minimum that works',
    'Gastrointestinal distress is common and can be worse than the benefit. Trial it away from anything that matters.',
    '10.1186/s12970-021-00458-w',
    'International Society of Sports Nutrition position stand: sodium bicarbonate and exercise performance',
    2021,
    50
  ),
  (
    'omega-3-strength',
    'Omega-3 (EPA and DHA)',
    'Combined with resistance training it may improve strength, depending on dose and duration — but it may not add anything to muscle size in young adults.',
    'C',
    'Varies by study; no single effective dose is established',
    null,
    '10.1080/15502783.2024.2441775',
    'International Society of Sports Nutrition Position Stand: Long-Chain Omega-3 Polyunsaturated Fatty Acids',
    2025,
    60
  ),
  (
    'citrulline-strength',
    'Citrulline',
    'Studied repeatedly for strength and power over five years, with mixed results reported — which is a different thing from a small effect.',
    'C',
    'Commonly 8 g of citrulline malate, taken before training',
    null,
    '10.1007/s40279-019-01091-z',
    'Acute Effects of Citrulline Supplementation on High-Intensity Strength and Power Performance: A Systematic Review and Meta-Analysis',
    2019,
    70
  ),
  (
    'hmb-supplementation',
    'HMB',
    'A leucine metabolite with a safety record out to a year of daily use. Its case rests on reducing muscle damage rather than on adding strength to a trained lifter.',
    'C',
    '3 g per day',
    null,
    '10.1080/15502783.2024.2434734',
    'International society of sports nutrition position stand: β-hydroxy-β-methylbutyrate (HMB)',
    2024,
    80
  ),
  (
    'probiotics-gut-immune',
    'Probiotics',
    'Best evidenced for gut and immune outcomes, and strain- and dose-dependent even there. Not a strength supplement.',
    'C',
    'Strain-specific; a dose from one product says nothing about another',
    null,
    '10.1186/s12970-019-0329-0',
    'International Society of Sports Nutrition Position Stand: Probiotics',
    2019,
    90
  ),
  (
    'eaa-supplementation',
    'Essential amino acids (EAAs)',
    'Free-form EAAs raise blood amino acids quickly and stimulate muscle protein synthesis. Whether that beats simply eating enough protein is the question they are usually sold as having answered.',
    'C',
    'Study doses vary; see the protein row for the intake that matters first',
    null,
    '10.1080/15502783.2023.2263409',
    'International Society of Sports Nutrition Position Stand: Effects of essential amino acid supplementation on exercise and performance',
    2023,
    100
  ),
  (
    'bcaa-protein-synthesis',
    'BCAAs',
    'An extensive literature search found NO human study measuring the muscle protein synthesis response to oral BCAAs alone. Building protein needs all the essential amino acids; three of them cannot do it.',
    'D',
    'No dose is recommended — eat the protein instead',
    null,
    '10.1186/s12970-017-0184-9',
    'Branched-chain amino acids and muscle protein synthesis in humans: myth or reality?',
    2017,
    110
  ),
  (
    'zma-anabolic',
    'ZMA (zinc, magnesium, aspartate)',
    'Eight weeks of resistance training with ZMA changed nothing against placebo: not anabolic or catabolic hormones, not body composition, not bench or leg press.',
    'D',
    'No dose is recommended',
    null,
    '10.1186/1550-2783-1-2-12',
    'Effects of Zinc Magnesium Aspartate (ZMA) Supplementation on Training Adaptations and Markers of Anabolism and Catabolism',
    2004,
    120
  ),
  (
    'testosterone-boosters',
    '"Testosterone boosters"',
    'A review of 52 studies covering 27 marketed ingredients found that most fail to raise total testosterone at all.',
    'D',
    'No dose is recommended',
    'Sold hard and regulated lightly, which is the combination this row exists for.',
    '10.1038/s41443-023-00763-9',
    'Do "testosterone boosters" really increase serum total testosterone? A systematic review',
    2024,
    130
  );
