/**
 * The device's own voice, for the one cue that belongs to no coach.
 *
 * Coaches do not speak through this module any more. Each has a voice cast for
 * it and synthesised through the gateway's speech stage — ADR 0025, which took
 * coaches off device speech because three installed voices cannot make five
 * characters: on one machine the Sergeant spoke in a light female voice. What
 * is left is the rest timer's "Rest over.", which is nobody's line and has to
 * work mid-set, offline, with no round trip.
 *
 * AI-NOTE: every entry point here is safe to call when speech is unavailable —
 *          an old browser, a locked-down device, a headless test runner. Speech
 *          is an enhancement on top of a visual cue that always fires; it is
 *          never the only signal that something happened.
 * AI-NOTE: do not route a coach's words through here. A device voice that does
 *          not fit the coach is worse than none — the user's rule, ADR 0025 §5.
 *          The language hint, the voice variant and the per-coach rate and
 *          pitch that used to live here went with that decision.
 */

export interface SpeakOptions {
  /**
   * Called when the utterance fails AFTER being queued.
   *
   * WHY this exists: `speak()` returning true means "queued without throwing",
   * not "the user heard it". On iOS Safari and locked-down configurations
   * `speechSynthesis` exists and accepts the utterance, which then fails
   * asynchronously with `not-allowed` or `synthesis-failed`. A caller gated on
   * the synchronous return — the rest timer was — plays no fallback and the
   * user gets silence at the one moment the app is time-critical.
   *
   * INVARIANT: fires at most once per utterance, and NEVER for a cancellation —
   *            `speech.cancel()` below raises `error` on the utterance it
   *            superseded, and replacing speech is not a failure. Nor does it
   *            fire when `speak()` returns false: that caller falls back on the
   *            return value, and firing both would sound the fallback twice.
   */
  onFailure?: () => void;
}

/**
 * Utterance errors that mean "something else stopped this", not "this failed".
 *
 * AI-NOTE: keep these out of onFailure. They are the normal result of replacing
 *          speech, which the caller asked for.
 */
const CANCELLATION: ReadonlySet<string> = new Set(['interrupted', 'canceled', 'cancelled']);

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

/**
 * Speaks `text` in the device's default voice, replacing anything already in
 * progress.
 *
 * Returns false when speech could not be STARTED, so a caller can fall back.
 *
 * AI-NOTE: a `true` here means the utterance was queued without throwing, not
 *          that the user heard it — `speechSynthesis.speak` is fire-and-forget
 *          and failures surface asynchronously on the utterance. A caller whose
 *          fallback matters must pass `onFailure` and not treat `true` as proof
 *          of audio. `RestTimer` is the caller this matters for.
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  const speech = synth();
  if (speech === null || text.trim() === '') return false;

  try {
    // Queueing would leave a stale cue playing over the next one.
    speech.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    /*
     * Fires once. `onerror` and `onend` can both arrive, and an engine that
     * errors after some audio may raise error then end — the latch is what
     * keeps a caller's fallback from running twice.
     */
    if (options.onFailure) {
      const fail = options.onFailure;
      let settled = false;
      utterance.onerror = (event) => {
        if (settled) return;
        settled = true;
        if (CANCELLATION.has(event.error)) return;
        fail();
      };
      utterance.onend = () => {
        settled = true;
      };
    }

    speech.speak(utterance);
    return true;
  } catch {
    // A blocked or broken speech stack must not break the caller. The visual
    // cue is the primary signal.
    return false;
  }
}
