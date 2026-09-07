/**
 * Progression — one lift's heaviest working set, session by session.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Every point on the
 *            chart is arithmetic over logged sets.
 *
 * Design and reasoning: ADR 0014. The short version is that this plots the
 * weight the user CHOSE rather than the 1RM the app inferred, because a
 * progression chart is read to answer "am I getting stronger" and a figure
 * nobody can tie to a session they did is the fastest way to lose that answer.
 *
 * Pure over plain shapes, like the rest of `src/metrics/` — no database, no
 * clock, no DOM. The component takes points and draws them.
 */
import { compareDates } from './dates';
import type { LocalDate, SetRecord } from './types';

export interface ProgressionPoint {
  localDate: LocalDate;
  /** The heaviest working set that day, in kilograms. */
  weightKg: number;
  /** Reps at that weight. Null when the set recorded none. */
  reps: number | null;
}

/**
 * A set is worth plotting only if it says something about strength.
 *
 * WHY warmups are excluded: the same reason `exerciseBests` excludes them. A
 * 20 kg warm-up is not a data point about how strong somebody is, and one of
 * them on the chart flattens the axis for everything else.
 *
 * WHY a null weight is excluded rather than plotted as zero: bodyweight
 * movements genuinely have no external load (`src/metrics/types.ts`), and a
 * zero would be a claim. ADR 0014 — inventing a bodyweight figure would rewrite
 * the user's history every time their weight changed.
 *
 * AI-NOTE: a type predicate rather than a boolean, so the compiler carries the
 *          null check into the caller. As a plain `boolean` this narrowed
 *          nothing and the caller needed `as number` — which would have kept
 *          compiling if this function ever stopped checking.
 */
function plottable(set: SetRecord): set is SetRecord & { weightKg: number } {
  if (set.isWarmup) return false;
  return set.weightKg !== null && set.weightKg > 0;
}

/**
 * The heaviest working set of `exerciseId` on each day it was trained, oldest
 * first.
 *
 * One point per DAY rather than per workout row: `workouts` has no unique
 * constraint on `(user_id, local_date)`, so two sessions in one afternoon would
 * otherwise put two points on the same x position — the same reasoning that
 * made `sessions` count distinct days in the challenge spec.
 *
 * AI-NOTE: ties on weight keep the set with the MOST reps, because 80×8 is a
 *          better day than 80×3 and the chart should not flip between them on
 *          array order. Without this the label under a point could change
 *          between renders while the line stayed still.
 */
export function exerciseProgression(
  sets: readonly SetRecord[],
  exerciseId: string
): ProgressionPoint[] {
  const best = new Map<LocalDate, ProgressionPoint>();

  for (const set of sets) {
    if (set.exerciseId !== exerciseId || !plottable(set)) continue;

    const weightKg = set.weightKg;
    const current = best.get(set.localDate);

    if (
      current === undefined ||
      weightKg > current.weightKg ||
      (weightKg === current.weightKg && (set.reps ?? 0) > (current.reps ?? 0))
    ) {
      best.set(set.localDate, { localDate: set.localDate, weightKg, reps: set.reps });
    }
  }

  return [...best.values()].sort((a, b) => compareDates(a.localDate, b.localDate));
}

export interface ProgressionRange {
  min: number;
  max: number;
}

/**
 * The weight range a chart should cover.
 *
 * WHY it is not simply `[min, max]` of the data: a lift that has sat at 100 kg
 * for six sessions has min === max, and a chart drawn on a zero-height axis
 * either divides by zero or draws every point on top of the others. Padding it
 * gives a flat line down the middle, which is the honest picture of a plateau.
 *
 * WHY the axis does not start at zero: this is a change chart, not a magnitude
 * chart. Anchoring at zero on a 100 kg squat compresses a 10 kg improvement into
 * a tenth of the height and makes real progress invisible, which is the failure
 * this whole feature exists to avoid.
 */
export function progressionRange(points: readonly ProgressionPoint[]): ProgressionRange {
  if (points.length === 0) return { min: 0, max: 1 };

  const weights = points.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);

  if (min === max) {
    // A tenth either side, and never below zero — a 5 kg lift must not get a
    // negative floor.
    const pad = Math.max(1, min * 0.1);
    return { min: Math.max(0, min - pad), max: min + pad };
  }

  return { min, max };
}

/**
 * How far the top set has moved across the whole history, in kilograms.
 *
 * INVARIANT: this lives here and not in the chart component — ADR 0014 says
 *            the shaping is in `src/metrics/` and the component draws what it
 *            is given, and CLAUDE.md #1 says a number a user reads is
 *            deterministic code with tests. "+22.5 kg" is the headline figure
 *            on that page; computing it in JSX is how it ended up as the one
 *            number on the screen with no test behind it.
 *
 * Null for fewer than two points: one session is a reading, and a change needs
 * something to have changed from.
 *
 * AI-NOTE: rounded to one decimal because plate maths produces values like
 *          22.499999999999996. The rounding is part of the contract, not a
 *          formatting detail the caller may redo differently.
 */
export function progressionChange(points: readonly ProgressionPoint[]): number | null {
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;

  return Number((last.weightKg - first.weightKg).toFixed(1));
}

/**
 * How many sessions a chart can show before it stops being readable.
 *
 * MEASURED, not guessed: the viewBox is 320 units wide with 10 either side, so
 * 300 units of axis, and a dot is 6 across. Past 50 points the circles overlap
 * into a solid band and the line stops being a line. The table under it is the
 * heavier cost — each row is a card on a phone, roughly 60px, so 50 sessions is
 * already 3,000px of scroll.
 */
export const MAX_PLOTTED_SESSIONS = 50;

export interface ProgressionView {
  points: ProgressionPoint[];
  /** Sessions that exist but are not shown, whether trimmed here or unread. */
  hidden: number;
}

/**
 * The most recent sessions, trimmed to what a chart can honestly draw.
 *
 * `readTruncated` says the caller's query hit its own row cap, which means two
 * things: older sessions exist beyond what was read, and — because a set cap
 * can cut mid-session — the OLDEST day present may be missing its heavier sets.
 * That day is dropped rather than plotted as a dip the user never trained.
 *
 * AI-NOTE: `hidden` is deliberately "at least this many" when readTruncated is
 *          set, because the query cannot know how much history it did not read.
 *          The surface must word it as "older sessions", never as a count.
 */
export function progressionView(
  points: readonly ProgressionPoint[],
  readTruncated = false
): ProgressionView {
  const trustworthy = readTruncated && points.length > 0 ? points.slice(1) : [...points];

  if (trustworthy.length <= MAX_PLOTTED_SESSIONS) {
    return { points: trustworthy, hidden: points.length - trustworthy.length };
  }

  return {
    points: trustworthy.slice(-MAX_PLOTTED_SESSIONS),
    hidden: points.length - MAX_PLOTTED_SESSIONS,
  };
}
