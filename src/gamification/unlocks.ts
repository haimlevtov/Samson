/**
 * What a progression tree has unlocked.
 *
 * Contract: docs/adr/0020-progression-unlock-criteria.md.
 *
 * INVARIANT: `unlock_criteria` is DATA, interpreted here, and there is no code
 *            path anywhere that executes it — ADR 0020. The alternative was SQL
 *            text in a column like `achievements.predicate`, which works and
 *            which ADR 0009 §3 spends a page containing: `progression_nodes`
 *            carries the same catalogue write policy, so a user can own a row,
 *            and executing one would be privilege escalation available to
 *            anyone who can sign up. A structured criterion has no execution
 *            semantics to defend.
 *
 * INVARIANT: deterministic code decides this, never a model — CLAUDE.md #1.
 *
 * WHY the file is not called progression.ts: `src/metrics/progression.ts`
 * already exists and means how heavy a lift has become over time (ADR 0014).
 * ADR 0018 noted "progression" was becoming overloaded here; this is the change
 * that would have overloaded it. The content is a progression tree; this file
 * answers what is unlocked.
 */
import { z } from 'zod';
import type { SetRecord } from '../metrics/types';

/**
 * One criterion, or `{}` for a root.
 *
 * WHY Zod and not a hand-written guard: the project's convention is that a Zod
 * schema is the single source of truth and TypeScript types derive from it. It
 * also means a row written by an older version of this schema fails to parse
 * rather than being half-understood.
 *
 * AI-NOTE: adding a KIND is a schema variant, an evaluator branch and a test —
 *          deliberately more work than adding a node, which is one row. Content
 *          should be cheap; vocabulary should not.
 */
export const unlockCriteriaSchema = z.union([
  /** A root. Nothing to meet, so it starts unlocked. */
  z.strictObject({}),
  /**
   * Never met, whatever the history.
   *
   * WHY it exists: `src/db/progression.ts` needs something to fall back to when
   * a row's jsonb does not parse, and it must NOT be `{}` — an empty object is
   * a root, so falling back to it would unlock the malformed node and cascade
   * to its children. Failing open on exactly the input nobody understood.
   *
   * FOUND IN REVIEW, 2026-09-08: the first version of that fallback was a
   * `sets_at` naming an exercise slug thought to be impossible. Its
   * unsatisfiability rested on one invisible character in a string literal —
   * strip it with a formatter and the sentinel becomes the plain word
   * "unparseable", which any authenticated user can create as an exercise slug
   * and then satisfy. A variant the evaluator refuses by construction cannot be
   * edited away by a whitespace tool.
   */
  z.strictObject({ kind: z.literal('never') }),
  z.strictObject({
    kind: z.literal('sets_at'),
    /**
     * A catalogue SLUG, never a UUID. Ids differ between a local stack, CI's
     * fresh stack and hosted, so a criterion carrying one would be correct in
     * exactly one environment.
     */
    exercise: z.string().min(1).max(120),
    sets: z.number().int().min(1).max(20),
    reps: z.number().int().min(1).max(100),
    /**
     * Optional floor. A bodyweight node leaves it OUT rather than setting zero.
     *
     * FOUND IN REVIEW: this was `.min(0).nullish()`, which accepted both `0`
     * and `null` while the skill's prose said to omit it — and the two
     * misbehaved quietly. `weight_kg: 0` makes `meetsCriteria` demand a
     * RECORDED weight, so a bodyweight set carrying `null` fails the node,
     * while the page's truthiness check hides the floor from the user. An
     * unsatisfiable requirement nobody could see.
     *
     * `.positive().optional()` puts the rule in the schema, which CLAUDE.md
     * makes the single source of truth, instead of in a sentence beside it.
     */
    weight_kg: z.number().positive().max(500).optional(),
  }),
]);

export type UnlockCriteria = z.infer<typeof unlockCriteriaSchema>;

/** A node as the evaluator needs it. Rows are read by src/db/progression.ts. */
export interface ProgressionNode {
  slug: string;
  tree: string;
  name: string;
  level: number;
  parentSlug: string | null;
  /** The catalogue slug this node IS, where it has one. */
  exerciseSlug: string | null;
  criteria: UnlockCriteria;
}

/**
 * A logged set with the two things `SetRecord` does not carry.
 *
 * WHY both are added here rather than widened into `SetRecord`: the metrics
 * engine deliberately identifies an exercise by id and does not care which
 * workout a set came from — tonnage and adherence are sums over days. This is
 * the one reader that needs the session boundary and the catalogue slug, so it
 * asks for them rather than making every other caller carry them.
 */
export interface SlugSet extends SetRecord {
  exerciseSlug: string;
  /** The session a set belongs to. Criteria are "within one workout". */
  workoutId: string;
}

/**
 * Whether one criterion is met.
 *
 * WHY "within one workout" rather than across all history: three sets of ten is
 * a session, not a lifetime total. Spread over six months it says nothing about
 * whether the next step is reachable, which is the only question a progression
 * tree asks.
 */
export function meetsCriteria(criteria: UnlockCriteria, sets: readonly SlugSet[]): boolean {
  // A root has nothing to meet.
  if (!('kind' in criteria)) return true;
  // And `never` is met by nothing, by construction rather than by arithmetic.
  if (criteria.kind === 'never') return false;

  const qualifying = new Map<string, number>();

  for (const set of sets) {
    if (set.isWarmup) continue;
    if (set.exerciseSlug !== criteria.exercise) continue;
    if (set.reps === null || set.reps < criteria.reps) continue;

    // A weight floor is only applied when the criterion names one, so a
    // bodyweight node is not locked out by a null weight — the same call
    // src/metrics/tonnage.ts makes, for the same reason.
    //
    // FOUND IN REVIEW: `Number.isFinite` rather than a null check. Postgres
    // `numeric` accepts NaN and `NaN >= 0` is TRUE there, so the column's CHECK
    // admits it — and in JavaScript `NaN < 20` is false, so a NaN weight
    // SATISFIED the floor. The same class of bug as the tonnage comparison
    // table's own CHECK, found the same day.
    if (criteria.weight_kg !== undefined) {
      if (!Number.isFinite(set.weightKg) || (set.weightKg ?? 0) < criteria.weight_kg) continue;
    }

    // Keyed by the workout, because the sets have to be from one session.
    const count = (qualifying.get(set.workoutId) ?? 0) + 1;
    if (count >= criteria.sets) return true;
    qualifying.set(set.workoutId, count);
  }

  return false;
}

export interface UnlockState {
  node: ProgressionNode;
  /** Its own criteria are met. Says nothing about the parent. */
  met: boolean;
  /** Met, and every ancestor is unlocked too. This is what the surface shows. */
  unlocked: boolean;
  /** The first locked node whose parent IS unlocked — what to work on. */
  next: boolean;
}

/**
 * Walks a tree and says what is unlocked, in the order given.
 *
 * A node is unlocked when its own criteria are met AND its parent is unlocked.
 * That is what makes this a tree rather than a checklist: clearing the top of
 * the ladder by accident does not skip the rungs below it.
 *
 * AI-NOTE: nodes are processed parent-before-child, which the caller guarantees
 *          by ordering on `level`. A child whose parent has not been seen is
 *          treated as locked rather than assumed — a cycle or a bad `level`
 *          then shows as an unreachable node instead of an infinite loop, and
 *          tests/db asserts neither exists in the shipped rows.
 */
export function unlockStates(
  nodes: readonly ProgressionNode[],
  sets: readonly SlugSet[]
): UnlockState[] {
  const unlockedBySlug = new Map<string, boolean>();
  const states: UnlockState[] = [];

  for (const node of nodes) {
    const met = meetsCriteria(node.criteria, sets);
    const parentUnlocked =
      node.parentSlug === null || (unlockedBySlug.get(node.parentSlug) ?? false);
    const unlocked = met && parentUnlocked;

    unlockedBySlug.set(node.slug, unlocked);
    states.push({ node, met, unlocked, next: !unlocked && parentUnlocked });
  }

  return states;
}
