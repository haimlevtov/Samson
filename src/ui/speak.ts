/**
 * The app's voice, such as it is.
 *
 * ADR 0006 records the reduction honestly: this is the browser's own
 * `speechSynthesis`, not a TTS provider, because the only key this project has
 * is for text. Nothing is precomputed, and no persona gets a recorded timbre.
 *
 * What it CAN do, and now does: hand each persona the KIND of voice it asks for,
 * from the voices the device already has, and shape it with the persona's own
 * pitch and rate. `personas.tts_voice_id` narrows the field to a language,
 * `tts_voice_gender` to a kind, and `variant` then picks a distinct voice within
 * that. Before rework PR 6b the voice was the Nth of a language sorted by name
 * and its pitch rose with intensity, so the Sergeant took Zira — a light female
 * voice — at the highest pitch of the five. Position is not character.
 *
 * What it CANNOT do: make a device voice into an actor. A coach speaks in
 * whatever voice the device has; character beyond kind and shape needs audio,
 * and the project has no provider for it — ADR 0006, amended 2026-09-11.
 *
 * AI-NOTE: every entry point here is safe to call when speech is unavailable —
 *          an old browser, a locked-down device, a headless test runner. Speech
 *          is an enhancement on top of a visual cue that always fires; it is
 *          never the only signal that something happened.
 */

import type { VoiceGender } from '../persona/schema';

export type { VoiceGender };

/** The part of `SpeechSynthesisVoice` this module reasons about. */
export interface VoiceLike {
  name: string;
  lang: string;
}

export interface SpeakOptions {
  /** BCP-47 hint from `personas.tts_voice_id`, e.g. "en-GB". Best effort. */
  lang?: string | null;
  /** The kind of voice to take first, where the device has one of that kind. */
  gender?: VoiceGender | null;
  /**
   * The speaker's own shape, from `personas.tts_pitch` and `tts_rate`. When both
   * are given they are used as they are; otherwise `intensity` is mapped onto
   * them, which is what a caller with no persona — the rest timer — still gets.
   */
  pitch?: number;
  rate?: number;
  /** 1–5. Used only when `pitch` and `rate` are not given — see `voiceSettings`. */
  intensity?: number;
  /**
   * Which voice to take when the language leaves several to choose from.
   *
   * The caller owns this because only the caller knows how many speakers it is
   * trying to keep apart. The coach console passes `personas.tts_voice_variant`
   * — a COLUMN since migration 20260907120000, not a list index, because an
   * index is reassigned by adding any persona before it in the ordering.
   *
   * AI-NOTE: this said "each persona's index, so three personas take three
   *          different voices". Both halves went stale: the index became a
   *          column, and there are five personas, three of them en-GB. The
   *          accurate claim is ADR 0006's — the voices matching a persona's
   *          LANGUAGE are what get allocated, so three en-GB coaches need three
   *          installed en-GB voices to sound like three people, and most
   *          machines have fewer. That is the platform's limit, not the app's.
   */
  variant?: number;
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
   * INVARIANT: fires at most once per utterance, and NEVER for a cancellation.
   *            `speech.cancel()` below and `stopSpeaking()` both raise `error`
   *            on the utterance they superseded, so without that filter pressing
   *            the button twice would beep at you for the utterance you replaced.
   */
  onFailure?: () => void;
}

/**
 * Utterance errors that mean "something else stopped this", not "this failed".
 *
 * AI-NOTE: keep these out of onFailure. They are the normal result of replacing
 *          or stopping speech, which the caller asked for.
 */
const CANCELLATION: ReadonlySet<string> = new Set(['interrupted', 'canceled', 'cancelled']);

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
// Typed as what it actually holds — it is only ever assigned from getVoices()
// — so returning it needs no assertion the checker cannot verify.
let cachedVoices: SpeechSynthesisVoice[] = [];
let primed = false;

function refreshVoices(speech: SpeechSynthesis): SpeechSynthesisVoice[] {
  const live = speech.getVoices();
  if (live.length > 0) cachedVoices = live;
  return live.length > 0 ? live : cachedVoices;
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

  /*
   * WHY `primed` is set AFTER a listener is attached, and why there is a
   * fallback: an earlier version latched it first and then called
   * `addEventListener?.()`, so on an implementation without that method the
   * module was permanently marked primed with no listener at all — the voice
   * list then only ever refreshed inside `speak()`, which is the empty-first-
   * call bug this whole cache exists to prevent, silently back.
   */
  if (typeof speech.addEventListener === 'function') {
    speech.addEventListener('voiceschanged', () => {
      refreshVoices(speech);
    });
    primed = true;
  } else {
    speech.onvoiceschanged = () => {
      refreshVoices(speech);
    };
    primed = speech.onvoiceschanged !== null;
  }
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

/*
 * What a device voice's NAME says about it — the only thing a browser exposes.
 *
 * Google's names carry the word ("Google UK English Male"); Microsoft's carry a
 * first name, desktop ("Microsoft Zira") and Edge's neural ones alike
 * ("Microsoft Guy Online (Natural)"). The lists hold the names those engines
 * ship; a voice matching neither is of unknown kind, and is never excluded for
 * it — only preferred against.
 *
 * AI-NOTE: device metadata, not persona content — CLAUDE.md #7 is about what a
 *          coach IS, which lives in the row. A voice missing from a list simply
 *          counts as unknown; add a name when an engine ships one.
 */
const FEMALE_VOICE =
  /\b(female|woman|zira|hazel|susan|heera|sonia|libby|maisie|mia|aria|jenny|michelle|ana|emma|ava|cora|elizabeth|monica|nancy|sara|jane|amber|ashley|samantha|karen|moira|tessa|serena|victoria|allison|kate|fiona|catherine|natasha|clara|salli|joanna|kimberly|ivy|kendra|amy)\b/i;
const MALE_VOICE =
  /\b(male|man|david|mark|george|ravi|ryan|thomas|guy|davis|tony|jason|eric|christopher|andrew|brian|roger|steffan|jacob|daniel|oliver|arthur|fred|alex|tom|rishi|aaron|william|liam|james|matthew|joey|justin|kevin|russell)\b/i;

/** The kind of voice a device voice's name marks, or null when it marks none. */
export function voiceGender(voice: VoiceLike): VoiceGender | null {
  // Female first: "Female" contains "male", though the word boundary already
  // keeps the male pattern from matching inside it.
  if (FEMALE_VOICE.test(voice.name)) return 'female';
  if (MALE_VOICE.test(voice.name)) return 'male';
  return null;
}

/**
 * Better voices first: 0 for a neural voice ("Natural", "Neural" — Edge's,
 * free with the browser), 1 for an online one or Google's, 2 for a desktop
 * voice. The same coach should sound better in the browser that offers better.
 */
export function voiceTier(voice: VoiceLike): number {
  if (/\b(natural|neural)\b/i.test(voice.name)) return 0;
  if (/\b(online|google)\b/i.test(voice.name)) return 1;
  return 2;
}

/**
 * Picks a voice for a language hint: of the wanted kind where the device has
 * one, better voices first, then distinct per `variant`.
 *
 * WHY kind before variant (rework plan PR 6b): picking the Nth voice of a
 * language by name gave the Sergeant a light female voice on a machine whose
 * third en voice happened to be Zira. A device with no voice of the wanted kind
 * falls back to the whole language — the coach still speaks, and its pitch and
 * rate carry the character.
 *
 * Sorted by tier, then by name, before indexing, because `getVoices()` order is
 * not specified and differs between browsers: without a stable sort the same
 * persona would take a different voice depending on which engine loaded first.
 *
 * Returns null with no language hint — the caller gets the system default,
 * which is the right behaviour for an announcement that is not in a persona's
 * voice at all.
 */
export function pickVoice<T extends VoiceLike>(
  available: readonly T[],
  lang: string | null,
  variant = 0,
  gender: VoiceGender | null = null
): T | null {
  if (available.length === 0 || lang === null) return null;

  const language = candidatesFor(available, lang);
  if (language.length === 0) return null;

  const kind = gender === null ? [] : language.filter((v) => voiceGender(v) === gender);
  const pool = kind.length > 0 ? kind : language;

  const ordered = [...pool].sort(
    (a, b) => voiceTier(a) - voiceTier(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
  const index = ((variant % ordered.length) + ordered.length) % ordered.length;
  return ordered[index] ?? null;
}

/**
 * Intensity 1–5 onto rate and pitch — for a caller with no persona.
 *
 * A coach's voice comes from its row now (`personaSpeech`); this is what the
 * rest timer's "Rest over." and any other persona-less announcement gets.
 * Deliberately a narrow range — anything wider stops sounding like a person.
 */
export function voiceSettings(intensity: number): { rate: number; pitch: number } {
  const clamped = Math.min(5, Math.max(1, intensity));
  return {
    rate: 0.9 + (clamped - 1) * 0.075,
    pitch: 0.9 + (clamped - 1) * 0.05,
  };
}

/**
 * How much slower a coach speaks on a week the app has judged gentle.
 *
 * WHY the rate and not the pitch: the gentle flag already softens the WORDS
 * (ADR 0006 — computed from the log before any model is involved), and the
 * app says "Gentler tone" on screen, so reading it out at the coach's usual
 * clip contradicted it. Pitch is the coach's character; slowing down is how a
 * person softens, and lowering the Physio's pitch would make her someone else.
 */
export const GENTLE_RATE_FACTOR = 0.9;

/** The fields of a persona row its voice needs — every one of them from the row. */
export interface VoicedPersona {
  /** BCP-47 hint from `personas.tts_voice_id`. */
  voice: string | null;
  voiceVariant: number;
  /** `personas.tts_voice_gender` — the kind of device voice to take first. */
  voiceGender: VoiceGender | null;
  /** `personas.tts_pitch` and `tts_rate`, 0.5–1.5. */
  pitch: number;
  rate: number;
}

/** The fields of a persona row a preview needs. */
export interface PreviewablePersona extends VoicedPersona {
  sampleLine: string | null;
}

/**
 * How a persona sounds: the settings every utterance in its voice is spoken
 * with. Null — no coach known yet — takes a plain default voice.
 *
 * AI-NOTE: the ONE definition of a coach's voice settings. The delivery's "Read
 *          it aloud" and the preview both call it, so what a user hears in the
 *          preview is what they get from that coach afterwards. FOUND IN REVIEW
 *          of PR #46: the two were built separately, and nothing kept them in
 *          step. Since PR 6b every value comes from the row; intensity no
 *          longer reaches the voice.
 */
export function personaSpeech(
  persona: VoicedPersona | null,
  gentle: boolean
): Omit<SpeakOptions, 'onFailure'> {
  const rate = persona?.rate ?? 1;
  return {
    lang: persona?.voice ?? null,
    variant: persona?.voiceVariant ?? 0,
    gender: persona?.voiceGender ?? null,
    pitch: persona?.pitch ?? 1,
    rate: gentle ? rate * GENTLE_RATE_FACTOR : rate,
  };
}

/**
 * What a coach's preview says, and the settings to say it with. Null when the
 * row has no line, so the caller renders nothing rather than a silent button.
 *
 * WHY `personaSpeech` rather than defaults: the preview answers "what does this
 * coach sound like", so it has to be the coach the user is about to choose.
 * Never gentle: the gentle flag comes from a training log, and a preview has
 * none to read.
 */
export function previewSpeech(
  persona: PreviewablePersona
): { text: string; options: Omit<SpeakOptions, 'onFailure'> } | null {
  const text = persona.sampleLine?.trim() ?? '';
  if (text === '') return null;
  return { text, options: personaSpeech(persona, false) };
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
 *          fallback matters must pass `onFailure` and not treat `true` as proof
 *          of audio. `RestTimer` is the caller this matters most for.
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  const speech = synth();
  if (speech === null || text.trim() === '') return false;

  try {
    // Queueing would leave a stale sentence playing over the next one, which on
    // a rest timer means hearing the previous set announced during this one.
    speech.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    // The persona's own shape when the caller has one; the intensity mapping
    // otherwise, which is what a persona-less announcement gets.
    const { rate, pitch } =
      options.pitch !== undefined && options.rate !== undefined
        ? { rate: options.rate, pitch: options.pitch }
        : voiceSettings(options.intensity ?? 3);
    utterance.rate = rate;
    utterance.pitch = pitch;

    const voice = pickVoice(
      refreshVoices(speech),
      options.lang ?? null,
      options.variant ?? 0,
      options.gender ?? null
    );
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else if (options.lang) {
      utterance.lang = options.lang;
    }

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
