# Handoff: Samson — "Quest Log" gamified redesign (option 2a)

Repo: `haimlevtov/Samson` (Next.js App Router, Server Components, `app/globals.css` is the whole visual system).
Design files are in `design/`. Open `design/Samson 2a Full.dc.html` in a browser (keep `support.js` and `ios-frame.jsx` beside it) — every screen is a 390×844 phone frame; the Tweaks panel flips light/dark.

## Overview
A presentation-only redesign of the game layer. **No data model, RPC, policy or number changes.** The leaderboard still shows rank · display name · level; XP still derives from adherence with the weekly ceiling; hidden achievements stay unlisted until held; the level curve in `src/gamification/level.ts` is untouched. What changes: layout, iconography (hex emblems), type (one display font), and copy on seven screens.

## About the design files
The `.dc.html` files are **design references written in HTML** — not code to paste in. Recreate them in the existing Next.js codebase, following its own rules (read `CLAUDE.md` and `docs/specs/mobile-interface.md` first): phone-first CSS in `app/globals.css` with `min-width` queries only, every colour a `--token`, 44px tap targets, state never carried by colour alone, `FieldHint` for every "?" hint, `.card`/`.chip`/`.xp-meter` primitives reused rather than copied.

- `design/Samson 2a Full.dc.html` — **the target.** Hub, Profile, badge unlock, progression trees, session, finish moment, Coach.
- `design/Samson Redesign.dc.html` — the three explored directions (1a Quest Log, 1b League, 1c Arcade) and the 2a combination. Reference only.
- `design/Samson Current.dc.html` — faithful recreation of today's Hub/Profile/History for diffing.

## Fidelity
**High-fidelity for Hub, Profile, badge unlock, progression trees, finish moment, Coach** — colours, sizes and copy are final. **The session screen is a light coat**: only the sticky bar, the quest hint card and the rest pill change; the set grid keeps today's markup and CSS exactly.

Illustrative content (do NOT hard-code): progression rung names, the coach persona "Kit", the tonnage comparison, session names. They come from DB rows.

---

## Design tokens

Everything already in `:root` / dark block of `app/globals.css` stays. Add these (light → dark):

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--gold` gradient | `linear-gradient(145deg,#f7e3a1 0%,#d9a93a 48%,#a8741c 100%)`, ink `#3d2a05` | same | 1st place, gold-tier badge |
| `--silver` gradient | `linear-gradient(145deg,#f4f5f9 0%,#b9bfd0 48%,#7d849a 100%)`, ink `#262b38` | same | 2nd place, silver tier |
| `--bronze` gradient | `linear-gradient(145deg,#f0c49a 0%,#c07a3f 48%,#7d4a22 100%)`, ink `#3a1f0a` | same | 3rd place, bronze tier |
| `--obsidian` gradient | `linear-gradient(145deg,#5a48a0 0%,#1c1530 50%,#0b0810 100%)`, ink `#d6c8ff` | same | hidden ("found") badges |
| `--emblem` gradient | `linear-gradient(135deg,var(--accent),var(--accent-strong))` | same tokens | level hex, unlocked rungs, active quest icon |
| `--hex` | `polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)` | — | `clip-path` for every emblem |
| board card ground | `radial-gradient(120% 80% at 50% -10%, #6c4df6 0%, #3b2599 38%, #14111f 78%)`, border `#3b3853`, text `#edebf5`, muted `#c9c3de`/`#a29fbd`, gold text `#f3d27a` | same (always dark) | the leaderboard card |

Metal tiers are a **display mapping of `achievements.tier`**, not a column: consistency → silver, comeback → silver, pr → gold, volume → gold, recovery → bronze, variety → bronze, calendar → bronze, hidden → obsidian. Put the map in one TS module (`src/ui/tiers.ts`), test it covers all eight tiers.

### Type
- Display: **Bricolage Grotesque** (Google Fonts, OFL) via `next/font/google`, weights 500–800, `opsz` axis on. Used for h1 (28–30px/1.1, 800, −0.03em), card titles (16–17px, 800, −0.01em), big numerals (22–40px, 800, −0.02/−0.03em), level digits.
- Body stays the existing system stack, 15px/1.55. Small 13px, micro 12px, kickers 11px/700/uppercase/0.1em.
- Section `h2.section` unchanged (12px uppercase 0.08em muted) but now carries a 14px leading icon.

### Icons
Lucide (ISC) outline, 2px stroke — the same grid as the five tab icons in `src/ui/TabBar.tsx`. The mock loads them from `api.iconify.design/lucide/<name>.svg`; in the app either add `lucide-react` (tree-shaken) or copy the paths inline the way `TabBar.tsx` does. Names used: `scroll-text hourglass crown sparkles swords sunrise flame dumbbell calendar-check target medal route chevron-right chevron-left chevron-down lock lock-open check check-check repeat bed shuffle settings arrow-up-from-line arrow-down-to-line footprints circle-dot chart-line pencil pill message-circle message-circle-question volume-2 send-horizontal`.

### Shape and spacing
Radius 16 (cards), 14 (rows), 10 (buttons/chips), 6 (label chips). Card padding 14px; grid gaps 12px; hex emblems 36 / 40 / 44 / 52 / 56 / 64 / 104 / 132 px. Shadows: existing `--shadow` / `--shadow-lift`.

---

## Screens

### 1. Hub — `app/hub/page.tsx`
Order changes to: header → **The board** → Open to you → In play → Not offered (unchanged).

**Header**: kicker `QUEST BOARD · WEEK 37` (ISO week of `today`, 11px/700/0.1em accent-text) over h1 `Hub` (Bricolage 30/800) and the existing name · date line. Right: a 48px hex emblem (`--emblem`, white) showing `LVL` (8px, 0.1em, 80% opacity) over the level (18px/800). Level comes from `levelProgress(xp.lifetime)` — Hub must load `loadXpSummary` too.

**The board** (`h2.section.with-hint` with `crown` icon, same FieldHint copy as today, margin `4px 0 10px`): one card, `border-radius:20px; padding:18px 16px 12px`, the board ground above, **always dark in both themes**.
- Top row: `trophy` icon + `LEADERBOARD` left, `5 lifters` right (11px/700/0.14em, `#c9c3de`).
- Podium: 3-col grid `1fr 1.15fr 1fr`, `align-items:end`, `gap:6px`, `margin-top:16px`. Order **2nd · 1st · 3rd**. Each tile: `padding:10px 4px`, `border-radius:12px 12px 0 0`, ground `rgba(255,255,255,.06/.12/.04)`; 1st adds a `crown` icon (18px, `#f3d27a`) above. Avatar: hex emblem 52 / 64 / 48px, 4px metal rim (`--silver/--gold/--bronze`), inner hex `#1c1530` with the first letter of the display name (Bricolage 18/22/16, 800). Below: name (12px/700, wraps to two lines, never ellipsis), level as `LV` (11px kicker) + digits (Bricolage 22/28/20, 800; 1st in `#f3d27a`), then `2ND / 1ST / 3RD` (11px/700/0.1em; silver `#b9bfd0`, gold `#f3d27a`, bronze `#e0a473`).
- Rows 4+: `border-top:1px solid rgba(255,255,255,.14)`; grid `28px 1fr auto`, `padding:10px 8px`. The reader's row: ground `rgba(255,255,255,.14)`, radius 10, weight 700, and the `YOU` chip (11px/800/0.08em, `#edebf5` on `#3b2599`, radius 6). Colour is not the only signal — chip + `aria-current`. Level cell `LV 5` (Bricolage 18/800).
- Footer line 12px `#a29fbd`: "Ordered by XP total, shown as levels. Anyone signed in can see this row; leave from Settings."
- Fewer than 3 lifters: render only the tiles that exist, centred; empty board keeps today's copy.
- Keep `key={row.rank}` and the `.lb-name` clamp; long names wrap inside the tile (max two lines) rather than widen it.

**Quest cards** (offered): `.card` as grid `56px 1fr`, gap 12. Left: 56px hex, `--accent-soft` ground, 26px icon in `--accent-text` (`sunrise` daily, `flame` hard sets, `dumbbell` sessions, `calendar-check` streak, `shuffle` distinct movements — pick by `spec.kind` + window). Title: humanised slug (`daily-three-movements` → "Three movements today", `weekly-eight-hard-sets` → "Eight hard sets this week") — write a small `challengeTitle(slug, spec)` in `src/ui/format.ts` with tests, fall back to the de-hyphenated slug. Meta line: kind chip (radius 6) + `RPE 8 or above` when `rpe_at_least` + `+30 XP` with `sparkles` icon in accent-text 700. Button spans both columns: existing primary button, label **"Take the quest"**, `swords` icon. Closed window keeps today's sentence instead of the button.

**In play**: same card with `border-color:var(--accent)`, hex in `--emblem` with white icon. Progress is a **segmented meter**: `grid-template-columns:repeat(target,1fr)`, gap 4, 10px tall, radius 4 — filled segments `--accent`, empty `--surface-2` + 1px border. Below: `2 of 3 · one more session closes it` / `pays on the next weekly run once met`. Use the segmented meter only when `target ≤ 10`; otherwise the existing `.xp-meter`.

### 2. Profile — `app/profile/page.tsx`
**Header**: h1 in Bricolage 28/800; cog becomes the `settings` icon inside the existing `.icon-btn`.

**Hero level card** (`.card`, grid `112px 1fr`, gap 14): left a 104px **ring** — `conic-gradient(var(--accent) <pct>%, var(--surface-2) 0)` circle, 86px `--surface` disc inside, 62px `--emblem` hex with the level (Bricolage 28/800). `role="img"` + the existing aria label. Right: `LEVEL 5` kicker + FieldHint, `422 XP to Level 6` (Bricolage 22/800), `310 of 732 into this level · 42%` (13px muted), two label chips `2,040 XP lifetime` and `Level 6 at 2,462` (= `xpForLevel(level+1)`).

**Stat tiles**: 2×2, all equal (drop the `nth-child(-n+2)` span for this grid). Each: label + 28px icon plate (radius 8, `--accent-soft`, 16px accent-text icon: `flame target dumbbell medal`) on one row, value Bricolage 30/800, sub-line 13px. Streak sub-line reads `1 to 7 · rest days keep it alive`; badges sub-line `one of them hidden` when any held badge is hidden.

**This week's XP**: `210 of 500` (Bricolage 22/800 + 14px muted) with `WEEKLY CAP` kicker; a 10-segment meter (each segment = 10% of ceiling; partial segment as a two-stop gradient); sentence "From kept sessions, never from load. Past the cap, more training earns nothing."

**Progression row-link**: 40px hex plate with `route` icon, "Progression trees", sub `push · pull · legs · core · 7 of 16 rungs open` (needs `unlockStates` count — load it here or drop the count), `chevron-right`.

**Badge shelf**: `h2` "Badges · 4 earned". 3-column grid, gap 10. Earned card: `.card`, centred, 64px hex in the tier metal with a 28px icon (icon per slug — add an `icon` column? No: map slug → icon in `src/ui/tiers.ts` alongside the metal, defaulting to `medal`), name 12px/700, `tier · metal` 11px muted. Hidden+held card: obsidian hex, border `--accent-text`, caption `hidden · found` in accent-text. **Locked slots**: dashed `--border-strong` border, transparent ground, `--surface-2` hex with `lock`, muted name + tier — only for `hidden = false` achievements the user has not earned (`achievements_read_visible` already scopes that read; never enumerate hidden ones). Footer 12px: "Hidden badges are not listed until you find one. Metal is a reading of the tier, not a new number."

Training load, weekly tonnage and best e1RM: unchanged.

### 3. Badge unlock — `app/history/BadgeReveal.tsx`
Becomes a full-screen sheet over History (`position:fixed; inset:0; z-index:60; background:rgba(14,13,21,.66); display:grid; place-items:center; padding:24px 20px`). Card: `border-radius:22px; padding:28px 22px 20px; background:radial-gradient(140% 90% at 50% 0%, #4a3a7a 0%, #1c1530 55%, #0b0810 100%); border:1px solid #6b57b8; box-shadow:0 30px 60px -20px rgba(0,0,0,.8); color:#edebf5`. Contents centred: 112px hex rim (`linear-gradient(145deg,#8d7ad6,#2a2046 45%,#0b0810)`) with 98px inner hex in the badge's tier metal (obsidian for hidden) and a 44px icon; kicker `SOMETHING HIDDEN, FOUND` / `ACHIEVEMENT UNLOCKED` (12px/700/0.12em `#b5a3ff`); name Bricolage 28/800; description 14px `#c9c3de`; `source_hint` italic 13px `#a29fbd`; chips `hidden` (`#262040`/`#b5a3ff`/border `#4c31c9`), `found` (outline `#b5a3ff`), `+75 XP` (`#262040`, border `#3b3853`); two buttons in a 2-col grid — `All badges` (secondary, `#201e2c`/border `#3b3853`) and `Continue` (primary). `role="status" aria-live="polite"`; `Continue` and Escape dismiss (client component, `useState`). Respect `prefers-reduced-motion` — fade only. The `?unlocked=` mechanism stays.

### 4. Progression trees — `app/progression-trees/page.tsx`
Header: kicker `SKILL TREES`, h1 `Progression` (Bricolage 30), `7 of 16 rungs open`; right a chip-link `‹ Profile` with `chevron-left`.
Tree summary: 4 tiles (`repeat(4,1fr)`, gap 8), each a 40px hex (`arrow-up-from-line` push, `arrow-down-to-line` pull, `footprints` legs, `circle-dot` core), tree name 12px/700, `2 / 4` 11px muted; the tree with the most recent unlock gets `--emblem` fill and an accent border.
Rung list per tree, **top rung first** (reverse today's order — read as a climb). `ol` reset; each `li` grid `44px 1fr`, gap 12, `padding:10px 0`. Column 1: 36px hex — unlocked `--emblem` + `check`, next `--accent-soft` + `target`, locked `--surface-2` + 1px border + `lock` at 70% opacity, `met && !unlocked` `--warn-soft` + `lock-open`; a 2px connector (`--accent` between unlocked rungs, `--border-strong` otherwise). Column 2: name Bricolage 16/800 (muted when locked), criterion sentence exactly as today, chips: `unlocked` (chip-on), `next` (outline accent-text), `cleared — finish the rung below` (warn). The `next` rung is a raised `.card` with `border-color:var(--accent-text)` and `margin:0 -10px; padding:12px 10px`. Keep the `truncated` notice and the "sets in a single session" explainer (now 12px under the tiles).

### 5. Session — `app/history/[id]/*` (light coat)
- `.session-bar`: back becomes `chevron-left` in the 44px circle; centre stacks the clock (Bricolage 20/800, tabular) over `LOWER B · SESSION 42` (10px/700/0.1em muted — template name + workout count); Finish keeps `.bar-finish`.
- New quest hint card under the bar: 34px hex (`--accent-soft`, `dumbbell`) + 13px text "**Kept session pays XP when you finish.** Counts toward *Three sessions this week* · 2 → 3." Only when an active `sessions` challenge exists; otherwise the first sentence alone.
- `.lift-name` in Bricolage 18/800; the two `.icon-btn`s use `chart-line` and `pencil`.
- **Set grid untouched** (ADR 0011). Note for the mock: it lacks the app's `* { box-sizing: border-box }` — do not copy any width fix from it.
- `.rest-bar`: count in Bricolage 22/800; controls `−15 · +15 · Skip` unchanged.

### 6. Finish moment — new route or state after `FinishForm`
Shown once after finishing, before the redirect to `/history?unlocked=`. All numbers come from what `award_session_xp` and the metrics already return — no new arithmetic.
Centred: kicker `SESSION KEPT · LOWER B · 42:06`; 132px `--emblem` hex with `EARNED / +70 / XP` (11px kicker, Bricolage 40/800, 12px); h1 `Third kept session this week` (Bricolage 26/800); 13px "Each session in a week pays a little less than the one before. Load never changes the number."
Card: `280 of 500 this week` + `WEEKLY CAP`, 10-segment meter with this session's segment outlined `2px solid var(--accent-text)`; line `Level 5 · 380 of 732 · 352 XP to Level 6`.
Rows (grid `44px 1fr auto`, radius 14): streak (`flame`, `--emblem`) "Streak 7 — milestone reached / Rest days keep it alive. Next mark at 14." with the number right; each active challenge (`check-check` in `--good-soft`/`--good` when met — border `--good`; `calendar-check` in `--accent-soft` otherwise) with `3/3`; copy says **"pays on the next weekly run"** for challenges (ADR 0009 §4 — payout is batch, never immediate).
Footer 12px "Badges are checked as this saves. If one fires, it lands on History next." Buttons: `Done` (primary, 48px) → `/history`, `Review the session` (secondary) → `/history/[id]`.

### 7. Coach — `app/coach/page.tsx`, `CoachConsole.tsx`, `CoachBox.tsx`
Header: kicker `YOUR CORNER`, h1 `Coach`, `Plan accepted 07/09/2026 · 4 weeks`; `Supplements` chip-link gains the `pill` icon.
**Voice card** (`.card`): 52px `--emblem` hex with `message-circle`; persona name + voice direction (Bricolage 18/800) and "Speaks the plan; never changes a number in it."; `Change` chip (opens the existing persona picker). Inside, the delivered lines keep `.delivered` (left border accent, `--accent-soft` ground, radius 10) with a `WEEK 2 OF 4 · WHAT <NAME> SAYS` kicker; each line is grid `1fr 44px` with a 44px round speak button (`volume-2`, `--surface` ground, accent border) — text-only when no API key (ADR 0025).
**Plan disclosure**: the `details.plan-disclosure.card` summary becomes a row-link look: 40px hex `scroll-text`, "Show my plan", sub "4 weeks · checked by rules before the coach saw it · save a session as a template", `chevron-down` rotating on open. Body unchanged.
**Ask the coach** (`h2.section` with `message-circle-question` + FieldHint): `.card` holding the last exchange as two turns (`.chat-user` accent-soft with `You` 12px/700 accent-text; coach turn `--surface-2`), the textarea (16px, placeholder "Ask about training, food or a supplement…"), and one row: the existing `SpeakSwitch` ("Read replies aloud · <name>'s voice") left, `Send` primary with `send-horizontal` right. **Removed by decision:** the weekday tiles and the Training / Food / Supplement topic chips — the route decides the topic (ADR 0015 §6).

### Tab bar — `src/ui/TabBar.tsx`
Unchanged icons and behaviour. Sticky pill for the active tab as today.

---

## Interactions & behaviour
- Static design: no new animation beyond today's `badge-in` (now a 320ms fade/6px rise on the sheet, gated by `prefers-reduced-motion`).
- `Take the quest` = today's `acceptChallengeAction`; closed windows keep the sentence, never a dead button.
- Unlock sheet: dismiss on `Continue`, Escape, or the backdrop; `All badges` → `/profile`.
- Plan disclosure stays a native `<details>`.
- Everything keeps 44px targets; label chips (non-interactive) keep the `.badge-card .chip` exemption.

## State & data
- Hub additionally loads `loadXpSummary` (for the header level). Nothing else new; the leaderboard view is unchanged (four columns, `is_you`).
- Profile needs `unlockStates` only if the rung count is shown; drop the count rather than add a heavy read.
- Finish moment reads the just-written `xp_events` row via the existing `finishWorkout` return; if the award is null (ceiling reached / already paid) the emblem says `+0` and the sentence "The weekly cap is reached — the session still counts for streak and adherence."
- New pure helpers with tests: `challengeTitle`, tier→metal/icon map, ISO week label.

## Guardrails from the ADRs (do not undo)
- CLAUDE.md #1/#4: no number is computed here; XP never scales with volume — the design's copy says so on three screens, keep it.
- ADR 0016: no XP totals on the board, no `user_id`, no email fallback; the `you` marker is chip + `aria-current`, not colour alone.
- ADR 0017: locked hidden achievements are never rendered — the locked-slot grid lists `hidden = false` rows only.
- ADR 0009 §4: challenge payout copy is "pays on the next weekly run".
- mobile-interface.md §3/§4: no horizontal scroll (the podium tiles wrap names), no empty tables, 16px inputs.

## Research the design answers (what it avoids)
Global "you are 1000th" framing (top three celebrated, you shown in place, levels not XP); streak dread (every streak readout says rest keeps it alive); FOMO mechanics (no timers, chests, boosts, paid freezes); badge spoilers; invented numbers (titles/metals are display-only).

## Files
- `design/Samson 2a Full.dc.html` — target screens (needs `design/support.js`, `design/ios-frame.jsx`).
- `design/Samson Redesign.dc.html` — explorations 1a/1b/1c/2a.
- `design/Samson Current.dc.html` — today's screens, recreated.
