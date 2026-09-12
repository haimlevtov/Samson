/**
 * Hold-to-talk, as a state machine with its I/O injected — ADR 0031 §1.
 *
 * The browser half of the feature, kept out of the component for the reason
 * `src/speech/player.ts` gives: this repo has no DOM test infrastructure, so
 * anything living in a `.tsx` file is proved by reading. A pure object with an
 * injected recogniser is proved by test.
 *
 * INVARIANT: nothing here reaches a model. It turns speech into a string and
 *            hands it to the caller; every guard that matters runs on the
 *            server, on that string, exactly as it does on a typed one.
 */

/**
 * The slice of the Web Speech API this uses.
 *
 * Declared rather than imported: `SpeechRecognition` is not in TypeScript's DOM
 * library, because it is not a standard — which is also why iOS Safari does not
 * have it. Writing the shape here keeps the assumption visible instead of
 * hiding it behind a cast.
 */
export interface Recogniser {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface RecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

/** Why the button said nothing came back. Each renders its own sentence. */
export type ListenFailure = 'no-speech' | 'no-permission' | 'failed';

export interface ListenState {
  /** True between press and release. */
  holding: boolean;
  /** Set when a hold produced nothing usable; cleared by the next press. */
  failure: ListenFailure | null;
}

export const EMPTY_LISTEN: ListenState = { holding: false, failure: null };

export interface Listener {
  press: () => void;
  release: () => void;
  dispose: () => void;
}

/**
 * Maps the API's error strings onto the three sentences the card can say.
 *
 * `not-allowed` and `service-not-allowed` are both "the browser refused", which
 * is a different instruction to the user than "I heard nothing" — the first
 * needs a permission, the second needs another press. `aborted` is what a
 * release fires when nothing was said, and it is not an error to report.
 */
function failureFor(error: string): ListenFailure | null {
  if (error === 'aborted') return null;
  if (error === 'no-speech') return 'no-speech';
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'no-permission';
  return 'failed';
}

/** Joins the alternatives the recogniser is most confident about, in order. */
export function transcriptOf(event: RecognitionEvent): string {
  const parts: string[] = [];
  for (let i = 0; i < event.results.length; i++) {
    const alternative = event.results[i]?.[0];
    if (alternative) parts.push(alternative.transcript);
  }
  return parts.join(' ').replace(/\s+/gu, ' ').trim();
}

/**
 * Builds a hold-to-talk listener over an injected recogniser.
 *
 * WHY an `open` flag rather than a press counter — and the first draft had
 * NEITHER, which was the bug.
 *
 * That draft argued a counter was unnecessary because a late TRANSCRIPT is words
 * the user really did say. True, and not the race. The race is on the LIFECYCLE
 * events: `holding` was set by `press` and cleared only by `onend`, so any path
 * that set it without a recognition that would actually end left the button
 * reading "Listening…" with no way out. FOUND IN REVIEW, with two paths:
 *
 * - `start()` throwing for a reason that is NOT "one is already running" — no
 *   speech service, an insecure context — so nothing was open to end.
 * - press → release → press: the second `start()` throws (the first recognition
 *   is still settling), then the FIRST recognition's `onend` clears the second
 *   hold's latch. The user is mid-press and the button says "Hold to talk".
 *
 * So `open` tracks whether a recognition is actually running, and `holding` is
 * never left true without one. `player.ts` needed two counters for its own
 * version of this; this needs one flag, because there is one recogniser and it
 * can only be open once.
 */
export function createListener(deps: {
  recogniser: Recogniser;
  onTranscript: (text: string) => void;
  onChange: (state: ListenState) => void;
}): Listener {
  const { recogniser, onTranscript, onChange } = deps;

  let state: ListenState = EMPTY_LISTEN;
  /** Whether a recognition is running. The only thing that may hold `holding`. */
  let open = false;
  /** After this, every method is a no-op — the same latch `player.ts` carries. */
  let disposed = false;

  const set = (next: Partial<ListenState>): void => {
    if (disposed) return;
    state = { ...state, ...next };
    onChange(state);
  };

  recogniser.lang = 'en-US';
  // One utterance per hold, and no interim results: the transcript is only read
  // on release, so partial ones would be work nobody looks at.
  recogniser.continuous = false;
  recogniser.interimResults = false;

  recogniser.onresult = (event) => {
    const text = transcriptOf(event);
    if (text !== '') onTranscript(text);
  };

  recogniser.onerror = (event) => {
    /*
     * `holding` is cleared HERE as well as in `onend` — FOUND IN REVIEW. The
     * spec says `onend` always follows `onerror`, and this API is explicitly
     * non-standard (see `Recogniser` above), so relying on that ordering costs
     * a stuck button and saves one word. `aborted` clears it too, which the
     * first draft skipped by returning before the state write.
     */
    open = false;
    set({ holding: false, failure: failureFor(event.error) ?? state.failure });
  };

  recogniser.onend = () => {
    open = false;
    set({ holding: false });
  };

  return {
    press: () => {
      if (disposed) return;
      // The previous failure is cleared on press rather than on success: a
      // sentence about the last attempt must not sit beside a live one.
      set({ holding: true, failure: null });
      try {
        recogniser.start();
        open = true;
      } catch {
        /*
         * `start()` throws InvalidStateError when a recognition is already
         * running, which a fast double press causes and which is not a failure:
         * the recognition the user wants is open. Every OTHER throw means
         * nothing is open, nothing will fire `onend`, and the latch would stay
         * set forever — so `open` decides which of the two this was.
         */
        if (!open) set({ holding: false, failure: 'failed' });
      }
    },

    release: () => {
      if (disposed) return;
      // Gated on `open` rather than on `holding`: after a failed start the
      // latch is already down, and `stop()` on a recogniser that never started
      // is a no-op that would produce no `onend` to clear anything.
      if (!open) return;
      // `stop` asks for the final result; `abort` would throw it away. The
      // state stays `holding` until `onend`, because the transcript has not
      // arrived yet and a button that says "ready" while still listening is
      // lying about what it is doing.
      recogniser.stop();
    },

    dispose: () => {
      // Handlers first, THEN abort: abort fires onend, and a disposed listener
      // must not push state into a component that is unmounting.
      recogniser.onresult = null;
      recogniser.onerror = null;
      recogniser.onend = null;
      // `abort` rather than `stop`: on unmount there is nobody to deliver a
      // transcript to, and `stop` would produce one.
      recogniser.abort();
      open = false;
      disposed = true;
      state = EMPTY_LISTEN;
    },
  };
}
