/**
 * The app's voice, such as it is.
 *
 * ADR 0006 records the reduction honestly: this is the browser's own
 * `speechSynthesis`, not a TTS provider, because the only key this project has
 * is for text. Persona voice is therefore tone and word choice, not timbre, and
 * nothing is precomputed. PLAN.md phase 3 asked for generated clips; this is
 * what was built instead.
 *
 * AI-NOTE: every entry point here is safe to call when speech is unavailable —
 *          an old browser, a locked-down device, a headless test runner. Speech
 *          is an enhancement on top of a visual cue that always fires; it is
 *          never the only signal that something happened.
 */

export interface SpeakOptions {
  /** BCP-47 hint from `personas.tts_voice_id`, e.g. "en-GB". Best effort. */
  lang?: string | null;
  /** 1–5 from the persona row. Drives rate and pitch, since timbre is not ours. */
  intensity?: number;
}

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

/** Whether this browser can speak at all. */
export function canSpeak(): boolean {
  return synth() !== null;
}

/**
 * Picks the closest available voice for a language hint.
 *
 * WHY closest rather than exact: the installed voice list is entirely the
 * device's business. Asking for en-GB on a machine that only has en-US should
 * speak in American English, not fall silent.
 */
function pickVoice(
  available: SpeechSynthesisVoice[],
  lang: string | null
): SpeechSynthesisVoice | null {
  if (available.length === 0) return null;
  if (lang === null) return null;

  const exact = available.find(
    (v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase()
  );
  if (exact) return exact;

  const prefix = lang.split('-')[0]?.toLowerCase() ?? '';
  return available.find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? null;
}

/**
 * Intensity 1–5 onto rate and pitch.
 *
 * The Analyst at 2 is measured; the Rival at 4 is faster and a little sharper.
 * Deliberately a narrow range — anything wider stops sounding like a person.
 */
export function voiceSettings(intensity: number): { rate: number; pitch: number } {
  const clamped = Math.min(5, Math.max(1, intensity));
  return {
    rate: 0.9 + (clamped - 1) * 0.075,
    pitch: 0.9 + (clamped - 1) * 0.05,
  };
}

/** Stops anything currently being spoken. Safe when speech is unavailable. */
export function stopSpeaking(): void {
  synth()?.cancel();
}

/**
 * Speaks `text`, replacing anything already in progress.
 *
 * Returns false when speech was unavailable, so a caller can fall back rather
 * than assume it was heard.
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

    const voice = pickVoice(speech.getVoices(), options.lang ?? null);
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
