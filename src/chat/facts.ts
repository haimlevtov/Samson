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
 * Pure over plain shapes, like `src/metrics/`: no database, no clock, no DOM.
 * The caller loads rows and maps them; this turns them into facts.
 */
import { acwr, acwrBand } from '../metrics/acwr';
import { adherence, currentStreak } from '../metrics/adherence';
import { addDays, compareDates, daysBetween, startOfWeek } from '../metrics/dates';
import { exerciseBests } from '../metrics/pr';
import { tonnageByWeek } from '../metrics/tonnage';
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

export interface TopLift {
  name: string;
  /** Heaviest working set ever logged, in kilograms — CLAUDE.md #8. */
  heaviestKg: number;
  onDate: LocalDate;
}

export interface CoachFacts {
  asOf: LocalDate;
  sessionsLast7Days: number;
  sessionsLast28Days: number;
  /** Whole percent, or null when nothing in the window has resolved. */
  adherence28dPercent: number | null;
  currentStreakDays: number;
  /** Null when nothing has been completed yet — which is not the same as zero. */
  daysSinceLastSession: number | null;
  tonnageThisWeekKg: number;
  tonnageLastWeekKg: number;
  /** Null when there is not enough history for the ratio to mean anything. */
  acwr: number | null;
  acwrBand: string;
  level: number;
  lifetimeXp: number;
  xpToNextLevel: number;
  topLifts: TopLift[];
}

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

  const weeks = tonnageByWeek(sets);
  const thisWeek = startOfWeek(today);
  const lastWeek = startOfWeek(addDays(thisWeek, -1));

  const load = acwr(sets, today);
  const level = levelProgress(lifetimeXp);

  const names = [...exerciseBests(sets)]
    .flatMap(([id, best]) =>
      best.bestWeightKg === null || best.bestWeightDate === null
        ? []
        : [
            {
              name: exerciseNames.get(id) ?? id,
              heaviestKg: best.bestWeightKg,
              onDate: best.bestWeightDate,
            },
          ]
    )
    // Heaviest first, then by name so the list is stable when two lifts tie —
    // otherwise the payload changes between identical calls and the prompt
    // cache misses for no reason.
    .sort((a, b) => b.heaviestKg - a.heaviestKg || a.name.localeCompare(b.name))
    .slice(0, MAX_TOP_LIFTS);

  const last = completed[0];

  return {
    asOf: today,
    sessionsLast7Days: within(7),
    sessionsLast28Days: within(ADHERENCE_WINDOW_DAYS),
    adherence28dPercent: rate === null ? null : Math.round(rate * 100),
    currentStreakDays: currentStreak(workouts, today),
    // daysBetween is positive when the FIRST argument is the later date, so
    // today leads. Reversed, this reports a negative age for every session.
    daysSinceLastSession: last === undefined ? null : daysBetween(today, last.localDate),
    tonnageThisWeekKg: roundKg(weeks.get(thisWeek) ?? 0),
    tonnageLastWeekKg: roundKg(weeks.get(lastWeek) ?? 0),
    // Two decimals: the ratio is read against bands at 0.8 and 1.5, and a third
    // decimal is precision the underlying estimate does not have.
    acwr: load.ratio === null ? null : Number(load.ratio.toFixed(2)),
    acwrBand: acwrBand(load.ratio),
    level: level.level,
    lifetimeXp,
    xpToNextLevel: level.toNext,
    topLifts: names,
  };
}
