/**
 * What one mid-session question returns — ADR 0031.
 *
 * Its own module because `'use server'` files may export only async functions,
 * so a type declared beside the action is unreachable from the component and
 * from a test.
 */
import type { VoiceRefusal } from '@/src/speech/player';

/** Why an answer arrived without audio. Each renders its own sentence. */
export type SilentReason =
  | VoiceRefusal
  /** The user has not asked for audio. Not a failure, and says nothing. */
  | 'not-asked'
  /**
   * The reply is longer than the speech stage's bound — ADR 0031 §4. The
   * assumption behind `SPEECH_ASSUMED_COST_USD` is calibrated on that bound, so
   * speaking past it would make the budget gate count the wrong thing.
   */
  | 'too-long';

export interface SessionAnswer {
  /** What was heard, echoed back so the user can see what was recognised. */
  asked: string;
  /** What the coach said. Never null: the supplement route's constant fills in. */
  reply: string;
  /** The clip, when there is one. */
  /*
   * The clip as the gateway returned it. React serialises a `Uint8Array` in a
   * server action result unchanged — measured, and recorded in
   * `src/speech/player.ts` — so converting it to a number array would inflate a
   * 1.4 MB clip several times over against a ~4.5 MB response ceiling.
   */
  audio: { bytes: Uint8Array<ArrayBuffer>; contentType: string } | null;
  /** Why there is no clip. Null when there is one. */
  silent: SilentReason | null;
  /** Whose voice it was, for the card to name. */
  coach: string | null;
  /** A code-owned sentence, or null. Never an upstream message — ADR 0028. */
  error: string | null;
}
