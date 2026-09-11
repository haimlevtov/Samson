/**
 * The only thing the coach knows.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Every figure here
 *            comes from `src/metrics/` or `src/gamification/`, and the chat may
 *            quote these and nothing else — ADR 0015 §4.
 *
 * INVARIANT: the shape is fixed and code-built — ADR 0015 §1. There is no
 *            prompt that widens this set, because nothing reads a prompt to
 *            decide what goes in it. A jailbroken chat cannot ask for more
 *            because there is no mechanism through which more could arrive.
 *
 * Snake_case and a Zod schema, matching `metricsSummarySchema` in
 * `src/planner/schema.ts` — this is the same kind of object, the metrics half
 * of a prompt, and model-facing payloads in this project are snake_case.
 *
 * Pure over plain shapes, like `src/metrics/`: no database, no clock, no DOM.
 * The caller loads rows and maps them; this turns them into facts.
 */
import { z } from 'zod';

import { acwr, acwrBand } from '../metrics/acwr';
import { adherence, currentStreak } from '../metrics/adherence';
import { addDays, compareDates, daysBetween } from '../metrics/dates';
import { exerciseBests } from '../metrics/pr';
import { tonnageForWeekOf } from '../metrics/tonnage';
import type { LocalDate, SetRecord, WorkoutRecord } from '../metrics/types';
import { levelProgress } from '../gamification/level';

/** Matches the window the Profile tab reports, so the two cannot disagree. */
const ADHERENCE_WINDOW_DAYS = 28;

/**
 * How many lifts the coach is told about.
 *
 * WHY bounded: this is the only unbounded field in the payload — somebody with
 * a long history has trained a hundred movements — and every one of them adds
 * numbers to the set the reply is allowed to quote. Five is enough to talk
 * about somebody's main lifts.
 */
export const MAX_TOP_LIFTS = 5;

export const topLiftSchema = z.strictObject({
  /**
   * INVARIANT: from the third-party catalogue, therefore untrusted — ADR 0005.
   *            Sanitised and capped in `prompt.ts`, and its digits are NOT
   *            quotable — see `factNumbers`.
   */
  name: z.string(),
  /** Heaviest working set ever logged, in kilograms — CLAUDE.md #8. */
  heaviest_kg: z.number(),
  on_date: z.string(),
});
export type TopLift = z.infer<typeof topLiftSchema>;

export const coachFactsSchema = z.strictObject({
  as_of: z.string(),
  sessions_last_7_days: z.int(),
  sessions_last_28_days: z.int(),
  /** Whole percent, or null when nothing in the window has resolved. */
  adherence_28d_percent: z.number().nullable(),
  current_streak_days: z.int(),
  /** Null when nothing has been completed yet — which is not the same as zero. */
  days_since_last_session: z.int().nullable(),
  tonnage_this_week_kg: z.number(),
  tonnage_last_week_kg: z.number(),
  /** Null when there is not enough history for the ratio to mean anything. */
  acwr: z.number().nullable(),
  acwr_band: z.enum(['unknown', 'low', 'sweet-spot', 'high', 'danger']),
  level: z.int(),
  lifetime_xp: z.int(),
  xp_to_next_level: z.int(),
  top_lifts: z.array(topLiftSchema).max(MAX_TOP_LIFTS),
});
export type CoachFacts = z.infer<typeof coachFactsSchema>;

export interface CoachFactsInput {
  /** INVARIANT: the user's local date, never a server date — CLAUDE.md #9. */
  today: LocalDate;
  workouts: readonly WorkoutRecord[];
  sets: readonly SetRecord[];
  /** Exercise id to display name, from the catalogue. */
  exerciseNames: ReadonlyMap<string, string>;
  lifetimeXp: number;
}

function completedOnOrBefore(workouts: readonly WorkoutRecord[], asOf: LocalDate): WorkoutRecord[] {
  return workouts
    .filter((w) => w.status === 'completed' && compareDates(w.localDate, asOf) <= 0)
    .sort((a, b) => compareDates(b.localDate, a.localDate));
}

/**
 * Kilograms, to the nearest whole one.
 *
 * WHY rounded here rather than at display: this string is going to a model, and
 * `18734.400000000001` costs tokens, reads as false precision, and puts three
 * spurious numerals into the set the reply is allowed to quote.
 */
function roundKg(value: number): number {
  return Math.round(value);
}

export function coachFacts(input: CoachFactsInput): CoachFacts {
  const { today, workouts, sets, exerciseNames, lifetimeXp } = input;

  const completed = completedOnOrBefore(workouts, today);
  const since = (days: number): LocalDate => addDays(today, -(days - 1));

  const within = (days: number): number =>
    completed.filter((w) => compareDates(w.localDate, since(days)) >= 0).length;

  const rate = adherence(workouts, {
    start: since(ADHERENCE_WINDOW_DAYS),
    end: today,
  }).rate;

  const load = acwr(sets, today);
  const level = levelProgress(lifetimeXp);

  const lifts = [...exerciseBests(sets)]
    .flatMap(([id, best]) =>
      best.bestWeightKg === null || best.bestWeightDate === null
        ? []
        : [
            {
              name: exerciseNames.get(id) ?? id,
              heaviest_kg: best.bestWeightKg,
              on_date: best.bestWeightDate,
            },
          ]
    )
    // Heaviest first, then by name so the list is stable when two lifts tie —
    // otherwise the payload changes between identical calls and the prompt
    // cache misses for no reason.
    .sort((a, b) => b.heaviest_kg - a.heaviest_kg || a.name.localeCompare(b.name))
    .slice(0, MAX_TOP_LIFTS);

  const last = completed[0];

  return {
    as_of: today,
    sessions_last_7_days: within(7),
    sessions_last_28_days: within(ADHERENCE_WINDOW_DAYS),
    adherence_28d_percent: rate === null ? null : Math.round(rate * 100),
    current_streak_days: currentStreak(workouts, today),
    // daysBetween is positive when the FIRST argument is the later date, so
    // today leads. Reversed, this reports a negative age for every session.
    days_since_last_session: last === undefined ? null : daysBetween(today, last.localDate),
    // The function Profile's "This week" tile reads, so the coach and the tile
    // cannot disagree about a week — including one with nothing lifted yet.
    tonnage_this_week_kg: roundKg(tonnageForWeekOf(sets, today)),
    tonnage_last_week_kg: roundKg(tonnageForWeekOf(sets, addDays(today, -7))),
    // Two decimals: the ratio is read against bands at 0.8 and 1.5, and a third
    // decimal is precision the underlying estimate does not have.
    acwr: load.ratio === null ? null : Number(load.ratio.toFixed(2)),
    acwr_band: acwrBand(load.ratio),
    level: level.level,
    lifetime_xp: lifetimeXp,
    xp_to_next_level: level.toNext,
    top_lifts: lifts,
  };
}

/** Numerals inside a date string, e.g. "2026-09-08" → 2026, 9, 8. */
function dateNumerals(value: string, into: Set<number>): void {
  for (const part of value.split(/\D+/)) {
    if (part === '') continue;
    const n = Number(part);
    if (Number.isFinite(n)) into.add(n);
  }
}

/**
 * Every figure the coach may quote from the facts.
 *
 * INVARIANT: built from the TYPED LEAVES, never from the rendered block —
 *            ADR 0015 §4.
 *
 * FOUND IN REVIEW, 2026-09-07. This used to be `numbersIn(factsBlock(facts))`,
 * which reads every numeral out of the serialised JSON — including the digits
 * inside `top_lifts[].name`. Exercise names come from a third-party catalogue
 * ("3/4 Sit-Up", "45 Degree Hyperextension"), and `exercises` lets any
 * authenticated user insert their own row, so a user could name a lift
 * "Squat 4242", log one set, and thereby authorise the coach to say 4242. It is
 * self-scoped and bounded, but it made docs/specs/coach-chat.md's "every value
 * is a number the metrics engine computed" false.
 *
 * AI-NOTE: a new numeric field added to `coachFactsSchema` and forgotten here
 *          fails in the SAFE direction — the coach cannot quote it, the guard
 *          rejects the reply, the user gets the "figures I can't check"
 *          message. Reading the rendered block instead fails in the unsafe
 *          direction, which is what the bug above was. Keep it this way round.
 */
export function factNumbers(facts: CoachFacts): Set<number> {
  const allowed = new Set<number>();
  const add = (n: number | null): void => {
    if (n !== null && Number.isFinite(n)) allowed.add(n);
  };

  add(facts.sessions_last_7_days);
  add(facts.sessions_last_28_days);
  add(facts.adherence_28d_percent);
  add(facts.current_streak_days);
  add(facts.days_since_last_session);
  add(facts.tonnage_this_week_kg);
  add(facts.tonnage_last_week_kg);
  add(facts.acwr);
  add(facts.level);
  add(facts.lifetime_xp);
  add(facts.xp_to_next_level);

  dateNumerals(facts.as_of, allowed);

  for (const lift of facts.top_lifts) {
    add(lift.heaviest_kg);
    dateNumerals(lift.on_date, allowed);
    // `lift.name` is deliberately absent — see the AI-NOTE above.
  }

  return allowed;
}
