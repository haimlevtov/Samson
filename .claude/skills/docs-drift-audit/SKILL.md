---
name: docs-drift-audit
description: >-
  Full-repo docs-drift audit — fan out parallel read-only subagents, one per doc↔code domain,
  to find where the canonical maps/docs have drifted from the code, re-verify every finding,
  then fix the DOC side. Use when the user asks to audit the docs, check the maps for
  staleness, or run a drift audit. NOT for diff-scoped doc coupling (that's
  docs-sync-reviewer's job on a PR/commit) and NOT for reviewing code quality (/cleanup).
---

Run the full-repo docs-drift audit. The runbook is `.ssdd/drift-audit.md` — read it and follow
it exactly; this skill is the invocation surface, the runbook is the procedure.

Prizma-specific domain list for Phase 1 (derive the rest from CLAUDE.md → Documentation Map):

1. `docs/maps/data-map.md` vs `supabase/migrations/` + `src/lib/db/` + page data calls
2. `docs/maps/flows-map.md` vs `src/lib/ingest/pipeline.ts` + `src/app/api/` + `vercel.json` +
   `.github/workflows/` + `scripts/`
3. `docs/maps/secrets-map.md` + `.env.example` vs a repo-wide `process.env` grep
4. `docs/maps/ai-surface-map.md` vs `src/lib/ai/` + model constants in `src/lib/constants.ts`
5. `README.md` (features, scripts, endpoints, runbook claims) vs code
6. `.interface-design/system.md` component inventory vs `src/components/`
7. Spec supersession integrity: `docs/superpowers/specs/*` claims vs current constants/code —
   a changed decision with no supersession note is drift
8. `docs/pre-launch-requirements.md` — done-rows still true, deferred items still open
9. Public honesty surfaces: `/method`, `/terms`, `/sources` copy vs the code they describe
   (counts, thresholds, blinding claims, storage claims) — Prizma's highest-stakes drift class

Ground rules (from the runbook): file evidence only — no live-network/DB verdicts, mark those
`🔍 needs live check`; re-verify every finding against source before fixing; fix the DOC side
only; counts come from command output run in this session.
