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

## Amended 2026-09-10 — the chart carries its numbers, and they are not SVG text

The chart was "just lines": a shape with no scale, and every figure only in the
table underneath. It now labels **up to three points**, plus an axis value
wherever those labels leave one of the extremes unnamed.

**The original decision said the reps live in the table, and the reason it gave
was two reasons.** `src/ui/LiftChart.tsx` said _"Twelve labels inside a 320-unit
viewBox collide at 375px, and a scaled `<text>` element ignores the user's font
size"_. Those fail differently and only one of them is about counting:

- **Collision** is a function of how many labels there are. Twelve collide;
  three do not, provided the third is checked against the other two rather than
  hoped for.
- **Font size** is a property of `<text>` inside a scaled `viewBox`, and it does
  not improve at three labels. Text in an SVG that scales with its container
  ignores the reader's font-size preference completely, and numbers under a
  chart are the worst place in an app to do that.

So the count objection is answered by labelling three, and the font-size
objection is answered by **not using `<text>` at all**. The labels are ordinary
HTML elements positioned over the SVG in percentages of its box, so they inherit
the page's type scale. They do **not** wrap or truncate: `white-space: nowrap`
and no ellipsis, because half a weight is worse than no weight and a wrapped
label is two lines of text over a 140-unit chart.

### Which three, and why those

**First and last** are the two points the headline "+22.5 kg since 12 March"
already compares, so labelling them shows the reader where that figure comes
from. **The heaviest** is the third because a progression line's other question
is "what is my best", and on a chart with a deload in it the best is neither end.

Ties on the heaviest weight take the **earliest** session, because the
interesting fact about a repeated best is when it was first reached.

### Each label sits on the side the line is not on

`ProgressionLabel` carries a `side`, and it is a fact about the data rather than
a constant. The line leaves the first point heading for the second and arrives
at the last one from the second-to-last, so a **rising** first segment puts the
line above and right of the first point and its label goes below; a rising
**last** segment puts the line below and left of the last point and its label
goes above. Falling reverses both. The heaviest is always above, because it is
the topmost point and nothing is drawn over it.

_Found in a browser, not by reading the code._ With both ends printed below
their points, an ordinary rising history drew "127.5 kg × 5" straight through
the polyline and the three dots before it.

### What actually stops two labels colliding

_This section has been wrong twice, and both versions are worth keeping because
the second one reads like the correction of the first._

**It first said the 18% gap rule prevented the collision.** It does not: the
rule is one-dimensional, and on one row the arithmetic does not work at all. A
label is about a quarter of the axis wide, so a centred middle label clears a
left-pinned first one only when the peak falls in the middle fifth of the
history — the rule would have hidden the label in most of the cases it exists
for.

**It then said two rows did, because the ends print below and the heaviest
above.** That was written before the `side` rule above, and the `side` rule
breaks it: on a rising history the last label is above its point too. A peak a
kilogram higher than the final session, near the end of the axis, puts both on
the same line of text.

**So the check is two-dimensional, because the collision is.** The heaviest
label is dropped when it would overlap an end label that is on the same side —
close along the axis, measured against `LABEL_WIDTH_FRACTION`, _and_ close in
weight, measured against `LABEL_ROW_FRACTION`. Both constants are measured at
375px and stated as fractions of the axis and of the value range, so they mean
something at any width.

**`MIN_LABEL_GAP` survives, doing something smaller and stated correctly.** The
heaviest label is _centred_ on its point, so it needs half its own width of axis
on either side or it hangs outside the plot. Half of `LABEL_WIDTH_FRACTION` is
0.13; the gap is 0.18, that with a margin. It is not, and never was, what keeps
labels off each other.

All of this lives in `progressionLabels` in `src/metrics/progression.ts` with
the other shaping rather than in the component, because a label that lands on
another is a rendering fault with no failing test anywhere else.

_A third thing the first version got wrong, found by deliberately breaking the
code:_ it said the heaviest is dropped "when it is already the first or the last
point", and there was a branch for exactly that. Deleting the branch turned no
test red, because it could not — an end point sits at 0 or 1 of the axis,
outside any positive gap, so the gap rule had always been handling it. The
branch is gone.

### The axis fills the gap the labels leave, and nothing else

`progressionRange` pads a flat history — six sessions all at 100 kg — so the
line has somewhere to sit instead of dividing by zero. Printing that padded
range as an axis would put "110 kg" on a chart belonging to somebody who has
never lifted 110 kg. So the ticks come from the **data**.

They also come **only where a label does not already print them**. On a history
that only rises — the commonest shape there is — the first and last points _are_
the minimum and the maximum, so their labels carry both numbers with the reps
attached, and an axis repeating them is two more figures saying what the chart
just said. A tick appears exactly where the labels leave a gap: the trough of a
deload, or a peak whose label was dropped for crowding another. Usually there
are none.

_This began as "always the maximum and the minimum, in a left gutter", and the
gutter is the part that had to go._ It cost 11% of the axis on every chart —
enough to push `MAX_PLOTTED_SESSIONS` past the dot spacing it was derived
from, in a change nowhere near that constant — it was still too narrow for
"142.5 kg" at 320px, where every tick was clipped; and it spent that width, on
the commonest history of all, printing two numbers already on screen.

### The chart stops growing at 560px

Found at a wide width rather than by reasoning. The SVG scales with its viewBox
and the labels do not — correctly, because they are text at reading size — so
inside the app's 1000px shell a dot grew to roughly 18px next to 11px figures
and the sparkline read as a poster with captions. The plot is capped at 560px
from 760px up; the table underneath still uses the full width.

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
and the most literal reading is all of them. At 375px a label reading "82.5 kg ×
5" is about 70px against an axis of about 300px, so twelve of them need nearly
three times the room there is. The table already lists every session, in the one
rendering that scrolls, wraps and reads aloud correctly — so "all of them" is
not missing, it is one element lower down the card. Three labels answer where
the line starts, where it ends and where it peaked, which is what the shape is
being read for.

**An axis in a left gutter** (2026-09-10). Built, measured, removed within the
same PR. Reserving 44 of 320 viewBox units for the maximum and minimum cost 11%
of the axis on every chart — enough to push `MAX_PLOTTED_SESSIONS` past the dot
spacing it was derived from — was still too narrow for "142.5 kg" at 320px,
where every tick rendered clipped, and on a history that only rises it spent
that width printing the two numbers the end labels already carry.

**SVG `<text>` for the labels** (2026-09-10). Simpler to position — the
component already has the coordinates — and it silently ignores the reader's
font size, in the part of the card that is nothing but numbers.
