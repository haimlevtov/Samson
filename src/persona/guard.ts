/**
 * The number guard: a persona may quote the plan, never extend it.
 *
 * INVARIANT: the persona cannot alter a number — PLAN.md phase 3, ADR 0006.
 *            The schema makes that structurally true for fields; this makes it
 *            true for prose, which is free text and can say anything.
 *
 * WHY it is this strict: a number that is correct ARITHMETIC OVER the block —
 * "that is ten kilos more than last month" — is still rejected, because the
 * alternative is re-deriving the arithmetic here and inheriting invariant #1's
 * problem one level up. Who checked the checker's sum? The persona may say
 * "more than last month". It may not say how much more.
 *
 * AI-NOTE: this will occasionally reject a harmless sentence, and that is the
 *          intended direction of failure. A retry costs tokens; a coach quoting
 *          a load the plan does not contain costs trust, and the user cannot
 *          tell which of the two happened.
 */
import type { TrainingBlock } from '../planner/schema';
import type { DeliveredPlan } from './schema';

/** Matches a bare numeral, including decimals. Word forms ("three") are not numbers. */
const NUMERAL = /\d+(?:\.\d+)?/g;

/**
 * Every number the persona is allowed to say.
 *
 * Two kinds go in: values that literally appear in the block, and counts of
 * things the block contains. A count is a fact about the block's shape rather
 * than arithmetic over its values — "three sessions this week" is describing
 * what is there, not computing something new.
 */
export function blockNumbers(block: TrainingBlock): Set<number> {
  const allowed = new Set<number>();
  const add = (n: number | null | undefined): void => {
    if (typeof n === 'number' && Number.isFinite(n)) allowed.add(n);
  };

  add(block.weeks.length);

  for (const week of block.weeks) {
    add(week.week_number);
    add(week.sessions.length);

    for (const session of week.sessions) {
      // 1-based: prose says "day one", never "day zero".
      add(session.day_index + 1);
      add(session.exercises.length);

      for (const exercise of session.exercises) {
        // Both are facts about the block: how many distinct schemes, and how
        // many sets in total — "three sets" is describing it, not computing.
        add(exercise.set_groups.length);
        add(exercise.set_groups.reduce((n, g) => n + g.count, 0));

        for (const group of exercise.set_groups) {
          add(group.count);
          add(group.weight_kg);
          add(group.reps);
          add(group.rpe);
          add(group.rest_seconds);
          // Rest is commonly spoken in minutes. Only when it divides cleanly:
          // "two minutes" for 120 s is quoting, "1.75 minutes" would be doing
          // arithmetic out loud.
          if (group.rest_seconds % 60 === 0) add(group.rest_seconds / 60);
        }
      }
    }
  }

  return allowed;
}

/**
 * Every numeral in `text` that is not in `allowed`, in order of first
 * appearance and without repeats.
 *
 * WHY this is separate from the block: the coach chat needs the same check
 * against a different set of permitted numbers — ADR 0015 §4. The rule "a model
 * may quote a figure it was given and may not invent one" is the same rule in
 * both places; only the definition of "given" differs.
 */
export function findUnknownNumbers(allowed: ReadonlySet<number>, text: string): number[] {
  const unknown: number[] = [];

  for (const match of text.matchAll(NUMERAL)) {
    const value = Number(match[0]);
    if (!Number.isFinite(value)) continue;
    if (allowed.has(value)) continue;
    if (unknown.includes(value)) continue;
    unknown.push(value);
  }

  return unknown;
}

/**
 * Every number appearing in a piece of text.
 *
 * AI-NOTE: the chat builds its allowed set from the RENDERED prompt rather than
 *          from the facts object, so the set cannot drift from what the model
 *          was actually shown. That only works if the same NUMERAL pattern
 *          reads both sides, which is why this lives here beside it.
 */
export function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(NUMERAL)) {
    const value = Number(match[0]);
    if (Number.isFinite(value)) found.add(value);
  }
  return found;
}

/** Every numeral in the text that the block does not contain. */
export function findInventedNumbers(block: TrainingBlock, text: string): number[] {
  return findUnknownNumbers(blockNumbers(block), text);
}

/** Flattens a delivered plan to the text a user would actually read. */
export function deliveredText(delivered: DeliveredPlan): string {
  return [delivered.opening, ...delivered.week_notes, delivered.closing].join('\n');
}

export class InventedNumberError extends Error {
  constructor(readonly numbers: number[]) {
    super(
      `The persona used ${numbers.length} number(s) absent from the plan: ${numbers.join(', ')}. ` +
        'It may quote the plan; it may not extend it.'
    );
    this.name = 'InventedNumberError';
  }
}

/** Throws unless every numeral in the delivered prose appears in the block. */
export function assertNoInventedNumbers(block: TrainingBlock, delivered: DeliveredPlan): void {
  const invented = findInventedNumbers(block, deliveredText(delivered));
  if (invented.length > 0) throw new InventedNumberError(invented);
}
