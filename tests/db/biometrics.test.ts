/**
 * The bounds on the four biometric columns — 20260909120000_user_biometrics_bounds.sql.
 *
 * WHY these need a database rather than a unit test. `src/diet/biometrics.ts`
 * rejects the same values at the app boundary and is unit-tested there, but a
 * CHECK constraint is a second, independent gate: it also covers a value
 * arriving by a path that skips the form — PostgREST is reachable with any
 * user's own token, and `users` is writable by its owner. Asserting the app
 * layer proves nothing about the column.
 *
 * The case that matters most is NaN, and it is the reason this file exists at
 * all. `'NaN'::numeric > 0` is TRUE in PostgreSQL, so the original
 * `check (bodyweight_kg > 0)` admitted it, and PostgREST casts the JSON string
 * "NaN" into the column on the way in. A NaN bodyweight propagates through
 * Math.min and Math.max, so the clamp does not stop it, and a NaN target is not
 * null, so the missing-biometric refusal does not fire either.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, deleteTestUser, type TestUser } from './helpers';

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser('biometrics');
}, 60_000);

afterAll(async () => {
  await deleteTestUser(user);
});

/** Writes one column as this user, and reports whether the database took it. */
async function write(column: string, value: unknown): Promise<string | null> {
  const { error } = await user.client
    .from('users')
    // The column name is a literal from the cases below, never user input.
    .update({ [column]: value } as never)
    .eq('user_id', user.id);
  return error?.message ?? null;
}

describe('bodyweight_kg', () => {
  it('takes a real weight', async () => {
    expect(await write('bodyweight_kg', 82.5)).toBeNull();
  });

  it('rejects NaN, which `> 0` alone admitted', async () => {
    // The string form is what PostgREST casts in — the shape an attacker sends,
    // not one the Supabase client would produce from a JS number.
    expect(await write('bodyweight_kg', 'NaN')).not.toBeNull();
  });

  it('rejects zero and negatives', async () => {
    expect(await write('bodyweight_kg', 0)).not.toBeNull();
    expect(await write('bodyweight_kg', -1)).not.toBeNull();
  });

  it('rejects a magnitude no person has', async () => {
    // 9999.99 is what numeric(6, 2) admits and what the old constraint allowed:
    // a BMR near 162,000 kcal. The heaviest person recorded was 635 kg.
    expect(await write('bodyweight_kg', 9999.99)).not.toBeNull();
    expect(await write('bodyweight_kg', 1000)).not.toBeNull();
    expect(await write('bodyweight_kg', 635)).toBeNull();
  });

  it('takes null, because clearing a biometric is a real action', async () => {
    expect(await write('bodyweight_kg', null)).toBeNull();
  });
});

describe('height_cm', () => {
  it('takes a real height and rejects NaN', async () => {
    expect(await write('height_cm', 183)).toBeNull();
    expect(await write('height_cm', 'NaN')).not.toBeNull();
  });

  it('rejects zero, negatives and impossible magnitudes', async () => {
    expect(await write('height_cm', 0)).not.toBeNull();
    expect(await write('height_cm', -1)).not.toBeNull();
    expect(await write('height_cm', 9999.9)).not.toBeNull();
    // The tallest person recorded was 272 cm.
    expect(await write('height_cm', 272)).toBeNull();
  });

  it('takes null', async () => {
    expect(await write('height_cm', null)).toBeNull();
  });
});

describe('birth_date', () => {
  it('takes a real date', async () => {
    expect(await write('birth_date', '1995-07-02')).toBeNull();
  });

  /*
   * This column shipped with NO constraint at all, and it is the one ADR 0024 §6
   * gates the under-18 refusal on. A year-3000 date produced a negative age,
   * which tripped that refusal by accident rather than by design — and the
   * accident reverses the moment anybody writes Math.abs into the age helper.
   */
  it('rejects a date centuries away, which used to be accepted', async () => {
    expect(await write('birth_date', '3000-01-01')).not.toBeNull();
    expect(await write('birth_date', '1899-12-31')).not.toBeNull();
  });

  /*
   * The bound is a literal, not `current_date`, so tomorrow is accepted HERE and
   * refused by the action instead. That is deliberate: a CHECK holding
   * current_date evaluates in the server's timezone, which CLAUDE.md #9 forbids
   * for calendar logic, and never rechecks existing rows.
   *
   * The split is the point — this test records where each half lives, so that
   * removing the app-side check does not look safe.
   */
  it('leaves "not in the future" to the action, on purpose', async () => {
    expect(await write('birth_date', '2099-12-31')).toBeNull();
  });

  it('takes null', async () => {
    expect(await write('birth_date', null)).toBeNull();
  });
});

describe('sex', () => {
  it('admits exactly the three the application knows', async () => {
    for (const value of ['male', 'female', 'unspecified']) {
      expect(await write('sex', value), value).toBeNull();
    }
  });

  it('rejects anything else, so `isSex` never sees an unknown constant', async () => {
    expect(await write('sex', 'other')).not.toBeNull();
    expect(await write('sex', 'Male')).not.toBeNull();
  });

  it('takes null', async () => {
    expect(await write('sex', null)).toBeNull();
  });
});
