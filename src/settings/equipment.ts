/**
 * What the equipment form is allowed to contain, and how a submission is read —
 * ADR 0029.
 *
 * WHY here rather than beside the queries in `src/db/equipment.ts`: this module
 * is the declared home for reading a settings submission — `src/settings/schema.ts`
 * says so, and nothing else under `src/db/` touches `FormData`. The queries are a
 * different job and stayed where they were.
 *
 * Pure: no key, no network, no database.
 */
import { z } from 'zod';

import { measurementField } from '../diet/biometrics';
import type { EquipmentTag } from '../db/equipment';

/**
 * The heaviest ceiling the form accepts, in kilograms.
 *
 * WHY a bound at all: the column is `numeric(6, 2)`, which admits **9,999.99**
 * on its own. A ceiling that large is a ceiling that never binds, and a ceiling
 * that never binds is the same as no ceiling — the protection this column exists
 * to give, quietly removed. Migration `20260912140000` carries the same bound.
 *
 * FOUND IN REVIEW: this comment used to say the bound "excludes NaN, because
 * `NaN < 1000` is false", copied from `docs/specs/diet.md` §1 where it IS the
 * mechanism. It is not the mechanism here. `measurementField` builds on
 * `z.number()`, which rejects NaN and every non-finite value itself, and the
 * grammar refuses the string long before that. The bound is about magnitude and
 * nothing else, and saying otherwise credited it with work it does not do.
 *
 * WHY 1000 and not a type-shaped number: the heaviest plate-loaded machine in a
 * commercial gym is a few hundred kilograms. This is a human bound, like the
 * biometrics', rather than the column's.
 *
 * AI-NOTE: the column carries the same bound since migration 20260912140000.
 *          They are defence in depth only while they agree — change both.
 */
export const MAX_LOAD_KG = 1000;

/**
 * One selection, validated.
 *
 * INVARIANT: the slug is checked against the catalogue by the CALLER, which
 *            holds the rows. This schema bounds the shape and the number; it
 *            cannot know which tags exist.
 */
export const equipmentSelectionSchema = z.array(
  z.strictObject({
    slug: z.string().min(1).max(64),
    /**
     * Null means no ceiling, which is the column's own meaning — ADR 0029 §1.
     * Blank becomes null, because a user who owns dumbbells and does not know
     * their heaviest is not a user whose dumbbells stop at nothing.
     *
     * INVARIANT: a non-blank value that is not a number FAILS — it does not
     *            become null. FOUND IN REVIEW, and it was fail-open on a safety
     *            rule: null means no ceiling, so "30 kg" pasted into the box
     *            (which `<input type="number">` sanitises to an empty string on
     *            its own) silently removed the cap that stops the planner
     *            prescribing 60 kg to somebody whose dumbbells stop at 30. The
     *            error message this file's caller shows already promised the
     *            stricter rule.
     *
     * INVARIANT: scale 2, matching `numeric(6, 2)`. PostgreSQL rounds to the
     *            declared scale BEFORE the CHECK runs, so `0.001` would pass a
     *            `> 0` guard here, be stored as `0.00`, and violate the column —
     *            after `replaceEquipment` had already deleted the old rows.
     *            `docs/specs/diet.md` §1 records the same trap for the
     *            biometrics, ending "two gates are defence in depth only while
     *            they agree".
     *
     * `measurementField` is that grammar, already tested. Imported from
     * `src/diet/biometrics.ts` rather than copied: it is about measurements
     * rather than about diet, and a second copy is how two gates stop agreeing.
     */
    maxLoadKg: measurementField(MAX_LOAD_KG, 'kg', 2),
  })
);

export type EquipmentSelection = z.infer<typeof equipmentSelectionSchema>;

/**
 * Reads a selection out of form data, against the catalogue that produced it.
 *
 * The form sends one `equipment` value per checked box and a `max_load_<slug>`
 * field beside it. Unknown slugs are DROPPED rather than rejected: the only way
 * to send one is to craft the request, the catalogue is the authority on what
 * exists, and failing the whole save because of one ignored value would punish
 * the wrong person.
 *
 * A blank or whitespace-only ceiling is null — no ceiling. Anything else that is
 * not a number to at most two decimal places **fails the parse**, because null
 * means no ceiling and a user who typed something did mean something by it.
 * Silently storing null would be the app deciding they meant "no limit".
 */
export function equipmentSelection(
  form: { getAll(name: string): unknown[]; get(name: string): unknown },
  tags: readonly EquipmentTag[]
): z.ZodSafeParseResult<EquipmentSelection> {
  const known = new Set(tags.map((t) => t.slug));

  const chosen = form
    .getAll('equipment')
    .filter((v): v is string => typeof v === 'string' && known.has(v));

  // A form can repeat a checkbox name; two copies of one slug would violate the
  // (user_id, equipment_tag_id) primary key on insert.
  const unique = [...new Set(chosen)];

  return equipmentSelectionSchema.safeParse(
    unique.map((slug) => {
      const raw = form.get(`max_load_${slug}`);
      // The RAW string reaches the schema, which owns the grammar. A `File` or a
      // repeated field is not a measurement, and an empty string is the one thing
      // that legitimately means "no ceiling".
      return { slug, maxLoadKg: typeof raw === 'string' ? raw : '' };
    })
  );
}
