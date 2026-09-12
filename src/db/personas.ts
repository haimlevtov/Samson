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
 * A persona as the picker lists it: what the delivery stage needs, plus the
 * line the Coach tab's preview speaks.
 *
 * WHY not a field on `Persona`: that type is "one row, as the delivery stage
 * needs it", and delivery never reads the line. Every persona literal in the
 * delivery tests would have to carry a field the code under test ignores.
 */
export interface ListedPersona extends Persona {
  /** Null for a row with none — the column is nullable, migration 20260911130000. */
  sampleLine: string | null;
  /**
   * Whether `coachVoice` would speak this coach: a shared row with a voice, a
   * direction and a line. The Voice card offers Try only when this is true —
   * a button that cannot speak is not shown (docs/specs/mobile-interface.md §4).
   *
   * AI-NOTE: the same three conditions and the same `user_id is null` as
   *          `coachVoice` below. If one changes, change both.
   */
  voiced: boolean;
}

/**
 * Every persona this user can pick: the shared rows plus any of their own.
 * `personas_read` already scopes it; there is no user_id filter to forget.
 */
export async function listPersonas(db: Db): Promise<ListedPersona[]> {
  const { data, error } = await db
    .from('personas')
    .select(
      'slug, name, system_prompt, intensity, humor_level, banned_phrases, sample_line, user_id, tts_voice, tts_instructions'
    )
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
    sampleLine: row.sample_line,
    voiced:
      row.user_id === null &&
      Boolean(row.tts_voice) &&
      Boolean(row.tts_instructions) &&
      Boolean(row.sample_line),
  }));
}

/** What the speech stage needs to say a coach's line in its own voice. */
export interface CoachVoice {
  /** One of SPEECH_VOICES in src/speech/script.ts. */
  voice: string;
  /** How the character speaks — read by the model, never spoken. */
  direction: string;
  /** The row's `sample_line`: what is spoken. */
  line: string;
}

/**
 * A shipped coach's voice, direction and line — ADR 0025. Null when the slug
 * names no shared coach, or one missing any of the three.
 *
 * INVARIANT: shared rows only — ADR 0025 §4. `personas_write` lets a user
 *            write their own row, line and direction included, and RLS shows
 *            them their own rows, so without the `user_id is null` filter a
 *            user could make the server speak anything they typed. The filter
 *            is the control; RLS is not.
 *
 * AI-NOTE: `ListedPersona.voiced` above restates these conditions for the
 *          picker. If one changes, change both.
 */
export async function coachVoice(db: Db, slug: string): Promise<CoachVoice | null> {
  const { data, error } = await db
    .from('personas')
    .select('tts_voice, tts_instructions, sample_line')
    .eq('slug', slug)
    .is('user_id', null)
    .eq('is_active', true)
    // One row at most: personas_slug_unique is `nulls not distinct`, so a
    // shared slug is unique among shared rows.
    .maybeSingle();

  if (error) throw new Error(`reading coach voice: ${error.message}`);
  if (!data?.tts_voice || !data.tts_instructions || !data.sample_line) return null;

  return { voice: data.tts_voice, direction: data.tts_instructions, line: data.sample_line };
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
