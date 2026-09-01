/**
 * Tone limits, decided in code.
 *
 * INVARIANT: an injury or missed-session flag forces a gentler register
 *            REGARDLESS of the selected persona — PLAN.md phase 3, ADR 0006.
 *            "Regardless" is the operative word: the persona does not get a
 *            vote, so this cannot live in a persona row or a prompt.
 *
 * WHY clamps rather than instructions: the same reasoning as the diet floor in
 * invariant #6. A limit a prompt can be talked out of is not a limit, and the
 * Rival's whole character is pushing back.
 */
import { HUMOR_ORDER, type HumorLevel, type Persona } from './schema';

/**
 * Below this, adherence is the problem and more intensity is the wrong answer.
 *
 * WHY it is a named export: it is a judgement, not a fact — PRD §2 says Tom's
 * problem is adherence rather than volume, and this is the line where the app
 * acts on that. Tunable, and citable in the phase report.
 */
export const GENTLE_ADHERENCE_THRESHOLD = 0.6;

/** The ceiling on intensity once a flag is set. 1–5 scale, per the personas table. */
export const GENTLE_MAX_INTENSITY = 2;

/**
 * Words in a workout note that mean something hurts.
 *
 * AI-NOTE: `sore` and `tight` are deliberately absent. Both are ordinary
 *          training vocabulary — delayed soreness is expected, and "tight core"
 *          is a coaching cue. Including them would flag most notes, the coach
 *          would be permanently gentle, and the persona feature would stop
 *          existing. Over-triggering is not the safe direction here; it just
 *          breaks a different thing quietly.
 */
const INJURY_WORDS =
  /\b(?:injur\w*|pain\w*|hurts?|hurting|tweak\w*|strain\w*|sprain\w*|twinge|niggle|flare[- ]?up|gave\s+out|popped)\b/i;

export interface ToneInput {
  /** Recent workout notes. Untrusted user text — matched, never interpolated. */
  notes: readonly (string | null)[];
  /** From src/metrics/adherence.ts. Null when nothing has resolved yet. */
  adherenceRate: number | null;
}

export interface ToneFlags {
  injury: boolean;
  missedSessions: boolean;
}

export interface ToneDecision {
  flags: ToneFlags;
  /** True when either flag is set. */
  gentle: boolean;
  intensity: number;
  humorLevel: HumorLevel;
  /** The mandatory instruction, or null when no flag is set. */
  override: string | null;
}

export function toneFlags(input: ToneInput): ToneFlags {
  return {
    injury: input.notes.some((note) => note !== null && INJURY_WORDS.test(note)),
    // Null means nothing has resolved yet, which is not the same as missing
    // sessions — see adherence.ts for why that distinction is kept.
    missedSessions:
      input.adherenceRate !== null && input.adherenceRate < GENTLE_ADHERENCE_THRESHOLD,
  };
}

/**
 * The instruction appended when a flag is set. Static text, so it lives in the
 * per-call message with everything else dynamic.
 */
export const GENTLE_OVERRIDE =
  'TONE OVERRIDE, which outranks the persona description above. This person is carrying an injury or has been missing sessions. Drop the pressure entirely: no competitive framing, no challenge, no teasing, no jokes. Be plain, warm and short. Do not tell them to push through anything. If pain is mentioned, say that a professional should look at it rather than suggesting a way around it.';

function clampHumor(level: HumorLevel, ceiling: HumorLevel): HumorLevel {
  const index = Math.min(HUMOR_ORDER.indexOf(level), HUMOR_ORDER.indexOf(ceiling));
  return HUMOR_ORDER[index] ?? 'clean';
}

/**
 * Resolves the tone a delivery actually runs at.
 *
 * Two independent ceilings apply, and both are `Math.min` over an ordered
 * scale: the user's own `humor_max_level`, and the gentle override. A user who
 * chose `clean` cannot be handed `crude` by selecting the Rival.
 */
export function resolveTone(
  persona: Persona,
  userHumorMax: HumorLevel,
  input: ToneInput
): ToneDecision {
  const flags = toneFlags(input);
  const gentle = flags.injury || flags.missedSessions;

  const humorCeiling: HumorLevel = gentle ? 'clean' : userHumorMax;

  return {
    flags,
    gentle,
    intensity: gentle ? Math.min(persona.intensity, GENTLE_MAX_INTENSITY) : persona.intensity,
    humorLevel: clampHumor(clampHumor(persona.humorLevel, userHumorMax), humorCeiling),
    override: gentle ? GENTLE_OVERRIDE : null,
  };
}
