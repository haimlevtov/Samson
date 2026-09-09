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

/**
 * A thrown fetch failure, in words that name the actual problem.
 *
 * WHY it digs into `cause`: Node's fetch reports a DNS or connection failure as
 * `TypeError: fetch failed`, with the real reason — `ENOTFOUND`, `ECONNRESET` —
 * only in `.cause`. Without this, a registry outage prints thirteen identical
 * "fetch failed" lines, and the one thing this job uniquely detects becomes
 * indistinguishable from the weather.
 */
function describeFailure(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = cause.cause;
  return inner instanceof Error ? `${cause.message} (${inner.message})` : cause.message;
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

  /*
   * Two buckets, not one — FOUND IN REVIEW, and the distinction is the whole
   * value of this job.
   *
   * This is a `continue-on-error` job, so its red X is easy to normalise into
   * background noise. Every failure it can report EXCEPT one is already covered
   * by a blocking check: `tests/db/evidence.test.ts` proves the rows exist and
   * are well-formed. The one signal only this job carries is "this DOI is
   * well-formed and is not registered" — a transposed digit that still matches
   * the pattern. If a registry outage prints thirteen lines that look exactly
   * like that, the signal is lost.
   */
  const unregistered: string[] = [];
  const unreachable: string[] = [];

  for (const row of rows) {
    // Format first, so a malformed value is reported as malformed rather than
    // as a network failure. The same check `npm test` runs offline.
    if (!isDoi(row.doi)) {
      unregistered.push(`${row.slug}: ${row.doi} is not shaped like a DOI`);
      console.log(`  FAIL  ${row.slug.padEnd(30)} ${row.doi} — malformed`);
      continue;
    }

    let outcome: { ok: boolean; detail: string; reachable: boolean };
    try {
      outcome = { ...(await resolves(row.doi)), reachable: true };
    } catch (cause) {
      outcome = { ok: false, detail: describeFailure(cause), reachable: false };
    }

    if (!outcome.ok) {
      const line = `${row.slug}: ${row.doi} — ${outcome.detail}`;
      (outcome.reachable ? unregistered : unreachable).push(line);
    }

    console.log(`  ${outcome.ok ? 'ok  ' : 'FAIL'}  ${row.slug.padEnd(30)} ${row.doi}`);
    // The line no test can check, printed so a person can — ADR 0023.
    console.log(`        ${row.source_title}`);
    if (!outcome.ok) console.log(`        ${outcome.detail}`);

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  if (unregistered.length > 0 || unreachable.length > 0) {
    console.error(
      `\n${unregistered.length} unregistered, ${unreachable.length} unreachable, of ${rows.length}.`
    );
    if (unregistered.length > 0) {
      console.error('\nNot registered — the ROWS are wrong, fix the migration:');
      for (const line of unregistered) console.error(`  ${line}`);
    }
    if (unreachable.length > 0) {
      console.error('\nCould not be reached — the NETWORK is wrong, nothing to fix here:');
      for (const line of unreachable) console.error(`  ${line}`);
    }
    process.exit(1);
  }

  console.log(`\nAll ${rows.length} DOIs are registered.`);
  console.log('Registered is not the same as "says what the row claims" — ADR 0023.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
