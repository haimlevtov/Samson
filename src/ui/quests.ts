/**
 * How a challenge is named and drawn on Hub — the Quest Log redesign, ADR 0033.
 *
 * INVARIANT: presentation only. The title restates the spec — the same kind,
 *            target and window `evaluateChallenge` measures — and adds nothing a
 *            user could read as a different rule.
 */
import type { ChallengeSpec } from '../gamification/challenge';
import type { IconName } from './icons';

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/** A count as a word up to twenty, and as digits past it — "Twenty-five" reads worse than 25. */
function counted(n: number): string {
  return WORDS[n] ?? String(n);
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The window as a lifter would say it. */
function within(days: number): string {
  if (days === 1) return 'today';
  if (days === 7) return 'this week';
  return `in ${counted(days)} days`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * "Three sessions this week", "Eight hard sets this week", "A five-day streak".
 *
 * WHY from the spec rather than the slug: the spec is what the challenge
 * measures, and a slug is only a name somebody chose for it. A null spec — a row
 * the reader could not parse — falls back to the de-hyphenated slug, which is
 * what this page printed before the redesign.
 */
export function challengeTitle(spec: ChallengeSpec | null, slug: string): string {
  if (spec === null) return slug.replace(/-/g, ' ');

  const n = spec.target;
  const when = within(spec.window_days);
  switch (spec.kind) {
    case 'sessions':
      return capitalised(`${counted(n)} ${plural(n, 'session', 'sessions')} ${when}`);
    case 'distinct_exercises':
      return capitalised(`${counted(n)} different ${plural(n, 'exercise', 'exercises')} ${when}`);
    case 'sets_at_rpe':
      return capitalised(`${counted(n)} hard ${plural(n, 'set', 'sets')} ${when}`);
    case 'streak_days':
      // The streak is the run up to today, capped at the window — evaluateChallenge.
      return `A ${counted(n)}-day streak`;
  }
}

const UNIT: Record<ChallengeSpec['kind'], readonly [string, string]> = {
  sessions: ['session', 'sessions'],
  distinct_exercises: ['different exercise', 'different exercises'],
  sets_at_rpe: ['hard set', 'hard sets'],
  streak_days: ['kept day', 'kept days'],
};

/**
 * The line under an In play meter: "one more session closes it", or, once met,
 * that it pays on the next weekly run — ADR 0009 §4: payout is the batch's, never
 * immediate, and this sentence is where a user would otherwise assume it.
 */
export function remainingPhrase(spec: ChallengeSpec, progress: number): string {
  const left = spec.target - progress;
  if (left <= 0) return 'complete · pays on the next weekly run';
  const [one, many] = UNIT[spec.kind];
  return `${counted(left)} more ${plural(left, one, many)} closes it`;
}

/**
 * The first character of a display name, for a podium emblem.
 *
 * WHY a grapheme and not `name[0]`: a name may open with an emoji, a letter
 * carrying a combining mark, or a character outside the Basic Multilingual Plane,
 * and half of a surrogate pair renders as a replacement box on everyone else's
 * screen. The name was already clamped by `clampDisplayName`.
 */
export function initialOf(name: string): string {
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    .segment(name.trim())
    [Symbol.iterator]()
    .next().value?.segment;
  return first === undefined ? '?' : first.toLocaleUpperCase();
}

/**
 * The icon in a quest's hex. A one-day window is a sunrise whatever it asks for,
 * because "today" is the thing that distinguishes it on a list of weeklies.
 */
export function challengeIcon(spec: ChallengeSpec | null): IconName {
  if (spec === null) return 'scroll-text';
  if (spec.window_days === 1) return 'sunrise';
  switch (spec.kind) {
    case 'sessions':
      return 'dumbbell';
    case 'distinct_exercises':
      return 'shuffle';
    case 'sets_at_rpe':
      return 'flame';
    case 'streak_days':
      return 'calendar-check';
  }
}
