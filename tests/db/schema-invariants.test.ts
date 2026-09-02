/**
 * Structural invariants, asserted against the live schema.
 *
 * WHY: CLAUDE.md #10 is the one invariant a single forgotten line in a future
 *      migration silently breaks — the table works fine, it is just readable by
 *      everyone. These queries make that a failing test instead of a breach.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL } from './helpers';

let pg: Client;

beforeAll(async () => {
  pg = new Client({ connectionString: DB_URL });
  try {
    await pg.connect();
  } catch (cause) {
    /*
     * Deliberately still a failure, not a skip. These are the CLAUDE.md #10
     * invariants — a suite that quietly passes when it cannot reach a database
     * is worse than one that fails, because the first missing RLS policy would
     * ship green.
     *
     * The message exists because the default is the local stack, and the most
     * common reason to land here is a workstation running against the hosted
     * project with no SUPABASE_DB_URL set. That is a one-line fix, and the raw
     * ECONNREFUSED does not say so.
     */
    throw new Error(
      `could not reach Postgres at ${DB_URL.replace(/:[^:@]*@/, ':***@')}. ` +
        'These tests read pg_catalog directly, so they need a database connection ' +
        'rather than the REST API. Either start the local stack, or set ' +
        'SUPABASE_DB_URL to the hosted pooler connection string (see tests/db/helpers.ts).',
      { cause }
    );
  }
});

afterAll(async () => {
  await pg.end();
});

async function publicTables(): Promise<{ name: string; rls: boolean }[]> {
  const { rows } = await pg.query<{ name: string; rls: boolean }>(
    `select c.relname as name, c.relrowsecurity as rls
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`
  );
  return rows;
}

describe('CLAUDE.md #10 — RLS is on for every table, and every table has user_id', () => {
  it('found the expected tables', async () => {
    const names = (await publicTables()).map((t) => t.name);
    // The full product schema exists from phase 0, even where unimplemented.
    expect(names).toEqual(
      expect.arrayContaining([
        'achievement_events',
        'achievements',
        'challenges',
        'equipment_tags',
        'exercise_equipment',
        'exercises',
        'llm_calls',
        'personas',
        'progression_nodes',
        'sets',
        'users',
        'workouts',
        'xp_events',
      ])
    );
  });

  it('enables row level security on all of them', async () => {
    const unprotected = (await publicTables()).filter((t) => !t.rls).map((t) => t.name);
    expect(unprotected).toEqual([]);
  });

  it('gives every table a user_id column', async () => {
    const tables = await publicTables();
    const { rows } = await pg.query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'user_id'`
    );
    const withUserId = new Set(rows.map((r) => r.table_name));
    const missing = tables.map((t) => t.name).filter((name) => !withUserId.has(name));
    expect(missing).toEqual([]);
  });

  it('gives every table at least one policy', async () => {
    const tables = await publicTables();
    const { rows } = await pg.query<{ tablename: string }>(
      `select distinct tablename from pg_policies where schemaname = 'public'`
    );
    const withPolicy = new Set(rows.map((r) => r.tablename));
    const missing = tables.map((t) => t.name).filter((name) => !withPolicy.has(name));
    // A table with RLS on and no policy denies everything, which fails silently
    // at runtime rather than loudly here.
    expect(missing).toEqual([]);
  });

  it('grants the anon role no DML on any table', async () => {
    // WHY: RLS and grants are separate gates. anon has no policy anywhere, so a
    //      DML grant would be dead weight that a future policy could silently
    //      turn into a public read.
    const { rows } = await pg.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'
          and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`
    );
    expect(rows.map((r) => `${r.table_name}.${r.privilege_type}`)).toEqual([]);
  });

  it('grants the authenticated role DML on every table', async () => {
    // Without this the policies above are unreachable and every query fails
    // with "permission denied" rather than returning rows.
    const tables = await publicTables();
    const { rows } = await pg.query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type = 'SELECT'`
    );
    const granted = new Set(rows.map((r) => r.table_name));
    expect(tables.map((t) => t.name).filter((n) => !granted.has(n))).toEqual([]);
  });

  it('grants no policy to the anon role', async () => {
    const { rows } = await pg.query<{ tablename: string; policyname: string; roles: string[] }>(
      `select tablename, policyname, roles from pg_policies where schemaname = 'public'`
    );
    const anonPolicies = rows
      .filter((r) => r.roles.includes('anon') || r.roles.includes('public'))
      .map((r) => `${r.tablename}.${r.policyname}`);
    expect(anonPolicies).toEqual([]);
  });
});

describe('functions pin their search_path', () => {
  it('leaves no function in public with a mutable search_path', async () => {
    // WHY: Supabase's database linter flags this as a security finding
    //      (0011_function_search_path_mutable) — a trigger can otherwise
    //      resolve a shadowed function from the caller's path.
    const { rows } = await pg.query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prokind = 'f'
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
             where cfg like 'search_path=%'
          )`
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});

describe('CLAUDE.md #8 and #9 — canonical units and UTC timestamps', () => {
  it('stores no imperial or minute-based columns', async () => {
    const { rows } = await pg.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and (column_name like '%_lbs' or column_name like '%_lb'
               or column_name like '%_inches' or column_name like '%_minutes')`
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });

  it('uses timestamptz for every timestamp column', async () => {
    const { rows } = await pg.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type = 'timestamp without time zone'`
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });
});
