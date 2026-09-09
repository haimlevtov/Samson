/**
 * Resolves every DOI in the evidence table against the DOI Handle API.
 *
 *   npm run verify:doi
 *
 * The third of the three checks ADR 0023 splits the acceptance criterion into.
 * It is the only one that reaches the network, which is why it is a script and
 * its own CI job rather than part of `npm test` — `verify.yml`'s unit job has no
 * network by design, and a registry being down must not block a PR that never
 * touched this table.
 *
 * INVARIANT: this proves a DOI is REGISTERED. It does not prove the paper says
 *            what the row claims — ADR 0023 opens with three DOIs that resolve
 *            perfectly and are about a powerlifting obituary, sprint training
 *            and carcinoma cells. The title is printed on every line so the
 *            person running this can do the half no machine does.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { isDoi } from '../src/evidence/doi';
import { supabaseUrl } from '../src/db/client';
import type { Database } from '../src/db/types';

config({ path: '.env.local', quiet: true });

/** The handle registry, which is the authority on whether a DOI exists. */
const HANDLE_API = 'https://doi.org/api/handles/';

/** Politeness, and a bound on a job that talks to somebody else's server. */
const DELAY_MS = 250;
const TIMEOUT_MS = 15_000;

interface Row {
  slug: string;
  supplement: string;
  doi: string;
  source_title: string;
}

function adminClient() {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');
  return createClient<Database>(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * `responseCode` 1 means the handle is registered. Anything else — 100 for "not
 * found", 200 for "no values" — is a failure, and so is a non-200 HTTP status.
 */
async function resolves(doi: string): Promise<{ ok: boolean; detail: string }> {
  const response = await fetch(`${HANDLE_API}${encodeURIComponent(doi)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });

  if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };

  const body = (await response.json()) as { responseCode?: number };
  if (body.responseCode !== 1) return { ok: false, detail: `responseCode ${body.responseCode}` };

  return { ok: true, detail: 'registered' };
}

async function main(): Promise<void> {
  const { data, error } = await adminClient()
    .from('supplement_evidence')
    .select('slug, supplement, doi, source_title')
    .is('user_id', null)
    .order('display_order', { ascending: true });

  if (error) throw new Error(`reading supplement_evidence: ${error.message}`);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) throw new Error('no evidence rows — has the migration been applied?');

  console.log(`Resolving ${rows.length} DOI(s) against ${HANDLE_API}\n`);

  const failures: string[] = [];

  for (const row of rows) {
    // Format first, so a malformed value is reported as malformed rather than
    // as a network failure. The same check `npm test` runs offline.
    if (!isDoi(row.doi)) {
      failures.push(`${row.slug}: ${row.doi} is not shaped like a DOI`);
      console.log(`  FAIL  ${row.slug.padEnd(30)} ${row.doi} — malformed`);
      continue;
    }

    let outcome: { ok: boolean; detail: string };
    try {
      outcome = await resolves(row.doi);
    } catch (cause) {
      outcome = { ok: false, detail: cause instanceof Error ? cause.message : String(cause) };
    }

    if (!outcome.ok) failures.push(`${row.slug}: ${row.doi} — ${outcome.detail}`);

    console.log(`  ${outcome.ok ? 'ok  ' : 'FAIL'}  ${row.slug.padEnd(30)} ${row.doi}`);
    // The line no test can check, printed so a person can — ADR 0023.
    console.log(`        ${row.source_title}`);

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} DOI(s) did not resolve:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }

  console.log(`\nAll ${rows.length} DOIs are registered.`);
  console.log('Registered is not the same as "says what the row claims" — ADR 0023.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
