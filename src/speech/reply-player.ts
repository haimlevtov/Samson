/**
 * Playing a spoken reply — the logic, with the browser injected.
 *
 * WHY a factory rather than living in the hook: a hook cannot run under node,
 * and this is the part with races in it. `src/speech/player.ts` solved the same
 * problem the same way for the Try button — the audio element and the URL
 * functions are passed in, so a fake one drives every sequence in a test.
 * FOUND IN REVIEW of rework PR 6: the playback moved into a hook shared by two
 * surfaces, its guard CHANGED SHAPE in the move, and nothing tested either.
 *
 * What it holds, each found in review on the session card and each invisible
 * until the bug it prevents happens:
 *
 * - **Pause before the early return.** A text-only answer used to leave the
 *   previous clip talking underneath it.
 * - **A generation guard on the play() rejection.** Without one, a refused
 *   autoplay from an earlier clip could set `blocked` under a later answer, and
 *   the replay button would then play the earlier clip.
 * - **An autoplay refusal is recoverable, not a failure.** The browser withholds
 *   sound after a multi-second network wait; swallowing that made a clip the
 *   project had already paid for unreachable.
 *
 * THE GUARD IS NOT WHAT IT WAS, and an earlier comment said it was "moved
 * verbatim". On `main` the session card checked a rejection against its REQUEST
 * counter, which advances when a new question starts. This checks its own
 * PLAYBACK counter, which advances when the next clip is played. So a rejection
 * arriving while the next question is still pending is now acted on where it
 * used to be ignored — and acted on correctly, because the answer it belongs to
 * is the one still on screen. Same or better, and different, which is the part
 * that has to be said.
 */

/** The part of HTMLAudioElement this drives. */
export interface ReplyAudio {
  src: string;
  play(): Promise<void>;
  pause(): void;
}

export interface ReplyClip {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export interface ReplyPlayerDeps {
  audio: ReplyAudio;
  toUrl: (clip: ReplyClip) => string;
  revoke: (url: string) => void;
  /** Called whenever the autoplay-refused state changes. */
  onBlocked: (blocked: boolean) => void;
}

export function createReplyPlayer(deps: ReplyPlayerDeps) {
  let generation = 0;
  let url: string | null = null;
  let disposed = false;
  /** What to call if the clip that is loaded turns out never to play. */
  let unplayable: (() => void) | undefined;

  const isAutoplayRefusal = (cause: unknown): boolean =>
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause as { name: unknown }).name === 'NotAllowedError';

  return {
    /**
     * Stops whatever is playing, then plays `clip` if there is one.
     *
     * `onUnplayable` runs if the clip will not play at all — anything but the
     * browser's autoplay refusal — so the surface can stop claiming a voice.
     */
    play(clip: ReplyClip | null, onUnplayable?: () => void): void {
      if (disposed) return;
      const mine = ++generation;

      // Stopped BEFORE the early return: a text-only answer must not leave the
      // previous clip talking underneath it.
      deps.audio.pause();
      deps.onBlocked(false);
      unplayable = onUnplayable;
      if (clip === null) return;

      // A leaked blob per answer is a leak per question.
      if (url !== null) deps.revoke(url);
      url = deps.toUrl(clip);
      deps.audio.src = url;

      void deps.audio.play().catch((cause: unknown) => {
        if (disposed || mine !== generation) return;
        if (isAutoplayRefusal(cause)) {
          // The URL stays: `replay` plays it from the cache, inside the tap.
          deps.onBlocked(true);
          return;
        }
        onUnplayable?.();
      });
    },

    /**
     * Plays the loaded clip again, inside a tap — which is what autoplay waits for.
     *
     * A second autoplay refusal leaves the button; ANY OTHER rejection means the
     * clip will never play, so the button goes and the surface is told. FOUND IN
     * REVIEW: this treated every rejection as "still refused", so a clip that
     * could not decode left a "Tap to play" that never worked and never said so.
     */
    async replay(): Promise<void> {
      if (disposed || url === null) return;
      const mine = generation;
      try {
        await deps.audio.play();
        if (mine === generation) deps.onBlocked(false);
      } catch (cause) {
        if (disposed || mine !== generation || isAutoplayRefusal(cause)) return;
        deps.onBlocked(false);
        unplayable?.();
      }
    },

    /** Stops the clip, revokes its URL, and makes every late continuation inert. */
    dispose(): void {
      disposed = true;
      generation += 1;
      deps.audio.pause();
      if (url !== null) deps.revoke(url);
      url = null;
    },
  };
}

export type ReplyPlayer = ReturnType<typeof createReplyPlayer>;
