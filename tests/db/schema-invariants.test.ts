/**
 * Structural invariants, asserted against the live schema.
 *
 * WHY: CLAUDE.md #10 is the one invariant a single forgotten line in a future
 *      migration silently breaks — the table works fine, it is just readable by
 *      everyone. These queries make that a failing test instead of a breach.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, redactDbUrl } from './helpers';
import { STAGE_MODELS } from '../../src/llm/models';
import type { LlmStage } from '../../src/llm/types';

/*
 * Every stage the code can emit, at runtime.
 *
 * WHY STAGE_MODELS and not a hand-written list: it is typed
 * `Record<LlmStage, ...>`, so the compiler already fails if a stage is missing
 * from it. A literal array here would be a third copy of the same fact and
 * would drift from the other two exactly as the constraint did.
 */
const STAGES = Object.keys(STAGE_MODELS) as LlmStage[];

let pg: Client | undefined;

/** The connected client. beforeAll throws if there isn't one, so this cannot be hit. */
const db = (): Client => {
  if (!pg) throw new Error('no database connection — beforeAll should have failed');
  return pg;
};

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
    /*
     * INVARIANT: TLS is explicit, not inherited. `pg` 8 defaults `ssl: false`
     *            (node_modules/pg/lib/defaults.js), and the pooler string in
     *            helpers.ts carries no sslmode — so before this the hosted path
     *            would happily open an unencrypted session across the public
     *            internet, authenticating as the database owner. Localhost did
     *            not care; a shared hosted project does.
     *
     * WHY local is exempt: the local stack serves a self-signed certificate and
     * a workstation talking to 127.0.0.1 has no on-path attacker to defend
     * against. Everything else is on the network.
     *
     * WHY verification is opt-in rather than always on — measured, not assumed:
     * `rejectUnauthorized: true` against the Supabase pooler fails with
     * "self-signed certificate in certificate chain". The pooler presents a
     * chain rooted in Supabase's own CA, which is not in Node's trust store, so
     * demanding verification by default would simply stop the suite running and
     * the next person would turn TLS off again to fix it.
     *
     * What this configuration does and does not buy, stated plainly rather than
     * implied: the session IS encrypted, so a passive observer sees nothing,
     * and SCRAM-SHA-256 means the password never crosses the wire in any case.
     * What remains open without verification is an ACTIVE on-path relay. Point
     * SUPABASE_CA_CERT at Supabase's CA certificate (dashboard → Database →
     * SSL configuration) and that closes too.
     *
     * AI-NOTE: do not "simplify" this to `ssl: true` or drop it. `pg` 8
     *          defaults to false, and the string in helpers.ts carries no
     *          sslmode, so removing this silently restores plaintext.
     */
    const local = /^(?:postgresql|postgres):\/\/[^@]*@?(?:localhost|127\.0\.0\.1|\[::1\])[:/]/.test(
      DB_URL
    );
    const ca = process.env['SUPABASE_CA_CERT'];

    pg = new Client({
      connectionString: DB_URL,
      ssl: local ? false : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    });
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
    /*
     * AI-NOTE: `truncated` must be tested BEFORE the TypeError branch. A URL
     *          cut off at the @ also throws TypeError at construction, so
     *          reordering these — the obvious "general case last" tidy-up —
     *          silently re-creates the percent-encoding misdiagnosis this
     *          message went through three versions to escape.
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
      `could not open a Postgres connection to ${redactDbUrl(DB_URL)}. ${detail} ` +
        'See tests/db/helpers.ts for where to find the string.',
      { cause }
    );
  }
});

afterAll(async () => {
  // When beforeAll threw there is no client to close, and a TypeError here
  // would bury the real failure under a second one.
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

  it('grants the anon role nothing at all on any table', async () => {
    /*
     * WHY: RLS and grants are separate gates. anon has no policy anywhere, so a
     * grant would be dead weight that a future policy could silently turn into
     * a public read.
     *
     * WIDENED 2026-09-08, and it is worth saying what the narrow version
     * missed. It filtered to `privilege_type in ('SELECT','INSERT','UPDATE',
     * 'DELETE')` — the same four verbs migrations 0006 and 0011 revoke — while
     * Supabase's default privileges grant seven. anon held TRUNCATE,
     * REFERENCES and TRIGGER on all eighteen tables, and this test could not
     * see them because it was written from the same assumption as the revoke.
     *
     * TRUNCATE is the one that mattered: it is not DML, so no policy filters
     * it, and every other protection in this schema is row-level. Fixed in
     * migration 20260908100200; asserted here over EVERY privilege type so the
     * next verb Supabase adds to its defaults cannot arrive unnoticed.
     */
    const { rows } = await db().query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'`
    );
    expect(rows.map((r) => `${r.table_name}.${r.privilege_type}`)).toEqual([]);
  });

  it('grants the authenticated role nothing beyond the DML it uses', async () => {
    // Same finding, lower stakes: authenticated held TRUNCATE too, which no
    // policy would have filtered either. It keeps the four verbs its policies
    // are written against and nothing else.
    const { rows } = await db().query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'authenticated'
          and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`
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

  it('lets the anon role execute no SECURITY DEFINER function', async () => {
    /*
     * WHY this exists, and why it is scoped to definer functions:
     *
     * A definer function runs with its owner's privileges and therefore steps
     * outside RLS on purpose. Every one in this schema derives its safety from
     * `auth.uid()` — award_session_xp, accept_challenge, unlocked_achievements
     * — which is NULL for a signed-out session. Each of them fails closed on
     * that, so an anon EXECUTE grant is not currently reachable damage.
     *
     * It is asserted anyway for the reason CLAUDE.md #10 gives about tables:
     * grants and policies are independent gates, and this project has already
     * shipped two grant defects that were invisible because nothing looked
     * (migrations 20260901145239 and 20260902094000). The next definer function
     * added by someone who forgets its revoke should fail here rather than
     * three months later.
     *
     * SECURITY INVOKER functions are deliberately out of scope: they run as the
     * caller and are bounded by the same RLS as a query, so a grant on one
     * grants nothing.
     */
    const { rows } = await db().query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and has_function_privilege('anon', p.oid, 'EXECUTE')`
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

describe('CLAUDE.md #3 — the ledger accepts every stage the code can emit', () => {
  /*
   * WHY this test exists: `llm_calls.stage` is a CHECK constraint, not an enum
   * derived from anything, so the TypeScript union and the database list are two
   * copies of one fact. Adding `chat` to `LlmStage` without touching the
   * constraint passed typecheck, lint and all 757 unit tests — the unit suite
   * mocks the gateway, so it never inserts a row — and then failed on the first
   * live message with "violates check constraint llm_calls_stage_check".
   *
   * Invariant #3 turns that into a hard failure rather than an unlogged call,
   * which is the right behaviour and also means a whole feature is dead until
   * the migration lands. This test is how the next stage gets caught here
   * instead.
   */
  it('admits every value of LlmStage', async () => {
    const { rows } = await db().query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'llm_calls'
          and c.conname = 'llm_calls_stage_check'`
    );

    const def = rows[0]?.def;
    expect(def, 'llm_calls_stage_check is missing entirely').toBeDefined();

    const missing = STAGES.filter((stage) => !def?.includes(`'${stage}'`));
    expect(missing, 'add these to the constraint in a migration').toEqual([]);
  });

  it('admits no stage the code cannot emit', async () => {
    // The other direction: a stage left in the constraint after being removed
    // from the union is a value nothing writes and the cost breakdown still
    // groups by.
    const { rows } = await db().query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'llm_calls'
          and c.conname = 'llm_calls_stage_check'`
    );

    const quoted = [...(rows[0]?.def ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const stray = quoted.filter((s) => s !== undefined && !STAGES.includes(s as LlmStage));
    expect(stray).toEqual([]);
  });
});

/**
 * ADR 0003, amended 2026-09-11 — a foreign key is a gate RLS does not guard.
 *
 * Postgres checks a foreign key as the REFERENCED table's owner, not under RLS,
 * so a write policy that only checks `user_id = auth.uid()` lets a user point a
 * row at somebody else's workout, template or custom exercise. It has happened
 * twice (`sets.workout_id`, then both `template_id` columns), each time with a
 * comment somewhere claiming RLS refused it.
 *
 * This reads every such foreign key from the live catalogue rather than from a
 * list, so a new table cannot arrive without an answer.
 */
describe('ADR 0003 — a write policy checks the rows its foreign keys point at', () => {
  interface ForeignKey {
    tbl: string;
    col: string;
    ref: string;
    writable: boolean;
    checked: boolean;
  }

  /*
   * Plain substring matching, deliberately not a regex. The first probe for
   * this test used a word-boundary pattern, the backslash was lost on the way
   * into node, `\b` became a BACKSPACE character, and every column read as
   * unchecked — including the one fix that already existed. A substring has no
   * escapes to lose.
   *
   * "Checked" means a write policy on the table mentions both the foreign-key
   * column and the table it references. That is a proxy — it proves the author
   * wrote a clause about that row, not that the clause is correct — so the two
   * behavioural halves live in tests/db/rls.test.ts, where alice actually tries.
   */
  const FOREIGN_KEYS = `
    with fks as (
      select con.conrelid::regclass::text as tbl,
             att.attname as col,
             con.confrelid::regclass::text as ref
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
      where con.contype = 'f'
        and con.connamespace = 'public'::regnamespace
        and att.attname <> 'user_id'
        and exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = con.confrelid::regclass::text
            and c.column_name = 'user_id'
        )
    )
    select fks.tbl, fks.col, fks.ref,
           exists (
             select 1 from pg_policies p
             where p.schemaname = 'public' and p.tablename = fks.tbl
               and p.cmd in ('ALL', 'INSERT', 'UPDATE')
           ) as writable,
           exists (
             select 1 from pg_policies p
             where p.schemaname = 'public' and p.tablename = fks.tbl
               and p.cmd in ('ALL', 'INSERT', 'UPDATE')
               and position(fks.col in coalesce(p.with_check, '')) > 0
               and position(fks.ref in coalesce(p.with_check, '')) > 0
           ) as checked
    from fks
    order by 1, 2`;

  const foreignKeys = async (): Promise<ForeignKey[]> =>
    (await db().query<ForeignKey>(FOREIGN_KEYS)).rows;

  it('recognises the one fix that predates this test', async () => {
    /*
     * The calibration. `sets_own` has checked `workout_id` since migration
     * 20260908140000; if this reports it unchecked, the matcher is broken and
     * every other verdict below means nothing — which is exactly what the
     * backspace did to the first probe.
     */
    const sets = (await foreignKeys()).find((fk) => fk.tbl === 'sets' && fk.col === 'workout_id');

    expect(sets, 'sets.workout_id is no longer a foreign key?').toBeDefined();
    expect(sets!.checked).toBe(true);
  });

  it('checks both template_id columns', async () => {
    // Migration 20260911090000. The two cases rls.test.ts proves by trying.
    const byColumn = new Map((await foreignKeys()).map((fk) => [`${fk.tbl}.${fk.col}`, fk]));

    expect(byColumn.get('workouts.template_id')?.checked).toBe(true);
    expect(byColumn.get('workout_template_items.template_id')?.checked).toBe(true);
  });

  it('leaves exactly the known unchecked columns, so a new one fails', async () => {
    /*
     * The five the rule found and this PR did not fix. Every one points at a
     * table that holds shared catalogue rows as well as user-owned ones, so the
     * right check is "yours, or a null user_id" — the same existence-oracle
     * class, and no cross-user READ today.
     *
     * Pinned rather than tolerated. Fixing one removes it from this list on
     * purpose; an unchecked column that is not listed here — the next table
     * with a foreign key and a `user_id = auth.uid()` policy — fails CI.
     *
     * Tables with no user write policy at all (achievement_events, xp_events,
     * progression_nodes since 20260908120100) are written only by definer
     * functions or not at all, so there is no policy to check and they are
     * excluded by `writable`.
     */
    const unchecked = (await foreignKeys())
      .filter((fk) => fk.writable && !fk.checked)
      .map((fk) => `${fk.tbl}.${fk.col} -> ${fk.ref}`);

    expect(unchecked).toEqual([
      'exercise_equipment.equipment_tag_id -> equipment_tags',
      'exercise_equipment.exercise_id -> exercises',
      'sets.exercise_id -> exercises',
      'user_equipment.equipment_tag_id -> equipment_tags',
      'workout_template_items.exercise_id -> exercises',
    ]);
  });
});
