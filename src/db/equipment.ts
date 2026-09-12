/**
 * The equipment a user says they have — ADR 0029.
 *
 * Two halves on purpose. `equipmentSelection` is pure and is where the rules
 * about what a selection may be live; the reader and the writer below are the
 * only things that touch Postgres.
 *
 * INVARIANT: RLS scopes every statement here to the caller — CLAUDE.md #10.
 *            `user_equipment_own` is `for all to authenticated` with
 *            `user_id = auth.uid()` on both `using` and `with check`, and the
 *            catalogue read is filtered to shared rows. No service role.
 */
import { z } from 'zod';

import type { Db } from './client';

/** One row of the shared catalogue, as the picker renders it. */
export interface EquipmentTag {
  id: string;
  slug: string;
  name: string;
}

/** What the user currently has, as the picker pre-fills it. */
export interface OwnedEquipment {
  tagId: string;
  maxLoadKg: number | null;
}

/**
 * The heaviest ceiling the form accepts, in kilograms.
 *
 * WHY a bound at all: `max_load_kg` is `numeric` and PostgREST casts the JSON
 * string `"NaN"` into a numeric column on the way in, where `NaN > 0` is TRUE —
 * the trap `docs/specs/diet.md` §1 records for the biometrics. An upper bound
 * excludes NaN, because `NaN < 1000` is false, and bounds the magnitude at the
 * same time.
 *
 * WHY 1000 and not a type-shaped number: the heaviest plate-loaded machine in a
 * commercial gym is a few hundred kilograms. This is a human bound, like the
 * biometrics', rather than the column's.
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
     * Blank in the form becomes null here rather than 0, because a user who
     * owns dumbbells and does not know their heaviest is not a user whose
     * dumbbells stop at nothing.
     */
    maxLoadKg: z.number().positive().max(MAX_LOAD_KG).nullable(),
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
 * A blank, whitespace-only or unparseable ceiling is null — no ceiling. A
 * ceiling outside the bound fails the parse, because a user who typed 99999 did
 * mean something by it and silently storing null would be the app deciding they
 * did not.
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
      const text = typeof raw === 'string' ? raw.trim() : '';
      const parsed = text === '' ? null : Number(text);

      return {
        slug,
        maxLoadKg: parsed === null || !Number.isFinite(parsed) ? null : parsed,
      };
    })
  );
}

/**
 * The shared catalogue, twelve rows.
 *
 * INVARIANT: `user_id is null` — the shared rows only. A user may own private
 *            tags by RLS and nothing in the app creates them; offering one would
 *            put a user-authored string into the catalogue the planner's
 *            candidate join reads. ADR 0029 §3.
 */
export async function equipmentCatalogue(db: Db): Promise<EquipmentTag[]> {
  const { data, error } = await db
    .from('equipment_tags')
    .select('id, slug, name')
    .is('user_id', null)
    .order('name');

  if (error) throw new Error(`reading equipment_tags: ${error.message}`);
  return data ?? [];
}

/** What this user currently owns. RLS scopes it; no `user_id` filter is needed. */
export async function ownedEquipment(db: Db): Promise<OwnedEquipment[]> {
  const { data, error } = await db.from('user_equipment').select('equipment_tag_id, max_load_kg');

  if (error) throw new Error(`reading user_equipment: ${error.message}`);

  return (data ?? []).map((row) => ({
    tagId: row.equipment_tag_id,
    maxLoadKg: row.max_load_kg === null ? null : Number(row.max_load_kg),
  }));
}

/**
 * Replaces this user's equipment with the selection.
 *
 * INVARIANT: DELETE first, then INSERT — ADR 0029 §2, and the order is the
 *            decision. PostgREST gives no transaction across the two, so one can
 *            land without the other. Failing after the delete leaves the user
 *            with less equipment than they chose, which the planner reports.
 *            Failing after an insert-first would leave them with equipment they
 *            just removed, and the planner would then prescribe a lift they
 *            cannot do — the exact harm the equipment filter exists to prevent.
 *
 * An empty selection is allowed and deletes everything. It is the honest way to
 * say "I have nothing", and it is the state every non-seeded user is already in.
 */
export async function replaceEquipment(
  db: Db,
  userId: string,
  selection: EquipmentSelection,
  tags: readonly EquipmentTag[]
): Promise<void> {
  const idBySlug = new Map(tags.map((t) => [t.slug, t.id]));

  const { error: cleared } = await db.from('user_equipment').delete().eq('user_id', userId);
  if (cleared) throw new Error(`clearing user_equipment: ${cleared.message}`);

  if (selection.length === 0) return;

  const rows = selection.map((item) => ({
    user_id: userId,
    // Non-null: the caller filtered the selection against these same tags.
    equipment_tag_id: idBySlug.get(item.slug)!,
    max_load_kg: item.maxLoadKg,
  }));

  const { error: written } = await db.from('user_equipment').insert(rows);
  if (written) throw new Error(`writing user_equipment: ${written.message}`);
}
