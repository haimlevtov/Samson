'use client';

/**
 * Playing a coach's spoken reply in the browser — ADR 0031 §3, and now two
 * surfaces: the session card and the Coach tab's chat.
 *
 * WHY this is a hook rather than a second copy. What it holds was found in
 * review three separate times on the session card, and each fix is invisible
 * until the bug it prevents happens:
 *
 * - **Pause before the early return.** A text-only answer used to leave the
 *   previous clip talking underneath it.
 * - **A generation guard on the play() rejection.** It was the only continuation
 *   with no check, so a refused autoplay from answer 1 could set `blocked` under
 *   answer 2 and the replay button would then play answer 1's clip.
 * - **NotAllowedError is recoverable, not a failure.** The browser withholds
 *   sound after a multi-second network wait; the first draft swallowed it, so a
 *   clip the project had PAID FOR was unreachable.
 *
 * A second hand-written copy on the Coach tab would have had to find all three
 * again. It moved verbatim from `app/history/[id]/SessionCoach.tsx`; the
 * behaviour did not change.
 *
 * WHAT IT DOES NOT OWN is the request. Each surface decides when a question
 * starts and how a superseded answer is dropped — the session card because its
 * recogniser can fire twice per hold, the Coach tab because `useActionState`
 * already queues its submissions.
 */
import { useEffect, useRef, useState } from 'react';
import type { SilentReason } from '@/src/speech/perform';

/**
 * What a card says when a reply arrived without a clip. `not-asked` says nothing.
 *
 * Moved from the session card when the Coach tab's chat became the second
 * surface to need it: two surfaces that can be silent for the same reasons must
 * say the same sentences, the argument `SHOWN_TEXT` in `app/coach/CoachTry.tsx`
 * was single-sourced on.
 */
export const SILENT_TEXT: Record<Exclude<SilentReason, 'not-asked'>, string> = {
  'no-key': 'The coach voices are not set up here.',
  budget: "This week's coaching budget is spent, so the coach cannot speak until it resets.",
  'no-voice': 'No coach has a voice yet, so this one is written only.',
  failed: 'The voice did not come through.',
  'too-long': 'That answer was too long to read aloud — it is above.',
};

/** A clip as a server action returns it. */
export interface ReplyClip {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export function useReplyVoice(): {
  /** The browser refused to autoplay a clip that did arrive. */
  blocked: boolean;
  /**
   * Stops whatever is playing, then plays `clip` if there is one.
   *
   * `onUnplayable` runs if the clip will not play at all (anything but the
   * browser's autoplay refusal), so the surface can stop claiming it did.
   */
  play: (clip: ReplyClip | null, onUnplayable?: () => void) => void;
  /** Plays the last clip again, inside a tap — which is what autoplay waits for. */
  replay: () => Promise<void>;
} {
  const [blocked, setBlocked] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const clipUrl = useRef<string | null>(null);
  /*
   * Which call to `play` a rejection belongs to. Bumped on every call and on
   * unmount, so a continuation from an earlier clip — or one crossing teardown —
   * touches nothing.
   */
  const generation = useRef(0);

  useEffect(() => {
    audio.current = new Audio();
    return () => {
      generation.current += 1;
      audio.current?.pause();
      audio.current = null;
      // A leaked blob per answer is a leak per question.
      if (clipUrl.current !== null) URL.revokeObjectURL(clipUrl.current);
      clipUrl.current = null;
    };
  }, []);

  const play = (clip: ReplyClip | null, onUnplayable?: () => void): void => {
    if (audio.current === null) return;
    const mine = ++generation.current;

    // Stopped BEFORE the early return — a text-only answer must not leave the
    // previous clip talking underneath it.
    audio.current.pause();
    setBlocked(false);
    if (clip === null) return;

    if (clipUrl.current !== null) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = URL.createObjectURL(new Blob([clip.bytes], { type: clip.contentType }));
    audio.current.src = clipUrl.current;

    void audio.current.play().catch((cause: unknown) => {
      if (mine !== generation.current) return;
      if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
        // The URL stays: `replay` plays it from the cache, inside the tap.
        setBlocked(true);
        return;
      }
      onUnplayable?.();
    });
  };

  const replay = async (): Promise<void> => {
    if (audio.current === null || audio.current.src === '') return;
    try {
      await audio.current.play();
      setBlocked(false);
    } catch {
      // Still refused. The text is on screen and the button stays, which is the
      // honest state — nothing here can force sound out of a browser.
    }
  };

  return { blocked, play, replay };
}
