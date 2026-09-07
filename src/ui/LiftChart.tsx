import type { ProgressionPoint } from '../metrics/progression';
import { progressionChange, progressionRange } from '../metrics/progression';
import { displayDate } from './format';

/**
 * One lift's heaviest working set over time — ADR 0014.
 *
 * Inline SVG, deliberately: this would be the project's first charting
 * dependency, for one sparkline. Drawing it by hand also means it themes for
 * free, because `stroke` and `fill` take the same CSS custom properties as
 * everything else and follow light, dark and system without being told.
 *
 * A server component. It receives points and draws them; the shaping is
 * `src/metrics/progression.ts`, where it is testable without a browser.
 */

/** viewBox units. The SVG scales to its container; these are just a grid. */
const W = 320;
const H = 140;
const PAD_X = 10;
const PAD_TOP = 18;
const PAD_BOTTOM = 26;

/*
 * AI-NOTE: there is deliberately no `unit` prop. Nothing in this project
 *          converts anything — every screen is kilograms and invariant #8 says
 *          conversion happens at display when it exists. A unit knob with no
 *          conversion behind it can only relabel canonical kilograms as pounds,
 *          which is worse than not offering it.
 */
export function LiftChart({
  points,
  hidden = 0,
}: {
  points: ProgressionPoint[];
  /** Sessions that exist and are not drawn. See progressionView. */
  hidden?: number;
}) {
  if (points.length === 0) {
    return (
      <p className="card muted">
        Nothing to plot yet. This chart shows your heaviest working set each time you trained this
        lift — warm-ups and bodyweight movements are left off, so a session of either does not
        appear.
      </p>
    );
  }

  const range = progressionRange(points);
  const span = range.max - range.min;

  /*
   * AI-NOTE: x() divides by points.length - 1 and is therefore only valid for
   *          two or more points. `line` is computed lazily for the same reason
   *          — evaluating it eagerly produced "NaN,66" on every single-session
   *          render. Harmless, since that branch never drew it, but a NaN
   *          sitting in a variable is how the next edit ships a broken chart.
   */
  const x = (i: number): number => PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);

  const y = (weight: number): number =>
    PAD_TOP + (1 - (weight - range.min) / span) * (H - PAD_TOP - PAD_BOTTOM);

  const polyline = (): string => points.map((p, i) => `${x(i)},${y(p.weightKg)}`).join(' ');

  // Both are inhabited: the points.length === 0 branch returned above.
  const first = points[0]!;
  const last = points[points.length - 1]!;

  // INVARIANT: the component draws, it does not compute — ADR 0014. This was
  //            a subtraction in JSX, which made the page's headline figure the
  //            one number on screen with no test behind it.
  const change = progressionChange(points);

  const label = (p: ProgressionPoint): string =>
    `${p.weightKg} kg${p.reps === null ? '' : ` × ${p.reps}`}`;

  return (
    <div className="card lift-chart">
      {/*
       * One session draws no axis at all — ADR 0014, amended after building it.
       * The decision first read "a dot, not a line"; rendered, that is a single
       * point floating in a full-height empty box, which is the empty axis the
       * same sentence set out to avoid. One reading is printed as a reading.
       */}
      {points.length === 1 ? (
        <p className="lift-chart-single">
          <strong>{label(first)}</strong> on {displayDate(first.localDate)}. One session is a
          reading, not a trend — train it again and this becomes a line.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="lift-chart-svg"
          role="img"
          aria-label={
            `${points.length} sessions from ${displayDate(first.localDate)} to ` +
            `${displayDate(last.localDate)}. Heaviest working set went from ` +
            `${label(first)} to ${label(last)}.`
          }
        >
          <polyline className="lift-chart-line" points={polyline()} fill="none" strokeWidth={2} />
          {points.map((p, i) => (
            <circle
              key={p.localDate}
              className="lift-chart-dot"
              cx={x(i)}
              cy={y(p.weightKg)}
              r={3}
            />
          ))}
        </svg>
      )}

      {/*
       * The reps live in this table rather than as SVG text. Twelve labels
       * inside a 320-unit viewBox collide at 375px, and a scaled <text> element
       * ignores the user's font size — which the numbers under a chart are
       * exactly the wrong place to do.
       */}
      {/* Skipped for a single session: the sentence above already states it,
          and a one-row table repeating it verbatim is noise. */}
      {points.length > 1 && (
        <div className="table-scroll">
          <table className="table-cards lift-chart-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Top set</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.localDate}>
                  {/* Full date, not the short one: this table spans a training
                    history, and two sessions a year apart read as adjacent
                    without the year. */}
                  <td data-label="When">{displayDate(p.localDate)}</td>
                  <td data-label="Top set">{label(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hidden > 0 && (
        // Never a count: when the read was capped the query cannot know how
        // much history it did not fetch — progressionView's AI-NOTE.
        <p className="muted small">
          Older sessions are not shown. This is your most recent training on this lift.
        </p>
      )}

      {/* Gated on the figure rather than on the point count: progressionChange
          returns null below two points, and that is the same condition said
          once instead of twice. */}
      {change !== null && (
        <p className="muted small">
          {change === 0
            ? `Same top set as ${displayDate(first.localDate)}. A flat line is a plateau, not a missing chart.`
            : `${change > 0 ? '+' : ''}${change} kg since ${displayDate(first.localDate)}. Reps are shown because weight alone reads a deload as a decline.`}
        </p>
      )}
    </div>
  );
}
