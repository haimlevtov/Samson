# ADR 0018 — The heaviest thing you have passed, not the one that divides best

**Status:** accepted, phase 5
**Date:** 2026-09-08

> **Written after the code, at a reviewer's prompting — the second time in this
> phase.** PR 2's outcome recorded the same lesson four days' work earlier: "the
> decision itself was missing its ADR. The reasoning lived in a migration
> header." This one lived in four places, all written with or after the code —
> a migration header, a TSDoc block, a commit message and a plan outcome — and
> none of them in `docs/adr/`.
>
> The defence used for [ADR 0017](0017-held-hidden-achievements.md) does not
> apply here. That decision was at least recorded in the plan before the code;
> this plan's PR 3 section states the chosen rule and never mentions the
> alternative, so the rejection was made at the keyboard.

## Context

`totalTonnage` has been on Profile since phase 1 as a bare figure: **39,480 kg
all time**. It is correct, it is the largest number on the page, and nobody has
any intuition for it. `docs/PRD.md` §5.2 calls that surface Insight; a number
nobody can picture is not insight.

Phase 5's brief asks for "cumulative-tonnage comparisons (bus, elephant,
whale)". The objects are content and live in `tonnage_comparisons` — CLAUDE.md
#7. What needed deciding is the rule for choosing one, because there is more
than one defensible rule and they produce different sentences from the same
number.

## Decision

**Pick the heaviest object the user has actually passed, and report how many.**
`compareTonnage(totalKg, objects)` in `src/metrics/comparisons.ts` — pure,
deterministic, unit- and property-tested, under the metrics coverage gate.

At 39,480 kg that is one humpback whale. At 240,000 kg it is one Statue of
Liberty. At 3,000,000 kg it is one fuelled Saturn V.

## Alternatives rejected

**Closest-fitting — whichever object divides most neatly.** This is the obvious
rule and it is arithmetically better: it minimises the remainder every time.
Rejected because the sentence has to shrink as the user grows, and this one
grows with them. At 3,000,000 kg the closest fit is **666,666 domestic cats**.
That is a true statement, it is a more precise statement than the one shipped,
and it is a bare number wearing a costume — which is the exact failure the
feature exists to fix. Precision was the wrong objective; legibility is the
objective.

The consequence is designed into the content rather than the code: the ladder's
steps are checked by `tests/db/comparisons.test.ts` to be no more than twentyfold,
because the largest count a user can ever be shown at a rung is the ratio to the
next one up.

**Show a fraction below the lightest object.** Rejected. `compareTonnage`
returns null under 4.5 kg and Profile renders nothing. "About half a cat" is
both wrong — it is not about half a cat, it is exactly some cats — and a strange
thing to tell somebody three sets into their first session. An absent sentence
is better than a demoralising one.

**Pluralise in code, and store one noun per row.** Rejected. "a double-decker
bus" and "the Statue of Liberty" do not take the same article, and
"rhinoceroses" is not a suffix rule. Every pluraliser is a table of exceptions
eventually, and this one would be a table of exceptions in code sitting next to
a table of content in the database. Each row authors its own `singular` and
`plural`; `comparisonPhrase` picks between two authored strings and does no
grammar.

**Stop the ladder at something reachable.** Rejected, and this is the one that
looks like over-engineering until you run it. A ladder topping out at the
elephant tells somebody at 240,000 kg that they have lifted forty elephants. The
top two rows exist so that a user five years in still gets a small number.

## Consequences

- A new object is a migration, not a code change — which is the point, and which
  means the ladder can be tuned without a deploy of anything but SQL.
- `source_note` on every row carries the range its figure stands in for, and the
  migration states in an `AI-NOTE` that it is **not** a citation. The supplement
  evidence table is where a claim needs a resolvable DOI; a whale being twenty
  tonnes out changes a joke.
- The count is never clamped. `massKg <= totalKg` is the filter, so the quotient
  cannot round below 1 — asserted as a generated property rather than defended
  with a branch no test could reach, which would make the coverage gate on
  `src/metrics` quietly stop meaning anything.

## Related

- [ADR 0014](0014-exercise-progression-chart.md) — the same shape of decision
  (which number to put on a user-facing surface, with a named rejected
  alternative), and the precedent that says this one is ADR-sized.
- [ADR 0002](0002-catalogue-user-id.md) — the shared-content policy pattern, and
  the amendment recording why this table drops its write half.
- `docs/plans/phase-5-content-fill.md` — PR 3, and its outcome.
