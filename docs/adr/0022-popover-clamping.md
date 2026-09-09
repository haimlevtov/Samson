# ADR 0022 — CSS decides whether a popover shows; JavaScript decides where it sits

**Status:** accepted, phase 5
**Date:** 2026-09-09

> Written before the fix it governs. It is a small change, and it is here rather
> than in a comment because it decides how the NEXT popover in this app gets
> positioned, and the alternative it rejects is the one a reader would otherwise
> reach for first.

## Context

`src/ui/FieldHint.tsx` renders a `?` button with a `.hint-bubble` beside it, used
in 41 places. The bubble is `position: absolute` inside a `position: relative`
`.hint` span, anchored `left: 0` with `max-width: min(260px, 76vw)`.

The comment on that rule says, of pinning left rather than centring:

> Growing rightwards always has room.

It does not. MEASURED on `/profile` at 375×812 against the hosted project,
2026-09-08:

|                           | `documentElement.scrollWidth` |
| ------------------------- | ----------------------------- |
| all hints closed          | 375                           |
| the "Adherence" hint open | **418**                       |

That bubble's rect is `left: 158, right: 418` against a `clientWidth` of 375 — it
hangs 43 px past the edge and the page scrolls sideways. It is arithmetic rather
than bad luck: at 375 px the max-width resolves to 260 px, and any hint whose
button sits past x=115 overflows. The right-hand tile of a four-up grid always
does. Hints in the left column never do, which is why it survived.

`docs/specs/mobile-interface.md` calls horizontal page scroll "the single most
common phone-layout failure" and forbids it outright. This is pre-existing — it
reproduces on hints whose copy has never been touched — so it is a positioning
bug, not a copy-length one, and shortening hint text would only move the
threshold.

## Decision

**The bubble's horizontal offset is measured and clamped in JavaScript when it
becomes visible. CSS still owns whether it is visible.**

The two responsibilities stay split, which is the part worth writing down:

- CSS keeps `:hover`, `:focus-within` and `[data-open]` deciding **display**, so
  the tooltip still works on a pointer, from the keyboard, and on a tap, with no
  behaviour change and no new state to get out of sync.
- JavaScript sets **one custom property** for the shift, on every path that can
  reveal the bubble, and on resize while one is open.

A bubble that would cross the right edge is pulled left by exactly its overflow,
and never past the left edge. The bubble stays beside its own button, which is
what makes a tooltip a tooltip.

## Alternatives rejected

**Shrink `max-width` until it always fits.** The constraint has to hold for the
worst case — a hint whose button sits at the far right of the viewport — so the
bubble would have to be about 25 px wide at 375 px. Sizing every bubble for the
worst position on the page is not a fix, it is a different bug.

**A modifier class on the call sites that need it.** `.hint-bubble--right` on the
hints in right-hand columns, flipping to `right: 0`. Rejected on maintenance
grounds: it asks each of 41 call sites to know where it will land, it is wrong
the moment a grid reflows at a different breakpoint, and nothing fails when
someone forgets it. That last property is the disqualifying one — this bug
survived because nothing failed.

**CSS anchor positioning** (`position-try-fallbacks`) expresses exactly this,
declaratively, with no JavaScript. Rejected for now rather than on merit: it is
not yet something this project can rely on across the phone browsers it ships
to, and the whole point of the change is that the phone case is the broken one.
Worth revisiting; it would delete the code this ADR adds.

**Make the bubble full-width and fixed on phones.** It would work, and it
discards the association between a bubble and its button — the reader would have
to remember which `?` they pressed. `position: fixed` also resolves against a
transformed ancestor rather than the viewport, and this stylesheet uses
transforms.

## Consequences

- Positioning now depends on JavaScript. With JS off the bubble renders where it
  does today, which is where it renders today — so the failure mode is the
  current behaviour, not a worse one.
- The measurement runs on show, not on every render, and reads
  `getBoundingClientRect` once. There is no observer and no layout loop.
- **This is the pattern for the next popover.** Anything anchored to a control
  and floating above the page — a menu, a date picker, a set-editor popover —
  has this bug waiting for it. Reuse `FieldHint`'s clamp rather than writing a
  second one, exactly as `FieldHint`'s own docstring asked phase 4 to reuse it.
