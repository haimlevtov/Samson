/**
 * Phase 0 acceptance criterion: a scripted call through the gateway writes a
 * complete llm_calls row with prompt, completion and cached token counts plus
 * native cost.
 *
 * This is the only script that spends real money. It is never run in CI.
 *
 *   npm run smoke:llm
 *
 * WHY: it signs in as a real user and uses that user's RLS-scoped client, so it
 *      exercises the same path the app will — not a service-role shortcut that
 *      would prove nothing about whether the ledger works under RLS.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { callLLM, createGatewayDeps } from '../src/llm/gateway';
import { MissingApiKeyError } from '../src/llm/config';
import { createSupabaseLedger } from '../src/db/ledger';
import { createUserClient, supabaseAnonKey, supabaseUrl } from '../src/db/client';
import type { Database } from '../src/db/types';

config({ path: '.env.local', quiet: true });

const SMOKE_EMAIL = 'smoke@samson.test';
const SMOKE_PASSWORD = 'smoke-fixture-password';

const answerSchema = z.object({
  movement: z.string(),
  primary_muscle: z.string(),
  is_compound: z.boolean(),
});

async function ensureSmokeUser(): Promise<string> {
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to create the smoke fixture user.');
  }

  // Fixture setup only. CLAUDE.md #10 forbids this in application code, which is
  // why it lives in scripts/ and never under src/.
  const admin = createClient<Database>(supabaseUrl(), serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let signIn = await anon.auth.signInWithPassword({
    email: SMOKE_EMAIL,
    password: SMOKE_PASSWORD,
  });

  if (signIn.error) {
    const created = await admin.auth.admin.createUser({
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
      email_confirm: true,
    });
    if (created.error) throw new Error(`could not create smoke user: ${created.error.message}`);

    signIn = await anon.auth.signInWithPassword({
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
    });
    if (signIn.error) throw new Error(`could not sign in smoke user: ${signIn.error.message}`);
  }

  const session = signIn.data.session;
  if (!session) throw new Error('no session for the smoke user');

  const userClient = createUserClient(session.access_token);
  const profile = await userClient
    .from('users')
    .upsert({ user_id: session.user.id, timezone: 'Asia/Jerusalem' }, { onConflict: 'user_id' });
  if (profile.error) throw new Error(`could not upsert profile: ${profile.error.message}`);

  return session.access_token;
}

async function main(): Promise<void> {
  const accessToken = await ensureSmokeUser();
  const db = createUserClient(accessToken);
  const ledger = createSupabaseLedger(db);

  let deps;
  try {
    deps = createGatewayDeps(ledger);
  } catch (cause) {
    if (cause instanceof MissingApiKeyError) {
      console.error(`\n${cause.message}\n`);
      process.exit(1);
    }
    throw cause;
  }

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error('could not resolve the smoke user id');

  console.log('Calling the model gateway...\n');

  const result = await callLLM(
    {
      userId: user.id,
      stage: 'smoke',
      schema: answerSchema,
      schemaName: 'exercise_fact',
      system: 'You classify strength training exercises. Answer only with the requested JSON.',
      messages: [{ role: 'user', content: 'Classify the barbell back squat.' }],
      maxTokens: 200,
    },
    deps
  );

  console.log('Response:', result.data);
  console.log(`Model: ${result.modelUsed}  Attempts: ${result.attempts}\n`);

  // Read the row back through the user's own client, proving RLS let the write
  // land and lets the owner read it.
  const { data: rows, error } = await db
    .from('llm_calls')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(`could not read the ledger back: ${error.message}`);
  const row = rows?.[0];
  if (!row) throw new Error('no llm_calls row was written — invariant #3 is broken');

  console.log('llm_calls row:');
  for (const [key, value] of Object.entries(row)) {
    console.log(`  ${key.padEnd(20)} ${value === null ? '—' : String(value)}`);
  }

  const missing = (['prompt_tokens', 'completion_tokens', 'cost_credits'] as const).filter(
    (field) => row[field] === null
  );

  console.log();
  if (missing.length > 0) {
    console.log(`Incomplete row: ${missing.join(', ')} came back null.`);
    process.exit(1);
  }
  console.log('Complete ledger row written. Acceptance criterion 2 satisfied.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
