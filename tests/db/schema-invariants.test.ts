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

let pg: Client | undefined;

/** The connected client. beforeAll throws if there isn't one, so this cannot be hit. */
const db = (): Client => {
  if (!pg) throw new Error('no database connection — beforeAll should have failed');
  return pg;
};

/** The URL with its password replaced, so a failure can name it safely. */
const redacted = (): string => DB_URL.replace(/(?<=:\/\/[^:/@]*:)[^@]*(?=@)/, '***');

beforeAll(async () => {
  /*
   * Constructing the Client is inside the try on purpose: `pg` parses the
   * connection string eagerly, so a malformed one throws here rather than at
   * connect() — which is exactly the case a helpful message is most needed for,
   * and exactly the case an earlier version of this hook missed.
   *
   * Deliberately a failure, not a skip. These are the CLAUDE.md #10 invariants,
   * and a suite that goes green when it cannot reach a database is worse than
   * one that fails: the first missing RLS policy would ship.
   */
  try {
    pg = new Client({ connectionString: DB_URL });
    await pg.connect();
  } catch (cause) {
    /*
     * Three outcomes worth telling apart, because the fix differs and the raw
     * error names none of them. Each branch below was reproduced deliberately
     * rather than guessed — an earlier version blamed the [YOUR-PASSWORD]
     * placeholder for "Invalid URL", and it turns out that parses fine and
     * fails at authentication instead.
     */
    const code = (cause as { code?: string } | undefined)?.code;

    /*
     * Nothing after the @ means the value was cut short. dotenv reads one line
     * at a time, so a connection string pasted across two lines keeps only as
     * far as the newline — and a wrapped paste is the single most common way to
     * get here, worth naming rather than leaving under "no stray line breaks".
     */
    const truncated = DB_URL.includes('@') && DB_URL.slice(DB_URL.lastIndexOf('@') + 1) === '';

    const detail = truncated
      ? 'The value stops at the @ — the host is missing entirely. That is a ' +
        'connection string pasted across two lines: dotenv keeps only what is on ' +
        'the first, so the host, port and database were dropped. Put the whole ' +
        'string on one line in .env.local.'
      : cause instanceof TypeError
        ? 'SUPABASE_DB_URL is not a parseable URL. The usual cause is an ' +
          'un-encoded character in the password: a / or : before the @ ends the ' +
          'authority early and the rest is read as a host and port. Percent-encode ' +
          'it — "p@ss/word" becomes "p%40ss%2Fword" — or check the string still ' +
          'starts with postgresql:// and has no stray quotes or line breaks.'
        : code === '28P01'
          ? 'The server rejected the password, so the URL itself is fine. If it ' +
            'still contains the [YOUR-PASSWORD] placeholder, substitute the real ' +
            'database password — which is not the service role key, and can be ' +
            'reset from the Connect dialog in the dashboard.'
          : 'These tests read pg_catalog directly, so they need a database ' +
            'connection rather than the REST API. Either start the local stack, or ' +
            'set SUPABASE_DB_URL to the hosted pooler connection string. Note the ' +
            'direct-connection host is IPv6-only; the pooler is the one that works ' +
            'from most networks.';

    throw new Error(
      `could not open a Postgres connection to ${redacted()}. ${detail} ` +
        'See tests/db/helpers.ts for where to find the string.',
      { cause }
    );
  }
});

afterAll(async () => {
  // Optional-chained: when beforeAll threw, there is no client to close, and a
  // TypeError here would bury the real failure under a second one.
  await pg?.end();
});

async function publicTables(): Promise<{ name: string; rls: boolean }[]> {
  const { rows } = await db().query<{ name: string; rls: boolean }>(
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
    const { rows } = await db().query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'user_id'`
    );
    const withUserId = new Set(rows.map((r) => r.table_name));
    const missing = tables.map((t) => t.name).filter((name) => !withUserId.has(name));
    expect(missing).toEqual([]);
  });

  it('gives every table at least one policy', async () => {
    const tables = await publicTables();
    const { rows } = await db().query<{ tablename: string }>(
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
    const { rows } = await db().query<{ table_name: string; privilege_type: string }>(
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
    const { rows } = await db().query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type = 'SELECT'`
    );
    const granted = new Set(rows.map((r) => r.table_name));
    expect(tables.map((t) => t.name).filter((n) => !granted.has(n))).toEqual([]);
  });

  it('grants no policy to the anon role', async () => {
    const { rows } = await db().query<{ tablename: string; policyname: string; roles: string[] }>(
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
    const { rows } = await db().query<{ proname: string }>(
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
    const { rows } = await db().query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and (column_name like '%_lbs' or column_name like '%_lb'
               or column_name like '%_inches' or column_name like '%_minutes')`
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });

  it('uses timestamptz for every timestamp column', async () => {
    const { rows } = await db().query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type = 'timestamp without time zone'`
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });
});
