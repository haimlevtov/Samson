---
name: dependency-versioning
description: >-
  Use this skill whenever adding a new npm package or changing the version of an existing one in
  this Next.js 16 / React 19 project — any `npm install`, dependency bump or downgrade,
  `npm audit` follow-up, or a question like "are we up to date", "is it safe to add/upgrade X",
  "bump the deps", or "why is this version pinned". It encodes the 7-day publish-age rule and its
  security exception, how to choose the newest *safe* version (not just the latest, and not just
  hold-at-current), the framework compatibility envelope, the transitive-cascade trap, and the
  verification gauntlet. Do NOT use for non-dependency work (feature code, bug fixes, docs).
---

# Dependency Versioning

The one rule, stated precisely:

> **Install the NEWEST version that is BOTH (a) published ≥ 7 days ago AND (b) inside the
> compatibility envelope. Never the npm "latest" if it's younger than 7 days; never
> "hold at current" if a newer *safe* version exists.** The only override is the **security
> exception**: a known, already-disclosed advisory that the fresh version fixes outranks the floor.

The 7-day floor guards against *undiscovered* risk — a brand-new release hasn't had time for the
community to surface a supply-chain compromise or a regression. A *known, already-fixed* CVE is the
opposite kind of risk, so it wins. Everything below operationalizes those two sentences.

Samson runs no dead dependencies: every package in `package.json` must have an import somewhere in
`src/`, `app/`, `scripts/` or `tests/`. An unused dependency is pure supply-chain surface.

---

## Step 1 — Choose the target version (newest-safe, in-envelope)

```bash
npm view <pkg> time --json     # every version + its publish date
```

- **Safe** = published on or before `today − 7 days`. Compute the cutoff; don't eyeball it.
- Pick the **newest** version that is safe **and** in-envelope. Two failure modes to avoid:
  - ❌ taking npm's `latest` when it's < 7 days old;
  - ❌ holding at the *currently installed* version when a newer **safe** patch exists.
    "Up to date" means newest-safe, not status-quo.

### The compatibility envelope

| Package class | Envelope | How to check |
|---|---|---|
| **Framework core** (`next`, `react`, `react-dom`) | move together, within the majors already adopted (Next 16 / React 19) | Next's release notes pin the React range; `npm info next@<v> peerDependencies` |
| **Toolchain coupled to Next** (`eslint-config-next`, `@types/react*`, `typescript`) | track the framework bump in the same change | peerDependencies + typecheck |
| **Supabase pair** (`@supabase/supabase-js`, `@supabase/ssr`) | move together — `ssr` wraps `supabase-js` and pins a range against it | `npm info @supabase/ssr@<v> peerDependencies` |
| **Everything else** (`zod`, `tsx`, `vitest`, `eslint`, `prettier`, `fast-check`, …) | newest within the current **major**; a new major only with its migration notes read and the gauntlet green | changelog + gauntlet |

Samson has no Tailwind and no CSS framework — `app/globals.css` is hand-written,
phone-first (`docs/specs/mobile-interface.md`). A styling dependency is a new
decision, not a version bump.

---

## Step 2 — Security exception (only when the newest version is < 7 days old)

Before holding at the older safe version, check whether the fresh version fixes a **known advisory
open in the version you'd otherwise pick**:

```bash
npm audit                                  # does our tree carry an OPEN advisory?
npm view <pkg>@<old> <pkg>@<new>           # compare; read BOTH changelogs / release notes
# + GitHub Advisory DB (https://github.com/advisories) for the package
```

- Take the < 7-day version **only** for a real, already-disclosed security fix — and **record the
  GHSA/CVE id** in the commit message.
- A coordinated *routine* patch batch is **not** a security exception, even if it's large.
  Verify per-package; don't assume.

---

## Step 3 — Install, then run the transitive-cascade check (the trap)

```bash
npm install <pkg>@<exact-version>   # exact spec → lockfile pins it
```

**The trap:** bumping a **hub** package (`next` most of all) re-resolves the whole tree and
silently pulls **transitive** deps up to *their* latest — which right after a batch release is
< 7 days old. A direct `npm install` that named none of them can still introduce a 7-day breach
hiding in the lockfile.

So after **every** bump, scan the full transitive tree:

```bash
node .claude/skills/dependency-versioning/scripts/age-scan.cjs HEAD
```

For each `<7 DAYS` hit: pin the transitive to newest-safe via `package.json` → `overrides`, or
drop the hub bump that pulled it. Re-run until it reports **0 violations**.

---

## Step 4 — Verify compatibility (the gauntlet)

Each command proves a different dimension:

```bash
node .claude/skills/dependency-versioning/scripts/peer-check.cjs   # declared peers, whole tree
npm run typecheck                                                 # code↔package API still lines up
npm test                                                          # runtime on every tested path, no key required
npm run lint                                                      # lint plugins still compatible
npm run build                                                     # the app actually builds — every import resolves through
                                                                  # the bundler; catches broken exports fields tsc cannot see
```

A green gauntlet means "compatible across these layers" — undeclared incompatibilities, `any`-typed
surfaces, and untested runtime paths are still on the deploy preview to catch. Say so honestly.

**`npm audit` triage:** separate *shipped* deps from dev/build/test tooling — trace each
advisory's dependency path; only a shipped-dep advisory is a real pre-production blocker.

---

## Step 5 — Record

- The commit message carries: old → new version, publish date of the new version, one-line
  reason, and the GHSA/CVE id when the security exception was used.
- Anything **held** below npm-latest for the 7-day rule gets a revisit date (≈ today + 7) in
  the commit message, and its `overrides` pin removed when bumped later.
- A dependency change ships in its own commit, separate from the code that uses
  it. `package.json` and `package-lock.json` move together, always.

## Quick reference

```bash
npm view <pkg> time --json                                              # newest-safe target
npm install <pkg>@<version>                                             # lockfile pins it
node .claude/skills/dependency-versioning/scripts/age-scan.cjs HEAD      # must print 0 violations
node .claude/skills/dependency-versioning/scripts/peer-check.cjs && npm run verify && npm run build
```
