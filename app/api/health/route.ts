import { NextResponse } from 'next/server';
import { createAnonClient } from '@/src/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Probe {
  database: 'reachable' | 'unreachable';
  detail: string | null;
}

// WHY: the query runs as anon and RLS denies it. That is deliberate — the round
//      trip is what keeps the project awake, and this route must not hold
//      credentials that could read user rows (CLAUDE.md #10). A permission
//      error still proves Postgres answered.
async function probeDatabase(): Promise<Probe> {
  try {
    const supabase = createAnonClient();
    const { error } = await supabase.from('exercises').select('id', { head: true, count: 'exact' });
    // error.code is not always populated, so fall back to the message rather
    // than letting the key vanish from the response.
    return { database: 'reachable', detail: error ? (error.code ?? error.message) : null };
  } catch (cause) {
    return { database: 'unreachable', detail: cause instanceof Error ? cause.message : 'unknown' };
  }
}

// WHY: the GitHub Actions daily cron pings this so the free-tier Supabase
//      project never sleeps before a demo. It must therefore touch Postgres,
//      not just return 200 from the edge.
export async function GET() {
  const startedAt = Date.now();
  const probe = await probeDatabase();
  const ok = probe.database === 'reachable';

  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', ...probe, ms: Date.now() - startedAt },
    { status: ok ? 200 : 503 }
  );
}
