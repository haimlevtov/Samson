/**
 * The equipment picker against Postgres — ADR 0029.
 *
 * Two things only a database can answer: whether the shared catalogue is
 * readable by a signed-in user, and whether the replace actually replaces
 * without letting one user touch another's rows.
 *
 * INVARIANT: the service role creates fixtures; every assertion about what a
 *            user can do runs through a user-scoped client — as in rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { equipmentCatalogue, replaceEquipment, type EquipmentTag } from '../../src/db/equipment';
import { userEquipment } from '../../src/db/exercises';
import { EQUIPMENT_TAGS } from '../../src/catalogue/equipment';
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from './helpers';

let user: TestUser;
let other: TestUser;
let tags: EquipmentTag[];

beforeAll(async () => {
  [user, other] = await Promise.all([createTestUser('equip'), createTestUser('equip-other')]);
  tags = await equipmentCatalogue(user.client);
}, 90_000);

afterAll(async () => {
  await deleteTestUsers(user, other);
});

/** Reads a user's rows with the service role, so the assertion is about truth. */
const rowsOf = async (id: string) => {
  const { data, error } = await adminClient()
    .from('user_equipment')
    .select('equipment_tag_id, max_load_kg')
    .eq('user_id', id);
  if (error) throw new Error(error.message);
  return data ?? [];
};

describe('the shared catalogue', () => {
  it('offers exactly the vocabulary the catalogue module defines', () => {
    /*
     * Read through the USER's client in beforeAll, so this is RLS being measured
     * rather than the service role.
     *
     * Pinned against `src/catalogue/equipment.ts` rather than asserted as "more
     * than zero" — FOUND IN REVIEW, where a comment claimed twelve rows and
     * nothing checked it. That module is the vocabulary the seed writes and the
     * planner's join depends on, so a row missing from the database or a slug
     * added to one side only fails here.
     */
    expect(tags.map((row) => row.slug).sort()).toEqual(
      EQUIPMENT_TAGS.map((tag) => tag.slug).sort()
    );
  });

  it('leaves out a private tag even when the caller owns it', async () => {
    /*
     * ADR 0029 §3: the picker offers `user_id is null` only.
     *
     * FOUND BY MUTATION TESTING. The first version of this case inserted a
     * private tag owned by the OTHER user and asserted it was absent — which
     * `equipment_tags_read` guarantees on its own, so removing the
     * `.is('user_id', null)` filter left the test green. It was measuring RLS,
     * not the filter.
     *
     * A tag the caller owns is the case only the filter excludes: RLS admits it
     * (`user_id = auth.uid()`), and putting it in the picker would let a
     * user-authored string into the catalogue the planner's candidate join
     * reads.
     */
    const admin = adminClient();
    const { data, error } = await admin
      .from('equipment_tags')
      .insert({ user_id: user.id, slug: `private-${Date.now()}`, name: 'Private rig' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    // RLS lets this user see it at all — otherwise the assertion below is the
    // previous version's mistake in a different costume.
    const visible = await user.client.from('equipment_tags').select('id').eq('id', data.id);
    expect(visible.data ?? [], 'RLS hid the row, so this proves nothing').toHaveLength(1);

    const seen = await equipmentCatalogue(user.client);
    expect(seen.map((row) => row.id)).not.toContain(data.id);

    const cleanup = await admin.from('equipment_tags').delete().eq('id', data.id);
    if (cleanup.error) throw new Error(cleanup.error.message);
  });
});

describe('replaceEquipment', () => {
  it('writes the selection with its ceilings, through the user own client', async () => {
    const barbell = tags.find((t) => t.slug === 'barbell');
    const dumbbell = tags.find((t) => t.slug === 'dumbbell');
    if (!barbell || !dumbbell) throw new Error('the seeded catalogue lacks barbell or dumbbell');

    await replaceEquipment(
      user.client,
      user.id,
      [
        { slug: 'barbell', maxLoadKg: null },
        { slug: 'dumbbell', maxLoadKg: 30 },
      ],
      tags
    );

    const rows = await rowsOf(user.id);
    expect(rows).toHaveLength(2);

    const byTag = new Map(rows.map((r) => [r.equipment_tag_id, r.max_load_kg]));
    // Null means no ceiling — the column's own meaning, and what `load_ceiling`
    // filters out before taking a minimum.
    expect(byTag.get(barbell.id)).toBeNull();
    expect(Number(byTag.get(dumbbell.id))).toBe(30);
  });

  it('replaces rather than adds, so a deselected item is gone', async () => {
    /*
     * Seeds its own precondition — FOUND IN REVIEW. This asserted `toHaveLength(1)`
     * after writing one item, which passes from an empty table too: it
     * demonstrated replacement only because the previous case happened to leave
     * two rows behind. A `-t` filter or a reorder made it green and vacuous.
     */
    await replaceEquipment(
      user.client,
      user.id,
      [
        { slug: 'barbell', maxLoadKg: null },
        { slug: 'dumbbell', maxLoadKg: 30 },
      ],
      tags
    );
    expect(await rowsOf(user.id)).toHaveLength(2);

    await replaceEquipment(user.client, user.id, [{ slug: 'barbell', maxLoadKg: null }], tags);

    const rows = await rowsOf(user.id);
    // The surviving row is the one that was kept, not merely "one row".
    expect(rows.map((r) => r.equipment_tag_id)).toEqual([
      tags.find((tag) => tag.slug === 'barbell')?.id,
    ]);
  });

  it('accepts an empty selection and removes everything', async () => {
    // ADR 0029: having nothing is a real answer, and it is the state every
    // non-seeded user is already in. Seeds its own precondition, so "removed"
    // is measured rather than inherited.
    await replaceEquipment(user.client, user.id, [{ slug: 'barbell', maxLoadKg: null }], tags);
    expect(await rowsOf(user.id)).toHaveLength(1);

    await replaceEquipment(user.client, user.id, [], tags);
    expect(await rowsOf(user.id)).toHaveLength(0);
  });

  it('reads back only the caller own rows', async () => {
    await replaceEquipment(user.client, user.id, [{ slug: 'barbell', maxLoadKg: 100 }], tags);
    await replaceEquipment(other.client, other.id, [{ slug: 'dumbbell', maxLoadKg: 20 }], tags);

    const mine = await userEquipment(user.client, user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.maxLoadKg).toBe(100);
  });

  it("cannot delete another user's equipment, so a replace cannot empty their room", async () => {
    /*
     * The one that matters. `replaceEquipment` deletes by `user_id`, and if that
     * filter were ever dropped the statement would still be legal SQL — RLS is
     * what stops it reaching anybody else. Asserted by asking for exactly that.
     */
    const before = await rowsOf(other.id);
    expect(before).toHaveLength(1);

    const { error } = await user.client.from('user_equipment').delete().eq('user_id', other.id);
    // PostgREST reports a delete that matched no row as a success; the proof is
    // that the row survives.
    expect(error).toBeNull();
    expect(await rowsOf(other.id)).toHaveLength(1);
  });

  it("cannot insert equipment onto another user's row", async () => {
    const tag = tags.find((row) => row.slug === 'kettlebell');
    if (!tag) throw new Error('the catalogue lacks kettlebell');

    const { error } = await user.client
      .from('user_equipment')
      .insert({ user_id: other.id, equipment_tag_id: tag.id, max_load_kg: null });

    expect(error, "a user wrote another user's equipment").not.toBeNull();
    /*
     * The CODE, not merely "an error" — FOUND IN REVIEW. `not.toBeNull()` also
     * passes for a primary-key conflict or a foreign-key failure, and with the
     * old `?? tags[0]` fallback picking whichever row sorted first that was a
     * live possibility. 42501 is insufficient_privilege, which is RLS refusing.
     */
    expect(error?.code, 'the insert failed for some reason other than RLS').toBe('42501');
  });
});

describe('the column bound', () => {
  it('refuses a ceiling above the bound even from a direct write', async () => {
    /*
     * Migration 20260912140000. The application refuses this in
     * `src/settings/equipment.ts`; `user_equipment_own` lets an authenticated
     * user POST their own rows directly, so the column has to refuse it too.
     * Two gates are defence in depth only while they both exist.
     */
    const tag = tags.find((row) => row.slug === 'barbell');
    if (!tag) throw new Error('the catalogue lacks barbell');

    await replaceEquipment(user.client, user.id, [], tags);

    const { error } = await user.client
      .from('user_equipment')
      .insert({ user_id: user.id, equipment_tag_id: tag.id, max_load_kg: 9999.99 });

    expect(error, '9999.99 became a ceiling').not.toBeNull();
    expect(error?.message).toContain('user_equipment_max_load_bounded');
  });

  it('refuses NaN, which a > 0 check admits', async () => {
    // `'NaN'::numeric > 0` is TRUE — measured against this project and recorded
    // in 20260908100100. The upper bound is what excludes it, because
    // `NaN <= 1000` is false.
    const tag = tags.find((row) => row.slug === 'barbell');
    if (!tag) throw new Error('the catalogue lacks barbell');

    const { error } = await user.client.from('user_equipment').insert({
      user_id: user.id,
      equipment_tag_id: tag.id,
      max_load_kg: 'NaN' as unknown as number,
    });

    expect(error, 'NaN became a ceiling').not.toBeNull();
    expect(error?.message).toContain('user_equipment_max_load_bounded');
  });

  it('still accepts a real ceiling, so the bound is not simply refusing everything', async () => {
    await replaceEquipment(user.client, user.id, [{ slug: 'dumbbell', maxLoadKg: 30 }], tags);
    const rows = await rowsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.max_load_kg)).toBe(30);
  });
});
