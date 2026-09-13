/**
 * Naming whose words are on the Coach tab — the Quest Log redesign.
 *
 * WHY a helper: the delivered prose now carries a name, and the obvious name —
 * whoever the menu shows right now — is wrong the moment somebody changes the
 * menu after a delivery, which the menu deliberately allows. ADR 0006 keeps the
 * coach's words and the plan's numbers apart so a reader can tell whose is whose;
 * a label naming the wrong coach undoes that. FOUND IN REVIEW.
 */

/** The name of the coach who delivered, from the slug the delivery returned. */
export function deliveredBy(
  personas: readonly { slug: string; name: string }[],
  deliveredSlug: string | null | undefined
): string {
  return personas.find((p) => p.slug === deliveredSlug)?.name ?? 'the coach';
}
