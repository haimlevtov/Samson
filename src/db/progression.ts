/**
 * Reading the progression trees and the sets that unlock them.
 *
 * INVARIANT: content lives in the database — CLAUDE.md #7. This file reads rows
 *            and shapes them. Whether a node is unlocked is decided by
 *            `unlockStates` in src/gamification/unlocks.ts, which is pure and
 *            unit-tested — ADR 0020.
 */
import { z } from 'zod';
import type { Db } from './client';
import { unlockCriteriaSchema, type ProgressionNode, type SlugSet } from '../gamification/unlocks';

/**
 * Every shared node, ordered so a parent always precedes its children.
 *
 * WHY `order by level` is load-bearing rather than cosmetic: `unlockStates`
 * walks the list once and reads each node's parent out of what it has already
 * seen. Reordering this read makes children evaluate before their parents and
 * silently reports them locked — an AI-NOTE on that function says so too.
 *
 * WHY parent SLUG rather than the id the row carries: the evaluator is pure and
 * has no database, so it works in the vocabulary the migration authors use. The
 * id-to-slug map is built here, once, from the same read.
 */
export async function loadProgressionTrees(db: Db): Promise<ProgressionNode[]> {
  const { data, error } = await db
    .from('progression_nodes')
    .select('id, tree, slug, name, level, parent_id, unlock_criteria, exercises (slug)')
    .is('user_id', null)
    .order('level', { ascending: true })
    .order('slug', { ascending: true });

  if (error) throw new Error(`loading progression trees: ${error.message}`);

  const rows = data ?? [];
  const slugById = new Map(rows.map((row) => [row.id, row.slug]));

  return rows.map((row) => {
    /*
     * Validated on READ as well as on write, the same call src/db/personas.ts
     * makes: jsonb hands back whatever was written, including a row written by
     * an older version of this schema. (An earlier version of this comment also
     * cited src/db/plans.ts, which has no read path at all.)
     *
     * ADR 0020: a node that fails to parse is treated as LOCKED and rendered
     * without criteria rather than throwing. A content bug must not take out a
     * page.
     */
    const parsed = unlockCriteriaSchema.safeParse(row.unlock_criteria);

    return {
      slug: row.slug,
      tree: row.tree,
      name: row.name,
      level: row.level,
      parentSlug: row.parent_id === null ? null : (slugById.get(row.parent_id) ?? null),
      exerciseSlug: row.exercises?.slug ?? null,
      // An unparseable criterion becomes one nothing can satisfy, rather than
      // `{}` — which is a ROOT and would unlock the node instead of locking it.
      criteria: parsed.success ? parsed.data : LOCKED,
    };
  });
}

/**
 * The criterion an unparseable row falls back to.
 *
 * AI-NOTE: deliberately NOT `{}`. An empty object is a root and means
 *          "always unlocked", so falling back to it would turn a malformed
 *          row into a free unlock — and, because the node keeps its real
 *          parentSlug, cascade that unlock to its children.
 *
 * FOUND IN REVIEW, 2026-09-08: this used to be a `sets_at` naming an exercise
 * slug believed impossible, and its unsatisfiability rested on ONE INVISIBLE
 * CHARACTER inside a string literal. That is not a defence — a formatter, a
 * lint autofix or an editor normalising control characters removes it, and the
 * sentinel silently becomes the word "unparseable", which any authenticated
 * session can create as an exercise slug and then satisfy.
 *
 * It also made this file BINARY to git: the diff rendered the whole reader —
 * including the tenancy filter above — as "Binary files differ". The one file
 * in the change carrying a tenancy boundary was the one nobody could review.
 * src/llm/safety.ts carries an AI-NOTE about exactly this, and it was written
 * before this file: control characters are escapes, never embedded bytes.
 *
 * The replacement is a schema VARIANT the evaluator refuses by construction,
 * so no formatter can turn it into something satisfiable.
 */
const LOCKED = unlockCriteriaSchema.parse({ kind: 'never' });

/** Rows of `sets` shaped for the evaluator, from completed workouts only. */
const setRowSchema = z.object({
  workout_id: z.string(),
  weight_kg: z.union([z.string(), z.number()]).nullable(),
  reps: z.number().nullable(),
  is_warmup: z.boolean(),
  exercise_id: z.string(),
  exercises: z.object({ slug: z.string() }).nullable(),
  workouts: z.object({ local_date: z.string(), status: z.string() }).nullable(),
});

/**
 * How many set rows the trees will read.
 *
 * INVARIANT: BELOW PostgREST's `max_rows` (1000, supabase/config.toml) on
 *            purpose — the same reasoning, and the same number, as
 *            `EXERCISE_SET_CAP` in src/db/training.ts. At or above the cap the
 *            limit is applied silently and a full page is indistinguishable
 *            from a truncated one; below it, a full page means we hit our own
 *            limit and can say so.
 */
const UNLOCK_SET_CAP = 900;

export interface UnlockSets {
  sets: SlugSet[];
  /** True when the read hit the cap, so older sessions are not represented. */
  truncated: boolean;
}

/**
 * Every set this user has logged in a COMPLETED workout, with its exercise slug.
 *
 * WHY completed only: an unlock is a claim about something the user did, and a
 * session still in progress has not been finished. It is also the same filter
 * the achievement predicates use, so the two agree about what counts.
 *
 * RLS scopes this to the caller — CLAUDE.md #10 — so there is no user_id filter
 * to forget. `workouts!inner` is scoped by RLS too: PostgREST applies policies
 * to embedded resources, so a set whose workout is invisible is dropped rather
 * than widening the result.
 *
 * WHY newest-first with an explicit order: FOUND IN REVIEW — the first version
 * had no `order` and no cap, so past `max_rows` the surviving rows were
 * unspecified and a rung could flip between locked and unlocked across two
 * page loads. Truncation fails CLOSED (a dropped set can only lower a count,
 * and `meetsCriteria` unlocks by finding sets, never by failing to), so the
 * risk is an unlock that does not appear rather than one that should not —
 * but "wrong and nondeterministic" is still wrong.
 *
 * FOUND IN REVIEW AGAIN, 2026-09-08: that fix ordered by `workout_id`, which is
 * a random uuid — so the order was stable but NOT newest-first, and the comment
 * above said otherwise. The cap kept an arbitrary 900 rows rather than the most
 * recent, which is not the fail-closed behaviour argued for: `meetsCriteria`
 * counts qualifying sets per WORKOUT, so cutting a page mid-session can drop a
 * session that satisfied a rung, and which sessions survive would change on
 * every reseed. Exactly the defect ADR 0021 is about, one file away from the
 * migration that fixes it.
 *
 * `completed_at` descending now, matching `recentSets` in src/db/training.ts —
 * the sibling reader that already had this right, for the reason its own
 * comment gives.
 *
 * WHY the warm-up filter: `meetsCriteria` discards warm-ups on the first line
 * of its loop, so they were crossing the wire and being parsed only to be
 * thrown away. MEASURED on the seeded demo — it takes the largest user from
 * 805 rows to 599 against the 900 cap, which is headroom the progression
 * accessories had otherwise spent.
 */
export async function loadUnlockSets(db: Db): Promise<UnlockSets> {
  const { data, error } = await db
    .from('sets')
    .select(
      'workout_id, weight_kg, reps, is_warmup, exercise_id, exercises (slug), workouts!inner (local_date, status)'
    )
    .eq('workouts.status', 'completed')
    .eq('is_warmup', false)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('set_index', { ascending: true })
    .limit(UNLOCK_SET_CAP);

  if (error) throw new Error(`loading unlock sets: ${error.message}`);

  const rows = data ?? [];
  const sets = rows.flatMap((row) => {
    const parsed = setRowSchema.safeParse(row);
    if (!parsed.success) return [];

    const set = parsed.data;
    const slug = set.exercises?.slug;
    if (slug === undefined || set.workouts === null) return [];

    return [
      {
        exerciseId: set.exercise_id,
        exerciseSlug: slug,
        workoutId: set.workout_id,
        // numeric arrives as a string — the convention in src/db/training.ts.
        weightKg: set.weight_kg === null ? null : Number(set.weight_kg),
        reps: set.reps,
        isWarmup: set.is_warmup,
        localDate: set.workouts.local_date,
      },
    ];
  });

  return { sets, truncated: rows.length >= UNLOCK_SET_CAP };
}
