/**
 * Template names the app generates, kept apart from the ones a user has.
 *
 * Decided in the rework plan, PR 7, and written into docs/specs/workout-templates.md
 * §6: importing a session twice is ALLOWED — templates are editable, so a user
 * may keep the coach's version beside an edited copy, and a newer plan's session
 * can share week, day and focus with an older one — but the Workout tab lists
 * templates by name alone, so two identical names could not be told apart.
 *
 * AI-NOTE: only for names the APP generates — a plan import's, and a session
 *          import's default. A name the user types is theirs and is kept as
 *          typed; do not route one through here.
 */
import { TEMPLATE_NAME_MAX } from './schema';

/**
 * `base` if nobody has it, otherwise `base (2)`, `base (3)`… — the first one
 * free, with the base cut short and marked `…` when the counter would push the
 * whole past the name bound.
 */
export function distinctName(
  base: string,
  taken: Iterable<string>,
  max: number = TEMPLATE_NAME_MAX
): string {
  const used = new Set([...taken].map((name) => name.trim()));
  const wanted = base.trim();
  if (!used.has(wanted)) return wanted;

  // Terminates: `used` is finite, so some counter is always free.
  for (let n = 2; ; n++) {
    const counter = ` (${n})`;
    const head =
      wanted.length + counter.length <= max
        ? wanted
        : `${wanted.slice(0, max - counter.length - 1).trimEnd()}…`;
    const candidate = `${head}${counter}`;
    if (!used.has(candidate)) return candidate;
  }
}
