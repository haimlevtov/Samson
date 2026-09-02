/**
 * The app's voice, such as it is.
 *
 * ADR 0006 records the reduction honestly: this is the browser's own
 * `speechSynthesis`, not a TTS provider, because the only key this project has
 * is for text. Nothing is precomputed, and no persona gets a recorded timbre.
 *
 * What it CAN do, and now does: hand each persona a different one of the voices
 * the device already has. `personas.tts_voice_id` narrows the field to a
 * language; `variant` then picks a distinct voice within it. Before this, voices
 * were selected by language alone, so the two personas sharing `en-GB` resolved
 * to the same voice object and — on a device with no en-GB voice installed, the
 * Windows default — the `en-US` persona fell back to that same voice too. All
 * three coaches spoke identically under a control labelled "Voice".
 *
 * AI-NOTE: every entry point here is safe to call when speech is unavailable —
 *          an old browser, a locked-down device, a headless test runner. Speech
 *          is an enhancement on top of a visual cue that always fires; it is
 *          never the only signal that something happened.
 */

/** The part of `SpeechSynthesisVoice` this module reasons about. */
export interface VoiceLike {
  name: string;
  lang: string;
}

export interface SpeakOptions {
  /** BCP-47 hint from `personas.tts_voice_id`, e.g. "en-GB". Best effort. */
  lang?: string | null;
  /** 1–5 from the persona row. Drives rate and pitch, since timbre is not ours. */
  intensity?: number;
  /**
   * Which voice to take when the language leaves several to choose from.
   *
   * The caller owns this because only the caller knows how many speakers it is
   * trying to keep apart — the coach console passes each persona's index, so
   * three personas take three different voices whenever the device has three.
   */
  variant?: number;
}

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

/** Whether this browser can speak at all. */
export function canSpeak(): boolean {
  return synth() !== null;
}

/*
 * The voice list, cached.
 *
 * WHY: `getVoices()` returns an EMPTY array on the first call in Chromium and
 * Safari — the list loads asynchronously and announces itself with a
 * `voiceschanged` event. A caller that asks once and takes the answer gets no
 * voice at all and silently falls back to the system default, which is the
 * failure this cache exists to prevent. Once populated the list is kept, so a
 * later empty reading (which some engines return while reloading) cannot
 * un-choose a voice mid-session.
 */
let cachedVoices: VoiceLike[] = [];
let primed = false;

function refreshVoices(speech: SpeechSynthesis): SpeechSynthesisVoice[] {
  const live = speech.getVoices();
  if (live.length > 0) cachedVoices = live;
  return live.length > 0 ? live : (cachedVoices as SpeechSynthesisVoice[]);
}

/**
 * Starts the voice list loading. Safe to call repeatedly and on every mount.
 *
 * Call this when a surface that might speak appears, so the list is ready by the
 * time somebody presses a button rather than being requested for the first time
 * at that moment.
 */
export function primeVoices(): void {
  const speech = synth();
  if (speech === null) return;

  refreshVoices(speech);
  if (primed) return;
  primed = true;

  // addEventListener is absent on some older speechSynthesis implementations.
  speech.addEventListener?.('voiceschanged', () => {
    refreshVoices(speech);
  });
}

const normalise = (lang: string): string => lang.replace('_', '-').toLowerCase();

/**
 * The voices worth considering for a language, best match first.
 *
 * Exact language wins outright. Failing that the language prefix is accepted, so
 * asking for en-GB on a machine that only has en-US speaks in American English
 * rather than falling silent — which is the right call, and is also why every
 * persona used to converge on one voice.
 */
function candidatesFor<T extends VoiceLike>(available: readonly T[], lang: string): T[] {
  const wanted = normalise(lang);

  const exact = available.filter((v) => normalise(v.lang) === wanted);
  if (exact.length > 0) return exact;

  const prefix = wanted.split('-')[0] ?? '';
  return available.filter((v) => normalise(v.lang).startsWith(prefix));
}

/**
 * Picks a voice for a language hint, distinct per `variant` where possible.
 *
 * Sorted by name before indexing, because `getVoices()` order is not specified
 * and differs between browsers: without a stable sort the same persona would
 * take a different voice depending on which engine loaded first.
 *
 * Returns null with no language hint — the caller gets the system default,
 * which is the right behaviour for an announcement that is not in a persona's
 * voice at all.
 */
export function pickVoice<T extends VoiceLike>(
  available: readonly T[],
  lang: string | null,
  variant = 0
): T | null {
  if (available.length === 0 || lang === null) return null;

  const pool = candidatesFor(available, lang);
  if (pool.length === 0) return null;

  const ordered = [...pool].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const index = ((variant % ordered.length) + ordered.length) % ordered.length;
  return ordered[index] ?? null;
}

/**
 * Intensity 1–5 onto rate and pitch.
 *
 * The Analyst at 2 is measured; the Rival at 4 is faster and a little sharper.
 * Deliberately a narrow range — anything wider stops sounding like a person.
 *
 * On its own this is NOT enough to tell two coaches apart: one step of intensity
 * is a 7% rate and 5% pitch change, under what a listener hears as a different
 * speaker. That is what `variant` is for.
 */
export function voiceSettings(intensity: number): { rate: number; pitch: number } {
  const clamped = Math.min(5, Math.max(1, intensity));
  return {
    rate: 0.9 + (clamped - 1) * 0.075,
    pitch: 0.9 + (clamped - 1) * 0.05,
  };
}

/**
 * The intensity to speak at, given the delivery's own tone judgement.
 *
 * WHY this exists rather than passing `intensity` straight through: the gentle
 * flag already softens the WORDS (ADR 0006 — it is computed from the log before
 * any model is involved). Leaving the speech at the persona's usual rate meant
 * the app printed "Gentler tone: this is not a week to push" and then read it
 * out faster and higher-pitched than a normal week.
 */
export function spokenIntensity(intensity: number, gentle: boolean): number {
  return gentle ? Math.max(1, intensity - 2) : intensity;
}

/** Stops anything currently being spoken. Safe when speech is unavailable. */
export function stopSpeaking(): void {
  synth()?.cancel();
}

/**
 * Speaks `text`, replacing anything already in progress.
 *
 * Returns false when speech could not be STARTED, so a caller can fall back.
 *
 * AI-NOTE: a `true` here means the utterance was queued without throwing, not
 *          that the user heard it — `speechSynthesis.speak` is fire-and-forget
 *          and failures surface asynchronously on the utterance. A caller whose
 *          fallback matters should not treat this as proof of audio.
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  const speech = synth();
  if (speech === null || text.trim() === '') return false;

  try {
    // Queueing would leave a stale sentence playing over the next one, which on
    // a rest timer means hearing the previous set announced during this one.
    speech.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const { rate, pitch } = voiceSettings(options.intensity ?? 3);
    utterance.rate = rate;
    utterance.pitch = pitch;

    const voice = pickVoice(refreshVoices(speech), options.lang ?? null, options.variant ?? 0);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else if (options.lang) {
      utterance.lang = options.lang;
    }

    speech.speak(utterance);
    return true;
  } catch {
    // A blocked or broken speech stack must not break the caller. The visual
    // cue is the primary signal.
    return false;
  }
}
