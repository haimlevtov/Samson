/**
 * What a selection may be — ADR 0029. Pure: no key, no network, no database.
 *
 * The reader is the only user input on the path to `user_equipment`, and that
 * table decides which exercises exist for a user at all (invariant #5), so this
 * is the file that has to be strict.
 */
import { describe, expect, it } from 'vitest';
import { MAX_LOAD_KG, equipmentSelection, equipmentSelectionSchema } from './equipment';

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

  it('reads NaN as null rather than letting it reach a numeric column', () => {
    /*
     * `'NaN' > 0` is TRUE in PostgreSQL and PostgREST casts the JSON string into
     * a numeric column — the trap `docs/specs/diet.md` §1 records for the
     * biometrics. `Number.isFinite` catches it here; `MAX_LOAD_KG` catches it
     * again in the schema, because `NaN < 1000` is false.
     */
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['max_load_barbell', 'NaN'],
      ]),
      TAGS
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual([{ slug: 'barbell', maxLoadKg: null }]);
  });

  it('reads Infinity as null too', () => {
    const parsed = equipmentSelection(
      form([
        ['equipment', 'barbell'],
        ['max_load_barbell', 'Infinity'],
      ]),
      TAGS
    );
    expect(parsed.data).toEqual([{ slug: 'barbell', maxLoadKg: null }]);
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
