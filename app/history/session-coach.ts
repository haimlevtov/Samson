/**
 * What one mid-session question returns — ADR 0031.
 *
 * Its own module because `'use server'` files may export only async functions,
 * so a type declared beside the action is unreachable from the component and
 * from a test.
 */
import type { SilentReason } from '@/src/speech/perform';

/**
 * Why an answer arrived without audio — defined in `src/speech/perform.ts` now,
 * because the Coach tab's chat returns it too. Re-exported so nothing that
 * imported it from here had to move.
 */
export type { SilentReason };

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
