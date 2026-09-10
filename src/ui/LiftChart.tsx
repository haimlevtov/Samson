import type { ProgressionLabel, ProgressionPoint } from '../metrics/progression';
import {
  progressionChange,
  progressionLabels,
  progressionRange,
  progressionTicks,
} from '../metrics/progression';
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
/*
 * The left gutter is where the axis values live, and it is wider than the right
 * for that reason alone — ADR 0014's 2026-09-10 amendment. Nothing is drawn in
 * it, so the plot loses 34 units of a 300-unit axis and the ticks never sit on
 * top of the first point's label.
 */
const PAD_LEFT = 44;
const PAD_RIGHT = 10;
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
  const x = (i: number): number =>
    PAD_LEFT + (i / (points.length - 1)) * (W - PAD_LEFT - PAD_RIGHT);

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

  /*
   * WHICH points carry a number, and which weights the axis prints. Both are
   * decisions rather than geometry — including the rule that drops a heaviest
   * label too close to an end — so both are in src/metrics/progression.ts where
   * they can fail a test without a browser.
   */
  const labels = progressionLabels(points);
  const ticks = progressionTicks(points);
  const labelled = new Set(labels.map((entry: ProgressionLabel) => entry.index));

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
        /*
         * The SVG draws; the numbers over it are HTML — ADR 0014's 2026-09-10
         * amendment. A <text> element inside a scaled viewBox ignores the
         * reader's font size, and the part of this card that is nothing but
         * numbers is the worst place in the app to do that.
         */
        <div className="lift-chart-plot">
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
                className={`lift-chart-dot${labelled.has(i) ? ' is-labelled' : ''}`}
                cx={x(i)}
                cy={y(p.weightKg)}
                r={labelled.has(i) ? 4 : 3}
              />
            ))}
          </svg>

          {/*
           * aria-hidden on all of it: every figure below repeats a row of the
           * table, which is the accessible rendering and has headers. A screen
           * reader that read both would hear the same three sessions twice,
           * the second time without the context that makes them mean anything.
           */}
          <div className="lift-chart-overlay" aria-hidden="true">
            {ticks.map((weightKg) => (
              <span
                key={weightKg}
                className="lift-chart-tick"
                /*
                 * Positioned by the same y() that places the line, rather than
                 * by a CSS constant, so a tick cannot drift away from the
                 * height it names when the padding changes.
                 */
                style={{ top: `${(y(weightKg) / H) * 100}%` }}
              >
                {weightKg} kg
              </span>
            ))}

            {labels.map((entry) => (
              <span
                key={entry.kind}
                className={`lift-chart-value is-${entry.kind} is-${entry.side}`}
                style={{
                  left: `${(x(entry.index) / W) * 100}%`,
                  top: `${(y(entry.point.weightKg) / H) * 100}%`,
                }}
              >
                {label(entry.point)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/*
       * EVERY session's reading, which the chart deliberately does not carry.
       * Three labels fit over the line; twelve collide at 375px, so this table
       * is where the rest live — and it is also the accessible rendering, the
       * one with headers that scrolls, wraps and reads aloud. ADR 0014 and its
       * 2026-09-10 amendment.
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
