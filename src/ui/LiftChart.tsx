import type { ProgressionPoint } from '../metrics/progression';
import { progressionRange } from '../metrics/progression';
import { displayShortDate } from './format';

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

export function LiftChart({ points, unit = 'kg' }: { points: ProgressionPoint[]; unit?: string }) {
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
   * One session draws no axis at all — ADR 0014, amended after seeing it.
   *
   * The original decision was "a dot, not a line". Rendered, that is a single
   * point floating in a full-height empty box, which is exactly the empty axis
   * the same sentence set out to avoid: a chart shape that promises a trend and
   * shows none. One reading is a reading, so it is printed as one.
   */
  const x = (i: number): number => PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);

  const y = (weight: number): number =>
    PAD_TOP + (1 - (weight - range.min) / span) * (H - PAD_TOP - PAD_BOTTOM);

  const line = points.map((p, i) => `${x(i)},${y(p.weightKg)}`).join(' ');

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const change = last.weightKg - first.weightKg;

  const label = (p: ProgressionPoint): string =>
    `${p.weightKg} ${unit}${p.reps === null ? '' : ` × ${p.reps}`}`;

  return (
    <div className="card lift-chart">
      {points.length === 1 ? (
        <p className="lift-chart-single">
          <strong>{label(first)}</strong> on {displayShortDate(first.localDate)}. One session is a
          reading, not a trend — train it again and this becomes a line.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="lift-chart-svg"
          role="img"
          aria-label={
            `${points.length} sessions from ${displayShortDate(first.localDate)} to ` +
            `${displayShortDate(last.localDate)}. Heaviest working set went from ` +
            `${label(first)} to ${label(last)}.`
          }
        >
          <polyline className="lift-chart-line" points={line} fill="none" strokeWidth={2} />
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
                  <td data-label="When">{displayShortDate(p.localDate)}</td>
                  <td data-label="Top set">{label(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {points.length > 1 && (
        <p className="muted small">
          {change === 0
            ? `Same top set as ${displayShortDate(first.localDate)}. A flat line is a plateau, not a missing chart.`
            : `${change > 0 ? '+' : ''}${Number(change.toFixed(1))} ${unit} since ${displayShortDate(first.localDate)}. Reps are shown because weight alone reads a deload as a decline.`}
        </p>
      )}
    </div>
  );
}
