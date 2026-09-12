/**
 * Which coach a surface opens on — ADR 0031 §5, and the column PR 8 added.
 *
 * §5 settles for "the first shared, voiced coach alphabetically" and says why
 * that is a settle rather than a decision: the choice had nowhere to be stored.
 * `users.persona_slug` is where it lives now, and this is the one place that
 * decides what to do with it.
 *
 * Pure, and here rather than inline in the component, because the interesting
 * case is the one a component cannot be asked about: a stored slug that names no
 * listed coach. That is not defensive — `is_active = false` retires a coach
 * without deleting the row, so the column can outlive what it points at, which
 * is also why it carries no foreign key.
 */

/**
 * The slug to start on: the stored choice when it is still on offer, otherwise
 * the first coach listed, otherwise nothing.
 *
 * INVARIANT: the ORDER of `listed` is the caller's — `listPersonas` orders by
 *            name — so "the first" means whatever the picker shows first. This
 *            function does not sort; a second ordering would be a second answer
 *            to a question ADR 0031 §5 already settled.
 */
export function openingCoach(listed: readonly string[], chosen: string | null): string {
  if (chosen !== null && listed.includes(chosen)) return chosen;
  return listed[0] ?? '';
}
