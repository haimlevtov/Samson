/**
 * The equipment a user says they have — ADR 0029.
 *
 * The queries only. What a submission may contain, and how it is read, is
 * `src/settings/equipment.ts` — the module this project already uses for that.
 *
 * INVARIANT: RLS scopes every statement here to the caller — CLAUDE.md #10.
 *            `user_equipment_own` is `for all to authenticated` with
 *            `user_id = auth.uid()` on both `using` and `with check`, and the
 *            catalogue read is filtered to shared rows. No service role.
 */
import type { EquipmentSelection } from '../settings/equipment';
import type { Db } from './client';

/** One row of the shared catalogue, as the picker renders it. */
export interface EquipmentTag {
  id: string;
  slug: string;
  name: string;
}

/**
 * The shared catalogue.
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

/*
 * `ownedEquipment` was here and is gone. `userEquipment` in `./exercises.ts`
 * already reads the same two columns of the same table, and the two disagreed
 * about the column's runtime type — this one cast it with `Number()`, that one
 * passes it through, and only one can be right.
 *
 * MEASURED against the hosted project: PostgREST returns `numeric` as a JSON
 * NUMBER, which is what `src/db/types.ts` says too. So the cast was noise
 * contradicting the generated type, and the pass-through was correct. One reader
 * now, which is what `exercises.ts`'s own header asks for — "one definition of
 * 'can this user do this'". FOUND IN REVIEW.
 */

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

  /*
   * EVERYTHING THAT CAN FAIL HAPPENS BEFORE THE DELETE — FOUND IN REVIEW.
   *
   * The id resolution used to sit after it behind a non-null assertion, so a
   * caller whose selection and `tags` disagreed would delete the user's rows and
   * then fail the insert, leaving them with nothing. That is unreachable from
   * `saveEquipment` — one request, one `tags` array, and the selection is
   * filtered against it — but the signature does not say so, and the tests call
   * this function directly.
   *
   * Resolving first makes the pairing mechanical rather than a comment.
   */
  const rows = selection.map((item) => {
    const tagId = idBySlug.get(item.slug);
    if (tagId === undefined) {
      throw new Error(`equipment selection names a tag that is not in the catalogue: ${item.slug}`);
    }
    return { user_id: userId, equipment_tag_id: tagId, max_load_kg: item.maxLoadKg };
  });

  const { error: cleared } = await db.from('user_equipment').delete().eq('user_id', userId);
  if (cleared) throw new Error(`clearing user_equipment: ${cleared.message}`);

  if (rows.length === 0) return;

  const { error: written } = await db.from('user_equipment').insert(rows);
  if (written) throw new Error(`writing user_equipment: ${written.message}`);
}
