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
 *
 * AI-NOTE: this figure is 300/49. It is tied to the axis width, so anything
 *          that eats into the padding has to move it. A draft of the label work
 *          took 34 units for an axis gutter and left this at 50, which put the
 *          spacing at 5.4 against a 6-unit dot — the solid band the cap exists
 *          to prevent, arrived at by a change nowhere near this line.
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

/**
 * Why a point carries a label, which is also what the label is FOR.
 *
 * AI-NOTE: LiftChart renders this into a class name, so a fourth kind needs a
 *          matching `.lift-chart-value.is-<kind>` rule in app/globals.css
 *          setting `--lift-label-x`. Nothing in TypeScript will tell you: it
 *          compiles, lints and renders, and the label lands on its own dot.
 */
export type LabelKind = 'first' | 'last' | 'heaviest';

/**
 * Which side of its point a label sits on — the side the LINE is not on.
 *
 * FOUND IN THE BROWSER, not by reading the code: with every end label printed
 * below its point, a rising history put "127.5 kg × 5" straight through the
 * polyline and the three dots before it. The line leaves the first point and
 * arrives at the last one from a direction the data knows, so which side is
 * free is a fact about the data rather than a constant.
 */
export type LabelSide = 'above' | 'below';

export interface ProgressionLabel {
  kind: LabelKind;
  side: LabelSide;
  /** Index into the same array that was passed in, so the caller can place it. */
  index: number;
  point: ProgressionPoint;
}

/**
 * Roughly how much of the AXIS one label occupies.
 *
 * MEASURED at the width this app is built for: "82.5 kg × 5" is about 70px at
 * 375px, where the axis is 266 of 320 viewBox units and so about 267px. 70/267
 * is a touch over a quarter.
 *
 * _An earlier version of this file put it at 21% by dividing by the whole chart
 * width rather than by the axis, and then used a smaller number still as the
 * "clear air" needed between two labels — which does not follow from it either
 * way: two boxes a quarter of the axis wide touch when their centres are a
 * quarter apart, not less._
 */
export const LABEL_WIDTH_FRACTION = 0.26;

/**
 * How much of the VALUE RANGE a label's row occupies, so two labels this close
 * in weight are on the same line of text.
 *
 * MEASURED the same way: a label plus its 8px offset is about 22px, and the
 * plot area is 96 of 140 viewBox units — about 96px at 375px.
 */
export const LABEL_ROW_FRACTION = 0.23;

/**
 * How close to an end of the axis the heaviest point may sit before its label
 * is dropped, as a fraction of the axis.
 *
 * WHY this exists, and it is NOT what stops labels overlapping: the heaviest
 * label is CENTRED on its point, so it needs half its own width of axis on
 * either side or it hangs outside the plot. Half of `LABEL_WIDTH_FRACTION` is
 * 0.13; this is that with a margin.
 */
export const MIN_LABEL_GAP = 0.18;

/**
 * The points that get a number printed next to them — ADR 0014's amendment.
 *
 * Three at most: where the line starts, where it ends, and where it peaked.
 * Twelve collide at 375px, which is why the original decision put every reading
 * in the table instead; three do not, PROVIDED the third is checked against the
 * other two rather than assumed to be somewhere else.
 *
 * INVARIANT: the shaping is here and the component draws it — ADR 0014. The
 *            collision rule especially: a label that silently overlaps another
 *            is a rendering bug with no failing test anywhere, and this is the
 *            only place it can be asserted without a browser.
 *
 * AI-NOTE: ties on the heaviest weight take the EARLIEST session. The
 *          interesting fact about a repeated best is when it was first reached,
 *          and picking the latest would make the label jump backwards along the
 *          chart the day somebody repeats it.
 */
export function progressionLabels(points: readonly ProgressionPoint[]): ProgressionLabel[] {
  // One point is printed as a sentence, not a chart — ADR 0014, amended.
  if (points.length < 2) return [];

  const lastIndex = points.length - 1;

  /*
   * The line leaves the first point heading for the second, and arrives at the
   * last one from the second-to-last. A RISING first segment puts the line
   * above and to the right of the first point, so its label goes below; a
   * rising LAST segment puts the line below and to the left of the last point,
   * so its label goes above. Falling reverses both.
   *
   * Equal weights count as rising, arbitrarily but not carelessly: a flat
   * segment is horizontal, so neither side is clearer, and picking one keeps
   * the two ends on opposite sides instead of stacking them on the same row.
   */
  const risingFromStart = points[1]!.weightKg >= points[0]!.weightKg;
  const risingIntoEnd = points[lastIndex]!.weightKg >= points[lastIndex - 1]!.weightKg;

  const labels: ProgressionLabel[] = [
    { kind: 'first', side: risingFromStart ? 'below' : 'above', index: 0, point: points[0]! },
    {
      kind: 'last',
      side: risingIntoEnd ? 'above' : 'below',
      index: lastIndex,
      point: points[lastIndex]!,
    },
  ];

  let heaviest = 0;
  for (let i = 1; i < points.length; i += 1) {
    // Strictly greater, so a tie leaves `heaviest` on the earlier session.
    if (points[i]!.weightKg > points[heaviest]!.weightKg) heaviest = i;
  }

  /*
   * Where along the axis it sits: x is `index / lastIndex`, the same fraction
   * the component positions by. Duplicated as arithmetic rather than shared as
   * a constant because the component's version carries padding and a viewBox,
   * and neither belongs in `src/metrics/`.
   *
   * FOUND BY BREAKING IT: this used to be preceded by an explicit
   * `heaviest === 0 || heaviest === lastIndex` check, and deleting that check
   * turned no test red. It could not: an end point is at 0 or 1 of the axis,
   * which is outside ANY positive gap, so the branch was unreachable. The
   * common case — a run that peaks on its last session — is handled here.
   */
  const at = heaviest / lastIndex;
  if (at < MIN_LABEL_GAP || at > 1 - MIN_LABEL_GAP) return labels;

  /*
   * And the collision check, which is two-dimensional because the collision is.
   *
   * FOUND IN REVIEW. The claim was that putting the heaviest above its point
   * and the ends below theirs guarantees separation. It does not, because an
   * end label is only below when the line falls into it — a RISING history puts
   * the last label above its point too, on the same side as the heaviest. Two
   * labels on that side collide when they are close along the axis AND close in
   * weight, and a peak a kilogram above the final session is exactly that.
   *
   * A label is centred on the heaviest and pinned to the outside edge at an
   * end, so the end's centre sits half a label width inboard.
   */
  const spread = points[heaviest]!.weightKg - Math.min(...points.map((p) => p.weightKg));

  for (const end of labels) {
    if (end.side !== 'above') continue;

    const endCentre =
      end.kind === 'first' ? LABEL_WIDTH_FRACTION / 2 : 1 - LABEL_WIDTH_FRACTION / 2;
    const sameRow =
      spread === 0 ||
      (points[heaviest]!.weightKg - end.point.weightKg) / spread < LABEL_ROW_FRACTION;

    if (Math.abs(at - endCentre) < LABEL_WIDTH_FRACTION && sameRow) return labels;
  }

  // Above its point: it is the topmost, so nothing of the line is drawn over it.
  labels.push({ kind: 'heaviest', side: 'above', index: heaviest, point: points[heaviest]! });
  return labels;
}

/**
 * The weights printed against the axis — the extremes of the history that no
 * label already prints, heaviest first.
 *
 * INVARIANT: these come from the DATA, never from `progressionRange`. That
 *            function pads a flat history so the line has somewhere to sit, and
 *            printing the padded bound would put "110 kg" on the axis of a
 *            chart belonging to somebody who has only ever lifted 100.
 *
 * **Usually there are none, and that is the point.** On a history that only
 * rises, the first and last points ARE the extremes, so their labels already
 * carry both numbers with the reps attached — an axis repeating them is two
 * more figures saying what the chart just said. A tick appears exactly where
 * the labels leave a gap: the trough of a deload, or a peak whose label was
 * dropped for crowding another.
 *
 * _This began as "always the max and the min in a left gutter". The gutter cost
 * 11% of the axis on every chart, was still too narrow for "142.5 kg" at 320px,
 * and on the commonest shape of all it spent that width printing the two
 * numbers already on screen._
 *
 * AI-NOTE: weights, not positions. The caller owns the geometry that turns a
 *          weight into a height, and it is the SAME function that places the
 *          line — so a tick cannot drift away from the height it names.
 */
export function progressionTicks(points: readonly ProgressionPoint[]): number[] {
  if (points.length === 0) return [];

  const weights = points.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);

  const printed = new Set(progressionLabels(points).map((label) => label.point.weightKg));
  const extremes = min === max ? [min] : [max, min];

  return extremes.filter((weight) => !printed.has(weight));
}
