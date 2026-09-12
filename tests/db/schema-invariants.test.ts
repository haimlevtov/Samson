/**
 * Structural invariants, asserted against the live schema.
 *
 * WHY: CLAUDE.md #10 is the one invariant a single forgotten line in a future
 *      migration silently breaks — the table works fine, it is just readable by
 *      everyone. These queries make that a failing test instead of a breach.
 */
import { Client } from 'pg';
import { DIET_GOALS } from '../../src/diet/energy';
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

describe('ADR 0025 §6 — the device-voice machinery is gone', () => {
  it('keeps no column describing a device voice', async () => {
    /*
     * Rework PR 6d, the contract half of an expand-and-contract. `tts_voice_id`
     * (a BCP-47 language tag, despite the name) and `tts_voice_variant` picked a
     * voice out of the browser's own `speechSynthesis`; the coaches speak through
     * the gateway now, so the columns described nothing and were dropped.
     *
     * WHY assert the absence rather than trust the migration: a later migration
     * can add a column back, and an insert naming one is a runtime failure rather
     * than a type error — `personas` rows are written by migrations, which
     * TypeScript never sees. The generated types catch a column that exists and
     * should not; this catches the same thing from the database's side.
     */
    const { rows } = await db().query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'personas'
          and column_name in ('tts_voice_id', 'tts_voice_variant')`
    );
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it('still has the columns that replaced them, so this is a swap and not a loss', async () => {
    // The other half of the same fact: asserting only the absence would pass on a
    // `personas` table that had lost its voice entirely.
    const { rows } = await db().query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'personas'
          and column_name in ('tts_voice', 'tts_instructions')`
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(['tts_instructions', 'tts_voice']);
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
  /*
   * The same pairing for `users.diet_goal` — ADR 0032 §3. Its migration names
   * this precedent ("two copies of one fact, the way `llm_calls.stage` is") and
   * the first version did not follow it, so adding a fourth goal would have
   * compiled, shipped, and failed on the first save. FOUND IN REVIEW.
   */
  it('admits every value of DIET_GOALS, and none the code cannot emit', async () => {
    const { rows } = await db().query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public'
          and t.relname = 'users'
          and c.conname = 'users_diet_goal_check'`
    );

    const def = rows[0]?.def;
    expect(def, 'users_diet_goal_check is missing entirely').toBeDefined();

    const missing = DIET_GOALS.filter((goal) => !def?.includes(`'${goal}'`));
    expect(missing, 'add these to the constraint in a migration').toEqual([]);

    // The other direction: a value the constraint admits and the code cannot
    // produce is a value nothing validates on the way in.
    const admitted = [...(def?.matchAll(/'([a-z]+)'/gu) ?? [])]
      .map((m) => m[1])
      .filter((g): g is string => g !== undefined);
    const unknown = admitted.filter((goal) => !(DIET_GOALS as readonly string[]).includes(goal));
    expect(unknown, 'the constraint admits a goal no code emits').toEqual([]);
  });

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
 * three times — `sets.workout_id`, both `template_id` columns, then
 * `sets.exercise_id` — each time with a comment or a doc somewhere calling it
 * safe.
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
   * INSERT and UPDATE are judged separately, as Postgres applies them. A
   * command is checked when EVERY permissive policy that applies to it mentions
   * both the foreign-key column and the table it references — permissive
   * policies are ORed, so one without the clause reopens the gap — or when ANY
   * restrictive policy that applies to it does, restrictive policies being
   * ANDed. A column is checked when both commands are. A command no permissive
   * policy allows cannot be used at all, so it counts as checked; `writable`
   * says whether the table can be written in the first place.
   *
   * "Applies" means `for all` or that command, granted to `public` or to a role
   * whose privileges `authenticated` inherits — `pg_has_role(..., 'USAGE')`,
   * the same test Postgres uses to decide a policy applies. Where a policy has
   * no `with check`, Postgres reuses `using`, and so does this.
   *
   * FOUND IN REVIEW, three times. The first version accepted ANY one policy;
   * the second accepted a restrictive policy whatever command it covered, so a
   * `for insert` one could leave UPDATE open while this stayed green; the third
   * asked for 'MEMBER', which also counts a membership that passes on no
   * privileges. Supabase makes `authenticated` NOINHERIT, so a restrictive
   * policy for a role granted to it would have read as a check Postgres never
   * runs. None of the three changes today's answer. The first two cannot,
   * because no table this judges has more than one write policy, which is why the
   * verdict also runs over synthetic policies below. The third cannot because
   * no policy is granted to a role `authenticated` belongs to, and it has no
   * synthetic case: the cases create nothing, so there is no such role.
   *
   * It is a proxy — it proves the author wrote a clause about that row, not that
   * the clause is correct — so the behavioural halves live in
   * tests/db/rls.test.ts, where alice actually tries.
   */
  const verdict = (fks: string, policies: string): string => `
    with fks as (${fks}),
    policies as (${policies}),
    writes as (
      select p.tablename, p.permissive, p.cmd,
             coalesce(p.with_check, p.qual, '') as check_text
      from policies p
      where p.cmd in ('ALL', 'INSERT', 'UPDATE')
        and (
          'public' = any (p.roles)
          or exists (
            select 1 from unnest(p.roles) as r (role)
            -- WHY CASE, not AND: pg_has_role raises on public, which is not a
            -- real role, and AND does not promise to test its left side first.
            where case when r.role = 'public' then false
                       else pg_has_role('authenticated', r.role, 'USAGE') end
          )
        )
    )
    select fks.tbl, fks.col, fks.ref,
           exists (select 1 from writes w where w.tablename = fks.tbl) as writable,
           not exists (
             select 1 from (values ('INSERT'), ('UPDATE')) as c (cmd)
             where not (
               exists (
                 select 1 from writes w
                 where w.tablename = fks.tbl and w.cmd in ('ALL', c.cmd)
                   and w.permissive = 'RESTRICTIVE'
                   and position(fks.col in w.check_text) > 0
                   and position(fks.ref in w.check_text) > 0
               )
               or not exists (
                 select 1 from writes w
                 where w.tablename = fks.tbl and w.cmd in ('ALL', c.cmd)
                   and w.permissive = 'PERMISSIVE'
                   and not (
                     position(fks.col in w.check_text) > 0
                     and position(fks.ref in w.check_text) > 0
                   )
               )
             )
           ) as checked
    from fks
    order by 1, 2`;

  const LIVE = verdict(
    `select con.conrelid::regclass::text as tbl,
            att.attname::text as col,
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
       )`,
    `select p.tablename::text as tablename, p.permissive, p.cmd, p.roles, p.with_check, p.qual
     from pg_policies p
     where p.schemaname = 'public'`
  );

  /*
   * One table, `probe`, with a foreign key `thing_id -> things`, and policies
   * that exist only in the query's parameters: nothing is created, so this runs
   * the same on a fresh stack and on hosted.
   */
  const SYNTHETIC = verdict(
    `select 'probe'::text as tbl, 'thing_id'::text as col, 'things'::text as ref`,
    `select 'probe'::text as tablename, x.permissive, x.cmd, x.roles::name[] as roles,
            x.with_check, x.qual
     from jsonb_to_recordset($1::jsonb)
       as x (permissive text, cmd text, roles text[], with_check text, qual text)`
  );

  const foreignKeys = async (): Promise<ForeignKey[]> => (await db().query<ForeignKey>(LIVE)).rows;

  it('recognises the one fix that predates this test', async () => {
    /*
     * The calibration. `sets_own` has checked `workout_id` since migration
     * 20260908140000; if this reports it unchecked, the matcher is broken and
     * every other verdict below means nothing — which is exactly what the
     * backspace did to the first probe.
     */
    const sets = (await foreignKeys()).find((fk) => fk.tbl === 'sets' && fk.col === 'workout_id');

    expect(sets, 'sets.workout_id is no longer a foreign key?').toBeDefined();
    // Writable too: a command no policy allows counts as checked, so a role
    // filter that dropped every policy would otherwise pass here.
    expect(sets!.writable).toBe(true);
    expect(sets!.checked).toBe(true);
  });

  interface SyntheticPolicy {
    permissive: 'PERMISSIVE' | 'RESTRICTIVE';
    cmd: 'ALL' | 'INSERT' | 'UPDATE' | 'SELECT';
    roles: string[];
    with_check: string | null;
    qual: string | null;
  }

  // CLAUSE names the column and the table it references; BARE names neither.
  const CLAUSE =
    'exists (select 1 from public.things t where t.id = probe.thing_id and t.user_id = auth.uid())';
  const BARE = '(user_id = auth.uid())';

  const policy = (over: Partial<SyntheticPolicy> = {}): SyntheticPolicy => ({
    permissive: 'PERMISSIVE',
    cmd: 'ALL',
    roles: ['authenticated'],
    with_check: CLAUSE,
    qual: null,
    ...over,
  });

  const restrictive = (cmd: SyntheticPolicy['cmd']): SyntheticPolicy =>
    policy({ permissive: 'RESTRICTIVE', cmd });

  const readOnly = policy({ cmd: 'SELECT', with_check: null, qual: BARE });

  /*
   * The verdict itself, so the first two rules review rejected cannot quietly
   * return. The second and fourth cases are those two: each reads checked
   * under the weaker rule.
   */
  it.each<[string, SyntheticPolicy[], { writable: boolean; checked: boolean }]>([
    ['one permissive policy with the clause', [policy()], { writable: true, checked: true }],
    [
      'two permissive policies, the clause on only one',
      [policy(), policy({ with_check: BARE })],
      { writable: true, checked: false },
    ],
    [
      'a restrictive policy for all with the clause',
      [policy({ with_check: BARE }), restrictive('ALL')],
      { writable: true, checked: true },
    ],
    [
      'a restrictive policy for INSERT alone, which leaves UPDATE open',
      [policy({ with_check: BARE }), restrictive('INSERT')],
      { writable: true, checked: false },
    ],
    [
      'restrictive policies for INSERT and for UPDATE',
      [policy({ with_check: BARE }), restrictive('INSERT'), restrictive('UPDATE')],
      { writable: true, checked: true },
    ],
    [
      'the clause in using only, under a narrower check',
      [policy({ with_check: BARE, qual: CLAUSE })],
      { writable: true, checked: false },
    ],
    [
      'no with check, so Postgres reuses using',
      [policy({ with_check: null, qual: CLAUSE })],
      { writable: true, checked: true },
    ],
    [
      'the unchecked policy granted to anon only',
      [policy(), policy({ with_check: BARE, roles: ['anon'] })],
      { writable: true, checked: true },
    ],
    [
      'the unchecked policy granted to public, which is everybody',
      [policy(), policy({ with_check: BARE, roles: ['public'], cmd: 'INSERT' })],
      { writable: true, checked: false },
    ],
    [
      'an INSERT policy and no UPDATE policy, so no update can happen',
      [policy({ cmd: 'INSERT' }), readOnly],
      { writable: true, checked: true },
    ],
    ['no write policy at all', [readOnly], { writable: false, checked: true }],
  ])('judges %s', async (_label, policies, expected) => {
    const { rows } = await db().query<ForeignKey>(SYNTHETIC, [JSON.stringify(policies)]);

    expect(rows).toHaveLength(1);
    expect({ writable: rows[0]!.writable, checked: rows[0]!.checked }).toEqual(expected);
  });

  it('checks both template_id columns and both exercise_id columns', async () => {
    // Migrations 20260911090000 and 20260911100000 — the cases rls.test.ts
    // proves by trying.
    const byColumn = new Map((await foreignKeys()).map((fk) => [`${fk.tbl}.${fk.col}`, fk]));

    for (const column of [
      'workouts.template_id',
      'workout_template_items.template_id',
      'sets.exercise_id',
      'workout_template_items.exercise_id',
    ]) {
      expect(byColumn.get(column)?.checked, column).toBe(true);
    }
  });

  it('leaves exactly the known unchecked columns, so a new one fails', async () => {
    /*
     * The three the rule found and PR #43 did not fix — ADR 0003, amended.
     *
     *   - `exercise_equipment.exercise_id` and `.equipment_tag_id`: linking to
     *     another user's custom exercise or tag — the cross-user half — closes
     *     with the same own-or-shared check as 20260911100000, a policy. The
     *     primary key is (exercise_id, equipment_tag_id) with no user_id, so
     *     one user's link also occupies that pair for everybody and the
     *     duplicate-key error says so; that half is a key change.
     *   - `user_equipment.equipment_tag_id`: user_id is in its key and the key
     *     cascades on delete, which leaves only the existence oracle.
     *
     * FOUND IN REVIEW: this list first held five, and this comment called all
     * five "the same existence-oracle class, and no cross-user READ today".
     * `sets.exercise_id` was a read, through `five-patterns` inside the
     * `security definer` evaluator. It is closed now, with
     * `workout_template_items.exercise_id`.
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
      'user_equipment.equipment_tag_id -> equipment_tags',
    ]);
  });
});
