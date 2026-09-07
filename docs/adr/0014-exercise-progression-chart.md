# ADR 0014 — The progression chart plots what you lifted, not what it implies

**Status:** accepted, phase 5
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

_Amended after building it._ This first said "a dot, not a line". Rendered, that
is a single point floating in a full-height empty box — which is the empty axis
the same sentence set out to avoid, a chart shape promising a trend and showing
none. One reading is printed as a reading instead.

**The shaping is in `src/metrics/`, not in the component.** It is arithmetic
over logged sets — invariant #1 — and it is testable without a database or a
browser there. The component receives points and draws them.

**Bodyweight movements plot nothing.** `weightKg` is null for them by design
(`src/metrics/types.ts`), and inventing a bodyweight figure would rewrite the
user's history every time their weight changed. The chart says so instead.

## Alternatives rejected

**e1RM as the line, weight as points behind it.** The most informative and the
hardest to keep legible at 375px, which is the width that matters. Two series in
a sparkline is a chart that needs a legend, and a legend is a sign the chart is
answering two questions.

**Keep the icon pointing somewhere generic.** It is what has happened twice, and
each time it produced a link that technically resolved and answered nothing.
