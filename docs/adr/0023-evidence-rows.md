# ADR 0023 — One row, one claim, one DOI

**Status:** accepted, phase 5
**Date:** 2026-09-09

> Written before the migration and the page it governs, in its own commit.
>
> `docs/plans/phase-5-content-fill.md` reserved the number **0021** for this
> document. Two ADRs were written between the plan and the work — 0021 on
> training order, 0022 on popover clamping — so it is 0023. The plan's PR 6
> section is otherwise the brief this follows.

## Context

This is the project's first table of **external claims**. Everything else in the
database is either the user's own data or content this project authored:
achievements it wrote, personas it wrote, progression rungs it chose. A
supplement table is different in kind, because every row asserts something about
the world that somebody else established, and a reader has no way to tell a
careful row from an invented one by looking at it.

`docs/PLAN.md` phase 5 sets the acceptance criterion: **every claim has a
resolvable DOI.**

That criterion is necessary and it is not sufficient, which this document exists
to say out loud. While assembling the rows, three DOIs were guessed from plausible
shapes and checked against Crossref:

| DOI                            | Resolves | Is about                                        |
| ------------------------------ | -------- | ----------------------------------------------- |
| `10.1519/JSC.0000000000002917` | yes      | an obituary for a powerlifting historian        |
| `10.1007/s40279-020-01372-y`   | yes      | sprint training in football codes               |
| `10.3390/nu13082751`           | yes      | punicic acid and ferroptosis in carcinoma cells |

Every one of those would pass a resolver, and a row citing any of them would look
checked. **A resolver proves a DOI is registered. It cannot prove the paper says
what the row claims.**

## Decision

**A row carries one supplement, one claim, one evidence grade, a dose, and the
DOI of the source that backs _that_ claim.**

The dose is **prose, and CLAUDE.md #8 does not apply to it** — a correction to
the plan, which asked for "a dose range in canonical units". What the sources
actually give is "3–6 mg per kg bodyweight, 60 minutes before", "strain-specific;
a dose from one product says nothing about another", and for the D rows "no dose
is recommended". Canonicalising that means either discarding the caveats or
writing a parser for a value nothing computes with. Nothing may do arithmetic on
it; a feature that needs to should add typed columns beside it.

No row summarises a literature. If a supplement has three claims worth making, it
gets three rows and three sources. A row nobody can check is worse than an absent
row, because an absent row is honest about the gap.

### The grades

Assigned from what the cited source concludes, not from popularity.

|       | Meaning                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| **A** | A position stand or equivalent concludes the effect is established for training people.                      |
| **B** | Established, but for narrower conditions than the marketing implies — a task type, a duration, a population. |
| **C** | Mixed, limited, or real for something other than what it is sold for.                                        |
| **D** | **The evidence does not support the popular claim.**                                                         |

**D rows ship on purpose, and they are the point.** "This does not do what the
label says" is the answer a user most needs and the one a supplement table never
gives, because the tables are usually written by people selling supplements.
Three of the shipped rows are D.

### Nobody but the project may write a row

**The table ships with a read policy and no write policy at all.** Not the
catalogue pattern — `exercises`, `equipment_tags` and the rest carry a
read/write pair that lets a user author their own rows alongside the shared
ones.

Migration `20260908120100` is why. `progression_nodes` inherited that pair for a
feature that did not exist, and the hazard was not the wasted grant: the unique
constraint is `unique nulls not distinct (user_id, slug)`, so a user row can
reuse a **system** slug. Here that would put a row somebody wrote themselves
next to a position stand, under the same heading, with a grade beside it. Of
everything in this database, these are the rows where that matters most.

RLS is what refuses the write; the `authenticated` role keeps its DML grant,
because the two are independent gates — [ADR 0003](0003-grants-and-rls.md). The
pair is simply never written, so there is nothing to drop later.

_Added in review: this was argued in the migration header and the tests and was
missing from the document somebody would actually consult before building an
authoring feature._

### Sources

ISSN position stands and peer-reviewed systematic reviews. The plan also named
NIH ODS fact sheets; those carry no DOI, so where a fact sheet is the best plain-
language source the row cites the peer-reviewed work instead, and where there is
no such work the row is not written.

## The check, in three parts

The acceptance criterion needs a network call, and `verify.yml`'s unit job has no
network by design — its own comment says a change that needs one means "something
has grown a hidden dependency on the network — fix that rather than adding the
secret". `vitest.config.ts` scopes that run to `src/**` and `tests/unit/**` with
no database, and evidence rows are database content. So one criterion becomes
three checks:

|                      | Runs                   | Asserts                                                                   |
| -------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `npm test`           | anywhere, offline      | `isDoi()` — format only, no rows, no network                              |
| `npm run test:db`    | against a database     | every row's DOI is well-formed, every claim has one, every grade is legal |
| `npm run verify:doi` | its own CI job, online | each DOI resolves against the DOI Handle API                              |

The third is deliberately **not** a merge gate for changes that do not touch the
table. A registry being down is not a reason to block an unrelated PR, and a
check that blocks for reasons the author cannot fix gets disabled.

## What is NOT verified, stated plainly

**No test reads a paper.** The claims here were written against each source's
**abstract**, fetched from PubMed, plus its title, journal and year from Crossref
— not against full texts. That is more than a title match and less than a
literature review.

So the residual gap is specific: a row can cite a real paper, on the right
subject, and still characterise its conclusion more strongly than the full text
supports. Nothing in CI will catch that. It needs a person who knows the field to
read the rows against the papers, and until that has happened this table is
**demo content with citations**, not a clinical reference. The page says so where
a user can see it, not only here.

## Alternatives rejected

**Store a URL instead of a DOI.** Simpler, and it rots. A DOI is a permanent
identifier with a registry behind it; a publisher URL is a redirect somebody
else controls. The whole value of the column is that it still resolves in a year.

**Let one row cover a supplement.** "Creatine: good, 3–5 g" is what every other
supplement table does, and it is unfalsifiable — there is no single claim to
check a source against, so the citation becomes decoration.

**Grade on a numeric score.** Rejected as false precision: turning "one position
stand and two trials that disagree" into 6.5/10 invents resolution the evidence
does not have, and invites averaging scores across rows, which means nothing.

**Ship only A and B rows.** It would make the table look authoritative and would
remove its main use. Someone reaching for a supplement page is usually deciding
whether to buy something, and "no" is the most valuable answer available.

## Consequences

- `verify:doi` reaches the network, so it can fail for reasons unrelated to the
  change under test. It runs in its own job and its output is recorded.
- Adding a row means finding a source for that specific claim, which is
  deliberately more work than adding a row to a list.
- The page ships while the diet advisor stays deferred to phase 6.
  `docs/PRD.md` §5.7 is updated to say which half is which, rather than leaving
  the section describing supplements as retrieval-only coach answers.

## Amended 2026-09-09 — the rows are now reachable through a model

Phase 6 PR 5 gave these rows a second entry point: a question box on `/coach`
that returns one row. That is a model-mediated path to a health claim, which is
the thing this ADR exists to be careful about, so what it does and does not
change is worth saying here rather than only in `docs/specs/diet.md` §4b.

**Every guarantee above survives, because the model does not write anything.**
Its entire output is a slug chosen from an allowlist built out of the rows it was
shown — there is no text field in the schema. The answer rendered is the row's
own claim, grade, dose, caution and clickable citation, through the same
component the page uses. So:

- **"No row summarises a literature"** still holds: nothing new is written.
- **"A reader can check the row"** still holds: the citation is a link on both
  surfaces, and dropping it in the coach's answer would have been the paraphrase
  by another route.
- **A D-graded row survives intact.** This is the sharpest test of the shape: a
  row that says the evidence does _not_ support the popular claim is exactly what
  a fluent summary would soften, and there is no summary.

**What it adds to the does-not-guarantee list:** nothing checks that the row the
model picked answers the question asked. A wrong answer here is a wrong **row**,
rendered correctly — which is a smaller failure than an invented claim, and is
not nothing. It is recorded as a passing test in `src/diet/supplements.test.ts`
under "what retrieval does NOT stop".
