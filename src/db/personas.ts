/**
 * Reading persona rows and the latest delivered plan.
 *
 * INVARIANT: content lives in the database — CLAUDE.md #7. There is no
 *            hard-coded persona anywhere; `SHIPPED_PERSONA_SLUGS` in
 *            src/persona/schema.ts names what the migration inserted, and
 *            nothing more.
 */
import type { Db } from './client';
import type { HumorLevel, Persona } from '../persona/schema';
import type { TrainingBlock } from '../planner/schema';
import { trainingBlockSchema } from '../planner/schema';

/**
 * Every persona this user can pick: the shared rows plus any of their own.
 * `personas_read` already scopes it; there is no user_id filter to forget.
 */
export async function listPersonas(db: Db): Promise<Persona[]> {
  const { data, error } = await db
    .from('personas')
    .select('slug, name, system_prompt, intensity, humor_level, banned_phrases, tts_voice_id')
    .eq('is_active', true)
    .order('name');

  if (error) throw new Error(`reading personas: ${error.message}`);

  return (data ?? []).map((row) => ({
    slug: row.slug,
    name: row.name,
    systemPrompt: row.system_prompt,
    intensity: row.intensity,
    humorLevel: row.humor_level as HumorLevel,
    bannedPhrases: row.banned_phrases ?? [],
  }));
}

/** The BCP-47 hint for a persona, for src/ui/speak.ts. Null when unset. */
export async function personaVoice(db: Db, slug: string): Promise<string | null> {
  const { data, error } = await db
    .from('personas')
    .select('tts_voice_id')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`reading persona voice: ${error.message}`);
  return data?.tts_voice_id ?? null;
}

export interface AcceptedPlan {
  id: string;
  block: TrainingBlock;
  createdAt: string;
}

/**
 * The newest plan that passed both gates.
 *
 * WHY it re-validates against the schema on the way out: `plan_runs.block` is
 * jsonb, so the database will hand back whatever was written — including a
 * block written by an older schema version. Parsing here means a shape change
 * surfaces as "no plan yet" rather than as a page that renders undefined.
 */
export async function latestAcceptedPlan(db: Db): Promise<AcceptedPlan | null> {
  const { data, error } = await db
    .from('plan_runs')
    .select('id, block, created_at')
    .eq('status', 'accepted')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(`reading plan_runs: ${error.message}`);

  const row = data?.[0];
  if (!row || row.block === null) return null;

  const parsed = trainingBlockSchema.safeParse(row.block);
  if (!parsed.success) return null;

  return { id: row.id, block: parsed.data, createdAt: row.created_at };
}
