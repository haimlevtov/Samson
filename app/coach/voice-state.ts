/**
 * What the Voice card's Hear button gets back — ADR 0025.
 *
 * WHY these are not in actions.ts: a "use server" module may export async
 * functions and nothing else — see the same note on ./state.ts.
 */

/** Why a coach's line is shown instead of heard. */
export type VoiceRefusal = 'no-key' | 'budget' | 'no-voice' | 'failed';

export type VoiceResult =
  /**
   * WHY base64 rather than bytes: a server action's result travels as
   * serialisable data. A sample line is ten to fifteen seconds of mp3, tens of
   * kilobytes, so the third it adds is not worth a route of its own.
   */
  { ok: true; audio: string; contentType: string } | { ok: false; reason: VoiceRefusal };

/**
 * What the card says beside the line, per refusal — every state renders
 * something (docs/specs/mobile-interface.md §4). `blocked` is the browser's own
 * refusal to play, which the server never sees.
 */
export const VOICE_REFUSAL_TEXT: Record<VoiceRefusal | 'blocked', string> = {
  'no-key': 'The coach voices are not set up here.',
  budget: "This week's coaching budget is spent, so the coach cannot speak until it resets.",
  'no-voice': 'This coach has no voice yet.',
  failed: 'The voice did not come through. Try again in a moment.',
  blocked: 'This browser held the sound back. Tap again to play.',
};
