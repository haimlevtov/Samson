# ADR 0019 — A banned phrase matches whole words, and its plural

**Status:** accepted, phase 5
**Date:** 2026-09-08

> **The third ADR in this phase written after its code, at a reviewer's
> prompting.** [ADR 0017](0017-held-hidden-achievements.md) and
> [ADR 0018](0018-tonnage-comparisons.md) both carry the same admission, and
> 0018's preamble names the failure exactly: the reasoning "lived in four
> places — a migration header, a TSDoc block, a commit message and a plan
> outcome — and none of them in `docs/adr/`."
>
> That is precisely where this decision lived, one PR later. Three times is not
> an accident; it is a habit, and the way to break it is to notice that
> "changing how a check behaves" is a decision even when the change is four
> lines. Recorded in `docs/plans/phase-5-content-fill.md` as a lesson of the
> phase rather than only as a fix.

## Context

`personas.banned_phrases` is a `text[]` on every persona row. `deliverPlan`
checks the delivered prose against it and retries on a hit; after
`MAX_DELIVERY_ATTEMPTS` it throws, and **there is no fallback** — ADR 0006 says
a delivery that fails the guard is one the user must not be shown, because they
cannot tell a quoted number from an invented one.

So this matcher has two failure directions and they cost different things:

- **Too broad** — a legitimate delivery is rejected. The user gets an error
  instead of the plan the critic already approved. Costs a session.
- **Too narrow** — a phrase the row forbids reaches the user. Costs whatever
  the phrase does.

It was `String.includes` from phase 3 until 2026-09-08. That is the broad
failure, and it was live: the Rival has banned `weak` since phase 3, so it also
banned **weakness**, and "your weakness is the lockout" is ordinary coaching
language.

`src/llm/safety.ts` had already reasoned its way to this exact conclusion for
the general scanner, and written it into an AI-NOTE: "`fat` and `weak` are
ordinary coaching vocabulary — body fat percentage, a weak point in a lift",
which is why `DEMEANING` matches second-person constructions rather than bare
words. The lesson was in the repository. The persona layer had not applied it.

## Decision

**A phrase matches as whole words, plus its plural, after both sides are
normalised.** `phraseUsed` in `src/persona/deliver.ts`.

Normalisation lowercases, strips invisible characters, and collapses every run
of punctuation and whitespace to one space — on the phrase and on the prose.
Matching is then a word-boundary regex with an optional `s`/`es`.

Three bypasses close together because both sides are normalised rather than one:

| Emitted                                           | Banned entry          | Before            | After   |
| ------------------------------------------------- | --------------------- | ----------------- | ------- |
| `no pain, no gain`                                | `no pain no gain`     | passed            | blocked |
| `qui<U+200B>tter`                                 | `quitter`             | passed            | blocked |
| `QUITTER` (via a caller that forgot to lowercase) | `quitter`             | passed            | blocked |
| `weakness`                                        | `weak`                | blocked (wrongly) | passes  |
| `quitters`, `princesses`                          | `quitter`, `princess` | blocked           | blocked |

The comma case is the one worth dwelling on: **every persona bans
`no pain no gain`**, it is the phrase `docs/FRAMING.md` grounds in the user's
body being a stakeholder that cannot complain, and it did not fire on its own
canonical form.

## Alternatives rejected

**Keep substring matching and write the rows around it.** This is what the
first draft did — the Sergeant's list was authored to avoid `fat` (which would
ban "fatigue") and `soft` (which would ban "soften"). Rejected because it makes
every future author responsible for a quirk of the matcher rather than for
their content, and because the trap is invisible: nothing fails at authoring
time, and the cost lands on a user months later as an error page.

**Match with a stemmer.** Rejected as far too much machinery for a list of
about a dozen phrases per row, and because a stemmer's failures are harder to
predict than a plural's. `weak` and `weakness` share a stem, and the whole
point is that they must not share a verdict.

**Allow any inflection with a suffix pattern.** Rejected for the same reason in
the other direction: `weak\w*` catches "weakness", which is the bug.

## Consequences

- **A phrase covers itself and its plural, and nothing else.** `weak` does not
  catch "weakling" or "weakly". A list that wants another inflection lists it —
  which the Rival's and the Sergeant's rows now do for `weakling`, in migration
  `20260908110100`.
- **The gap that closed is real and was measured**, not assumed: before the
  plural was added, `quitters` and `princesses` both escaped lists banning the
  singulars, and plural is the natural register for barracks idiom.
- **`scanOutput` does not backstop these.** It matches "you are" plus an
  optional intensifier and article, then a fixed adjective list — and
  "weakling" is not on that list, so **"you are a weakling" passes it**. The
  only thing between that sentence and a user is the Rival's and the Sergeant's
  `banned_phrases`, which both carry `weakling` as of migration
  `20260908110100`. Named here because the persona migration's comment claims
  `banned_phrases` covers what that construction misses, and a claim like that
  has to be true.

  Growing the adversarial suite for this ADR found a second gap in the same
  pattern and fixed it: `DEMEANING` consumed `such a ` in its intensifier group
  while its noun alternatives carried their own article, so **"you are such a
  failure" did not match** while the plain "you are a failure" did. The article
  is now one optional group and the nouns are bare. `src/llm/safety.test.ts`
  keeps both forms, and keeps "you are a weakling" as a **recorded gap** — a
  passing assertion there means a known hole, not a success, per that file's
  own AI-NOTE.

- Authoring guidance moved into `.claude/skills/add-persona/SKILL.md` §3: prefer
  the shortest unambiguous fragment, because a whole sentence only matches that
  sentence and a model has a hundred ways to write one.

## Related

- [ADR 0005](0005-llm-safety.md) §3 — layers 1, 2 and 4 are what hold; a prompt
  is never the control. `banned_phrases` is a per-persona addition to layer 4.
- [ADR 0006](0006-persona-boundary.md) — why a failed delivery has no fallback,
  which is what makes the too-broad direction expensive.
- `docs/specs/xp-and-challenges.md` — the same "two implementations of one
  rule" problem, in the plausibility checks.
