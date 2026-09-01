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

/** Every numeral in the text that the block does not contain. */
export function findInventedNumbers(block: TrainingBlock, text: string): number[] {
  const allowed = blockNumbers(block);
  const invented: number[] = [];

  for (const match of text.matchAll(NUMERAL)) {
    const value = Number(match[0]);
    if (!Number.isFinite(value)) continue;
    if (allowed.has(value)) continue;
    if (invented.includes(value)) continue;
    invented.push(value);
  }

  return invented;
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
