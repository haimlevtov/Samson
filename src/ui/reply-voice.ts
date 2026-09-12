'use client';

/**
 * A spoken reply's playback, for a component — rework PR 6.
 *
 * Two surfaces use this: the session card and the Coach tab's chat. The logic —
 * the races, the autoplay refusal, the URL lifecycle — is in
 * `src/speech/reply-player.ts`, where a test can run it; this only binds it to a
 * real `<audio>` element and React state. Its header carries the three findings
 * from review this protects and how the guard changed shape in the move.
 *
 * WHAT IT DOES NOT OWN is the request. Each surface decides when a question
 * starts and how a superseded answer is dropped — the session card because its
 * recogniser can fire twice per hold, the Coach tab because `useActionState`
 * queues its submissions.
 */
import { useEffect, useRef, useState } from 'react';
import type { SilentReason } from '@/src/speech/perform';
import { createReplyPlayer, type ReplyClip, type ReplyPlayer } from '@/src/speech/reply-player';

export type { ReplyClip };

/**
 * What a card says when a reply arrived without a clip. `not-asked` says nothing.
 *
 * Shared because two surfaces can be silent for the same reasons and must say
 * the same sentences — the argument `SHOWN_TEXT` in `app/coach/CoachTry.tsx` was
 * single-sourced on.
 */
export const SILENT_TEXT: Record<Exclude<SilentReason, 'not-asked'>, string> = {
  'no-key': 'The coach voices are not set up here.',
  budget: "This week's coaching budget is spent, so the coach cannot speak until it resets.",
  'no-voice': 'No coach has a voice yet, so this one is written only.',
  failed: 'The voice did not come through.',
  'too-long': 'That answer was too long to read aloud — it is above.',
};

/**
 * The sentence beside a clip the browser would not autoplay — the wording
 * `docs/specs/mobile-interface.md` §4 specifies, and the same one the Coach tab's
 * Try button already says. FOUND IN REVIEW: the chat showed a bare button with
 * no sentence, disagreeing with the spec and with the card above it on the page.
 */
export const BLOCKED_TEXT = 'This browser held the sound back. Tap again to play.';

export function useReplyVoice(): {
  /** The browser refused to autoplay a clip that did arrive. */
  blocked: boolean;
  play: (clip: ReplyClip | null, onUnplayable?: () => void) => void;
  replay: () => Promise<void>;
} {
  const [blocked, setBlocked] = useState(false);
  const player = useRef<ReplyPlayer | null>(null);

  /*
   * Made on demand as well as on mount — the reason `app/coach/CoachTry.tsx`
   * gives: a passive effect has not flushed when the first paint lands, so a
   * call arriving before it would otherwise do nothing at all.
   */
  const ensure = (): ReplyPlayer => {
    player.current ??= createReplyPlayer({
      audio: new Audio(),
      toUrl: (clip) => URL.createObjectURL(new Blob([clip.bytes], { type: clip.contentType })),
      revoke: (url) => URL.revokeObjectURL(url),
      onBlocked: setBlocked,
    });
    return player.current;
  };

  useEffect(() => {
    const created = ensure();
    return () => {
      created.dispose();
      player.current = null;
    };
    // One player per mount: `ensure` closes over a ref and a state setter, both
    // stable for the life of the component.
  }, []);

  return {
    blocked,
    play: (clip, onUnplayable) => ensure().play(clip, onUnplayable),
    replay: () => ensure().replay(),
  };
}
