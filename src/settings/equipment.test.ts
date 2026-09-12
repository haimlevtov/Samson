/**
 * What a selection may be, and how a submission is read — ADR 0029.
 *
 * Pure: no key, no network, no database.
 *
 * The reader is the only user input on the path to `user_equipment`, and that
 * table decides which exercises exist for a user at all (invariant #5), so this
 * is the file that has to be strict.
 */
import { describe, expect, it } from 'vitest';
import { MAX_LOAD_KG, equipmentSelection, equipmentSelectionSchema } from './equipment';
import { replaceEquipment } from '../db/equipment';

const TAGS = [
  { id: 'id-barbell', slug: 'barbell', name: 'Barbell' },
  { id: 'id-dumbbell', slug: 'dumbbell', name: 'Dumbbell' },
  { id: 'id-bodyweight', slug: 'bodyweight', name: 'Bodyweight' },
];

/** A FormData-shaped stand-in, so the reader is testable without a request. */
const form = (entries: [string, string][]) => ({
  get: (name: string) => entries.find(([k]) => k === name)?.[1],
  getAll: (name: string) => entries.filter(([k]) => k === name).map(([, v]) => v),
});

describe('equipmentSelection', () => {
  it('reads the checked tags and their ceilings', () => {
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['equipment', 'dumbbell'],
        ['max_load_barbell', '180'],
        ['max_load_dumbbell', '30'],
      ]),
      TAGS
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual([
      { slug: 'barbell', maxLoadKg: 180 },
      { slug: 'dumbbell', maxLoadKg: 30 },
    ]);
  });

  it('reads a blank ceiling as null, which means no ceiling', () => {
    /*
     * The column's own meaning — ADR 0029 §1. Null, never 0: a user who owns
     * dumbbells and does not know their heaviest is not a user whose dumbbells
     * stop at nothing, and `load_ceiling` takes the minimum of the non-null
     * ceilings.
     */
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['max_load_barbell', ''],
      ]),
      TAGS
    );

    expect(parsed.data).toEqual([{ slug: 'barbell', maxLoadKg: null }]);
  });

  it('reads whitespace and an absent field as null too', () => {
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['max_load_barbell', '   '],
        ['equipment', 'bodyweight'],
      ]),
      TAGS
    );

    expect(parsed.data).toEqual([
      { slug: 'barbell', maxLoadKg: null },
      { slug: 'bodyweight', maxLoadKg: null },
    ]);
  });

  it('drops a slug the catalogue does not have', () => {
    /*
     * The catalogue is the authority on what exists — ADR 0029 §3. Dropped
     * rather than rejected: the only way to send one is to craft the request,
     * and failing the whole save over an ignored value punishes the wrong
     * person. What matters is that it reaches no insert.
     */
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['equipment', 'hydraulic-press'],
      ]),
      TAGS
    );

    expect(parsed.data).toEqual([{ slug: 'barbell', maxLoadKg: null }]);
  });

  it('deduplicates a repeated checkbox, which would break the primary key', () => {
    // `(user_id, equipment_tag_id)` is the primary key, so two copies of one
    // slug would fail the insert — after the delete had already run.
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['equipment', 'barbell'],
      ]),
      TAGS
    );

    expect(parsed.data).toHaveLength(1);
  });

  it('accepts an empty selection, because having nothing is a real answer', () => {
    const parsed = equipmentSelection(form([]), TAGS);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual([]);
  });

  it('refuses a ceiling above the human bound, rather than storing null', () => {
    /*
     * A user who typed 99999 meant something by it, and silently storing null
     * would be the app deciding they did not — it would also mean no ceiling,
     * which is the opposite of what they said.
     */
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['max_load_barbell', String(MAX_LOAD_KG + 1)],
      ]),
      TAGS
    );

    expect(parsed.success).toBe(false);
  });

  it('refuses zero and a negative ceiling', () => {
    // Zero would fail the column's own CHECK; failing here names the field
    // instead of surfacing a constraint name.
    for (const bad of ['0', '-30']) {
      const parsed = equipmentSelection(
        form([
          ['equipment', 'barbell'],
          ['max_load_barbell', bad],
        ]),
        TAGS
      );
      expect(parsed.success, bad).toBe(false);
    }
  });

  it.each([
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['a number with a unit on it', '30 kg'],
    ['a decimal comma', '30,5'],
    ['a word', 'heavy'],
    ['three decimal places', '30.555'],
    ['a value the column would round to zero', '0.001'],
  ])('REFUSES %s rather than reading it as "no ceiling"', (_name, raw) => {
    /*
     * THE FINDING THIS PR WAS CORRECTED FOR, and the first version of these two
     * cases blessed the bug: an unparseable ceiling became null, and null means
     * NO CEILING — so a mistyped cap silently removed the protection that stops
     * the planner prescribing 60 kg to somebody whose dumbbells stop at 30.
     *
     * Three of these are reachable without a crafted request. '30 kg' and '30,5'
     * are what a person types; '0.001' is what `numeric(6, 2)` rounds to 0.00,
     * violating the column's own `> 0` — after the delete had already run.
     */
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['max_load_barbell', raw],
      ]),
      TAGS
    );

    expect(parsed.success, raw).toBe(false);
  });

  it('accepts two decimal places, which is the column scale', () => {
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['max_load_barbell', '32.55'],
      ]),
      TAGS
    );
    expect(parsed.data).toEqual([{ slug: 'barbell', maxLoadKg: 32.55 }]);
  });
});

describe('equipmentSelectionSchema', () => {
  it('refuses a field the form did not have', () => {
    // strictObject, for a direct caller: the reader builds its own objects, so
    // this is the guard for anything that bypasses it.
    const parsed = equipmentSelectionSchema.safeParse([
      { slug: 'barbell', maxLoadKg: null, tagId: 'smuggled' },
    ]);
    expect(parsed.success).toBe(false);
  });

  it('refuses an empty slug', () => {
    expect(equipmentSelectionSchema.safeParse([{ slug: '', maxLoadKg: null }]).success).toBe(false);
  });
});

describe('replaceEquipment, before it touches the database', () => {
  it('throws on a selection naming a tag outside the catalogue, before any write', async () => {
    /*
     * FOUND IN REVIEW: the id lookup used to sit AFTER the delete behind a
     * non-null assertion, so a caller whose selection and `tags` disagreed would
     * empty the user's equipment and then fail the insert — leaving them with
     * nothing and unable to be given a plan at all.
     *
     * Unreachable from `saveEquipment`, which filters the selection against the
     * same array. Reachable from a test, and from the next caller.
     *
     * The stub counts calls: the assertion is that the database was never
     * touched, not merely that the function threw.
     */
    let touched = 0;
    const db = {
      from() {
        touched += 1;
        throw new Error('replaceEquipment reached the database');
      },
    } as unknown as Parameters<typeof replaceEquipment>[0];

    await expect(
      replaceEquipment(db, 'u1', [{ slug: 'hydraulic-press', maxLoadKg: null }], TAGS)
    ).rejects.toThrow(/not in the catalogue/);

    expect(touched, 'the delete ran before the selection was resolved').toBe(0);
  });
});
