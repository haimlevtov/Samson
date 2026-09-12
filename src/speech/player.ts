/**
 * The Voice card's player: which coach is being fetched, which is playing, and
 * why a line is on screen instead of in the speaker — ADR 0025.
 *
 * WHY it is a plain module rather than logic inside the component: the
 * resilience bugs review found in the first version all lived in the press,
 * cache and in-flight bookkeeping — a failed clip cached forever, a second
 * press paying twice, a clip arriving after unmount and leaking, Stop left up
 * after the OS paused the audio — and a component under vitest's node
 * environment cannot be tested. Here the audio element, the server action and
 * the blob URLs are injected, so src/speech/player.test.ts drives every one of
 * those sequences with fakes.
 *
 * INVARIANT: no press pays for a clip already held or already coming — each
 *            fetch is charged against the user's weekly budget (ADR 0025,
 *            Cost). A replay plays from the cache, and a press while that
 *            coach is being fetched joins the call in flight. The next press
 *            pays again only after a clip fails to play or a fetch brings back
 *            none.
 * INVARIANT: a clip is played only for the press that is still current. A
 *            change of persona, any newer press — a cached replay included — or
 *            disposal supersedes it, so one coach's voice never arrives over
 *            another's.
 */

/** Why a coach's line is shown instead of heard. */
export type VoiceRefusal = 'no-key' | 'budget' | 'no-voice' | 'failed';

/**
 * What the server action returns. The audio crosses as bytes: React serialises
 * a Uint8Array in a server action's result as it is, so no encoding step is
 * needed on either side.
 */
export type VoiceResult =
  | { ok: true; audio: Uint8Array<ArrayBuffer>; contentType: string }
  | { ok: false; reason: VoiceRefusal };

/** `blocked` is the browser's own refusal to play, which the server never sees. */
export type ShownReason = VoiceRefusal | 'blocked';

export interface PlayerState {
  /** The coach whose clip the current press is waiting for. */
  fetching: string | null;
  /** The coach whose clip is playing now. */
  playing: string | null;
  /** The line is shown as text, for this coach, for this reason. */
  shown: { slug: string; reason: ShownReason } | null;
}

export const EMPTY_PLAYER: PlayerState = { fetching: null, playing: null, shown: null };

/**
 * Why the chosen coach's line is on screen as text, or null when it is not:
 * the last press's refusal first, then that there is no voice to ask for — no
 * key on the server, or a coach `coachVoice` would refuse (`voiced` false).
 *
 * WHY it is here rather than inline in the component: it is what decides
 * whether the card explains itself (docs/specs/mobile-interface.md §4), and
 * logic in a component cannot be tested under node.
 */
/**
 * Whether a Try button can be offered for this coach at all.
 *
 * FOUND IN REVIEW of rework PR 5: the two surfaces each wrote this predicate,
 * and differently — one trimmed the line and one did not. A shared row with a
 * whitespace-only `sample_line` would have shown a working-looking button on
 * one and, because `whyShown` returns null for a voiced coach with a key,
 * NOTHING AT ALL on the other, which is the §4 violation this module exists to
 * make testable. It lives beside `whyShown` for the same reason that one does.
 *
 * The two are complements: exactly one of a button and a sentence should show.
 */
export function canHear(
  coach: { voiced: boolean; sampleLine: string | null } | null,
  voiceAvailable: boolean
): boolean {
  return voiceAvailable && coach !== null && coach.voiced && (coach.sampleLine ?? '').trim() !== '';
}

export function whyShown(
  state: PlayerState,
  chosen: { slug: string; voiced: boolean } | null,
  voiceAvailable: boolean
): ShownReason | null {
  if (chosen === null) return null;
  if (state.shown?.slug === chosen.slug) return state.shown.reason;
  if (!voiceAvailable) return 'no-key';
  if (!chosen.voiced) return 'no-voice';
  return null;
}

/**
 * The part of HTMLAudioElement the player drives. The handlers take the event
 * the element passes, so a real element satisfies this; the player ignores it.
 */
export interface AudioLike {
  src: string;
  play(): Promise<void>;
  pause(): void;
  onplaying: ((event: Event) => unknown) | null;
  onended: ((event: Event) => unknown) | null;
  onpause: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
}

export interface PlayerDeps {
  audio: AudioLike;
  /** The server action. */
  fetchClip: (slug: string) => Promise<VoiceResult>;
  /** The bytes and their content type as a playable URL — a blob URL in the browser. */
  toUrl: (audio: Uint8Array<ArrayBuffer>, contentType: string) => string;
  revoke: (url: string) => void;
  onChange: (state: PlayerState) => void;
}

type Loaded = { ok: true; url: string } | { ok: false; reason: VoiceRefusal };

const named = (cause: unknown, name: string): boolean =>
  typeof cause === 'object' && cause !== null && (cause as { name?: unknown }).name === name;

export function createCoachPlayer(deps: PlayerDeps) {
  const { audio } = deps;
  let state: PlayerState = EMPTY_PLAYER;
  let disposed = false;

  /** Clips fetched this visit, by slug. */
  const clips = new Map<string, string>();
  /** Fetches in flight, by slug — what a second press joins. */
  const pending = new Map<string, Promise<Loaded>>();

  /** Bumped by every press, change of persona and disposal. */
  let press = 0;
  /**
   * Bumped by every play. The element is shared, so an event or a rejected
   * `play()` belonging to a clip that has since been replaced must not touch
   * the state of the one that replaced it.
   */
  let take = 0;

  const set = (patch: Partial<PlayerState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    deps.onChange(state);
  };

  /**
   * A clip that will not play is dropped from the cache and its URL revoked,
   * so the next press fetches it again. FOUND IN REVIEW: the first version kept
   * it, and every later press replayed the same broken clip under a message
   * saying "Try again".
   */
  const failed = (slug: string, url: string) => {
    set({ playing: null, shown: { slug, reason: 'failed' } });
    if (clips.get(slug) === url) {
      clips.delete(slug);
      deps.revoke(url);
    }
  };

  const play = (slug: string, url: string) => {
    const mine = ++take;
    const current = () => mine === take && !disposed;

    audio.pause();
    audio.src = url;
    audio.onplaying = () => {
      if (current()) set({ playing: slug });
    };
    audio.onended = () => {
      if (current()) set({ playing: null });
    };
    // An OS interruption, unplugged headphones or a lock-screen pause stops
    // the element without our Stop; without this the button would still say
    // "Stop" with nothing playing.
    audio.onpause = () => {
      if (current()) set({ playing: null });
    };
    audio.onerror = () => {
      if (current()) failed(slug, url);
    };

    audio.play().catch((cause: unknown) => {
      // AbortError is this code replacing or stopping the clip — not a failure,
      // the same distinction src/ui/speak.ts draws for utterances.
      if (!current() || named(cause, 'AbortError')) return;
      if (named(cause, 'NotAllowedError')) {
        // The browser held the sound back after the network wait. The clip
        // STAYS cached: the next tap plays it from here, inside the tap,
        // which is what the browser wants.
        set({ playing: null, shown: { slug, reason: 'blocked' } });
        return;
      }
      failed(slug, url);
    });
  };

  const load = (slug: string): Promise<Loaded> => {
    const inFlight = pending.get(slug);
    if (inFlight) return inFlight;

    const loading = deps
      .fetchClip(slug)
      .then((result): Loaded => {
        if (!result.ok) return { ok: false, reason: result.reason };
        // Arrived after the card was torn down: make no URL, so there is
        // nothing to leak. FOUND IN REVIEW.
        if (disposed) return { ok: false, reason: 'failed' };
        const existing = clips.get(slug);
        if (existing) return { ok: true, url: existing };
        const url = deps.toUrl(result.audio, result.contentType);
        clips.set(slug, url);
        return { ok: true, url };
      })
      // After the `then`, not as its second argument, so a throw INSIDE it —
      // a URL that cannot be made — is a failure the card shows, not a press
      // left on "Finding…" forever. FOUND IN THE SECOND REVIEW.
      .catch((): Loaded => ({ ok: false, reason: 'failed' }))
      .finally(() => pending.delete(slug));

    pending.set(slug, loading);
    return loading;
  };

  return {
    get state(): PlayerState {
      return state;
    },

    async hear(slug: string): Promise<void> {
      if (disposed) return;
      set({ shown: null });

      const cached = clips.get(slug);
      if (cached) {
        // A newer press, even one served from the cache, supersedes a fetch
        // still in flight — otherwise that clip arrives and cuts this one off.
        // FOUND IN THE SECOND REVIEW.
        press += 1;
        set({ fetching: null });
        play(slug, cached);
        return;
      }

      const mine = ++press;
      set({ fetching: slug });
      const loaded = await load(slug);
      if (mine !== press || disposed) return;

      set({ fetching: null });
      if (loaded.ok) play(slug, loaded.url);
      else set({ shown: { slug, reason: loaded.reason } });
    },

    /** Stops whatever is playing. */
    stop(): void {
      take += 1;
      audio.pause();
      set({ playing: null });
    },

    /**
     * The user picked a coach: the last one stops talking and any press still
     * in flight is superseded. Its clip is still kept when it arrives, so
     * coming back to that coach costs nothing.
     */
    select(): void {
      press += 1;
      take += 1;
      audio.pause();
      set({ fetching: null, playing: null, shown: null });
    },

    /** Unmount: stop, supersede everything, and revoke every URL made. */
    dispose(): void {
      press += 1;
      take += 1;
      disposed = true;
      audio.pause();
      for (const url of clips.values()) deps.revoke(url);
      clips.clear();
    },
  };
}

export type CoachPlayer = ReturnType<typeof createCoachPlayer>;
