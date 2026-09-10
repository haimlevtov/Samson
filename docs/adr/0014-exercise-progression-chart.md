# ADR 0014 — The progression chart plots what you lifted, not what it implies

**Status:** accepted, phase 5 — **amended 2026-09-07 and 2026-09-10, see Consequences**
**Date:** 2026-09-07

## Context

The session screen has carried a chart icon above every exercise since ADR 0011.
It has never opened a chart. It pointed at `/progress`, then at `/hub` when that
page was deleted (ADR 0012), and after ADR 0013 moved the badges off Hub it
pointed at a page with nothing about that exercise on it at all. Its
accessible name says "in progress", which was true of the feature rather than
of the lift.

So this is a control that has been rendered, tapped and disappointed for three
ADRs. It gets its chart.

## Decision

### Heaviest working set per session, each point labelled with its reps

The alternative was estimated 1RM, and it is the better _statistic_: `setE1rm`
already exists, it is comparable across rep ranges, and a 5×5 and a heavy triple
land on the same curve.

It is the worse _chart_. e1RM is a number the app computed; the weight on the
bar is a number the user chose, and they remember choosing it. A progression
chart is read to answer "am I getting stronger", and the fastest way to lose
someone's trust in that answer is to plot a figure they cannot tie to anything
they did. Epley is already available with its own explanation on Profile, where
it is one row in a table rather than the whole shape of the story.

**The reps are on every point, and that is not decoration.** Weight alone lies
about a deload: a chart that drops 20 kg looks like regression until it says
`60 × 12` where the week before said `80 × 5`. This is the known weakness of
plotting weight, and labelling is how it is answered rather than ignored.

**Warm-ups are excluded**, matching `exerciseBests`. A 20 kg warm-up is not a
data point about strength, and one of them on the chart would flatten the axis
for everything else.

### Inline SVG, and no charting dependency

This would be the project's first charting library, for one sparkline per
exercise. The weekly tonnage bars on Profile are already hand-rolled, and
`app/globals.css` is hand-written — a library would arrive with its own theming
model, its own responsive assumptions and its own bundle, all to draw a polyline
through a dozen points.

Inline SVG also themes for free: the chart uses the same CSS custom properties
as everything else, so it follows light, dark and system without being told.

### Its own route, not an inline toggle

`/history/exercise/[id]`. The session screen shows what you are doing now;
the chart is a different question about a different span of time.

Concretely, an inline toggle would make the session page load progression data
for **every** exercise in the session on the chance one is expanded, on the
screen most likely to be open on a phone mid-set. A route loads one lift's
history when someone asks for it. It also gets back-navigation, a shareable
address, and the full 375px rather than a chart squeezed under a set grid.

## Consequences

**A lift with one session draws no axis**, and one with none says so. Both are
ordinary states here: the chart is reachable from any exercise, including one
being logged for the first time.

_Amended 2026-09-07, after building it._ This first said "a dot, not a line". Rendered, that
is a single point floating in a full-height empty box — which is the empty axis
the same sentence set out to avoid, a chart shape promising a trend and showing
none. One reading is printed as a reading instead.

**The shaping is in `src/metrics/`, not in the component.** It is arithmetic
over logged sets — invariant #1 — and it is testable without a database or a
browser there. The component receives points and draws them.

**Bodyweight movements plot nothing.** `weightKg` is null for them by design
(`src/metrics/types.ts`), and inventing a bodyweight figure would rewrite the
user's history every time their weight changed. The chart says so instead.

## Amended 2026-09-10 — the chart carries three numbers, and they are not SVG text

The chart was "just lines": a shape with no scale, and the figures only in the
table underneath. It now labels **three points and two axis values**.

**The original decision said the reps live in the table, and the reason it gave
was two reasons.** `src/ui/LiftChart.tsx` said _"Twelve labels inside a 320-unit
viewBox collide at 375px, and a scaled `<text>` element ignores the user's font
size"_. Those fail differently and only one of them is about counting:

- **Collision** is a function of how many labels there are. Twelve collide;
  three do not, unless two of them land on top of each other — which is a
  condition that can be checked rather than hoped for.
- **Font size** is a property of `<text>` inside a scaled `viewBox`, and it does
  not improve at three labels. Text in an SVG that scales with its container
  ignores the reader's font-size preference completely, and numbers under a
  chart are the worst place in an app to do that.

So the count objection is answered by labelling three, and the font-size
objection is answered by **not using `<text>` at all**. The labels are ordinary
HTML elements positioned over the SVG in percentages of its box. They inherit
the page's type scale, they respond to the reader's font size, and they wrap and
truncate under the same rules as any other text in the app.

### Which three, and why those

**First and last** are the two points the headline "+22.5 kg since 12 March"
already compares, so labelling them shows the reader where that figure comes
from. **The heaviest** is the third because a progression line's other question
is "what is my best", and on a chart with a deload in it the best is neither end.

The heaviest label is **dropped** when it would collide: when it is already the
first or the last point, or when it sits within 18% of the axis from either end.
That rule is in `progressionLabels` in `src/metrics/progression.ts` with the
other shaping, not in the component — a label that silently overlaps another is
a rendering bug nobody can write a test for from the outside.

Ties on the heaviest weight take the **earliest** session, because the
interesting fact about a repeated best is when it was first reached.

### The axis says what was lifted, never what was padded

`progressionRange` pads a flat history — six sessions all at 100 kg — so the
line has somewhere to sit instead of dividing by zero. Printing that padded
range as an axis would put "110 kg" on a chart belonging to somebody who has
never lifted 110 kg.

So the axis ticks come from the DATA: the maximum at the top of the plot and the
minimum at the bottom. When those are equal there is one tick, on the line
itself, and no top or bottom — a flat line's honest axis is one number.

### The table stays, and the labels are hidden from screen readers

The table is the accessible rendering of this chart and it always was. The
overlay labels repeat three of its rows, so they carry `aria-hidden` — a screen
reader that announced them would read the same three sessions twice, once
without the context the table's headers give them. The `<svg>` keeps its
`aria-label` summary. Nothing about what a non-visual reader gets has changed.

## Alternatives rejected

**e1RM as the line, weight as points behind it.** The most informative and the
hardest to keep legible at 375px, which is the width that matters. Two series in
a sparkline is a chart that needs a legend, and a legend is a sign the chart is
answering two questions.

**Keep the icon pointing somewhere generic.** It is what has happened twice, and
each time it produced a link that technically resolved and answered nothing.

**A value on every point** (2026-09-10). The request was numbers on the chart,
and the most literal reading is all of them. At 375px twelve labels of "82.5 kg
× 5" need roughly 840px of horizontal room inside 330px of chart. The table
already lists every session, in the one rendering that scrolls, wraps and reads
aloud correctly — so "all of them" is not missing, it is one element lower down
the card. Three labels answer where the line starts, where it ends and where it
peaked, which is what the shape is being read for.

**SVG `<text>` for the labels** (2026-09-10). Simpler to position — the
component already has the coordinates — and it silently ignores the reader's
font size, in the part of the card that is nothing but numbers.
