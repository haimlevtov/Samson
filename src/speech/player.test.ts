/**
 * Tests for `src/speech/player.ts` — the Voice card's fetching, cache and
 * in-flight presses, driven with a fake audio element and a scripted action.
 *
 * The first version of this logic lived in the component, untested, and the
 * resilience review found four bugs in it: a clip that would not play was
 * cached forever, a second press mid-fetch paid twice and leaked a URL, a clip
 * arriving after unmount leaked, and Stop stayed up after the OS paused the
 * audio. The second review found two more in the module itself: a cached
 * replay did not supersede a fetch in flight, and a URL that could not be made
 * left the press on "Finding…". Each has a case below; the author removed each
 * fix in turn and its case failed.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PLAYER,
  createCoachPlayer,
  whyShown,
  type AudioLike,
  type PlayerState,
  type VoiceResult,
} from './player';

/**
 * An <audio> element whose play() the test settles, and whose CURRENT handlers
 * it fires — as a browser does. Setting `src` drops the old clip's queued
 * events, so a test never fires a handler it saved from an earlier clip.
 */
class FakeAudio implements AudioLike {
  src = '';
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onerror: (() => void) | null = null;
  plays: { src: string; resolve: () => void; reject: (cause: unknown) => void }[] = [];

  play(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.plays.push({ src: this.src, resolve, reject });
    });
  }

  pause(): void {}

  /** The browser starting playback. */
  start(): void {
    this.plays.at(-1)?.resolve();
    this.onplaying?.();
  }
}

const OK: VoiceResult = {
  ok: true,
  audio: new Uint8Array([0, 0]),
  contentType: 'audio/wav',
};

const named = (name: string) => Object.assign(new Error(name), { name });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every promise already queued run its continuation. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(options: { toUrl?: () => string } = {}) {
  const audio = new FakeAudio();
  const calls: { slug: string; answer: ReturnType<typeof deferred<VoiceResult>> }[] = [];
  const made: string[] = [];
  const revoked: string[] = [];
  let changes = 0;
  let state: PlayerState = EMPTY_PLAYER;

  const player = createCoachPlayer({
    audio,
    fetchClip: (slug) => {
      const answer = deferred<VoiceResult>();
      calls.push({ slug, answer });
      return answer.promise;
    },
    toUrl:
      options.toUrl ??
      (() => {
        const url = `blob:clip-${made.length + 1}`;
        made.push(url);
        return url;
      }),
    revoke: (url) => revoked.push(url),
    onChange: (next) => {
      changes += 1;
      state = next;
    },
  });

  /** Press Try for a coach and let its fetch come back with `result`. */
  const heard = async (slug: string, result: VoiceResult = OK) => {
    const pressed = player.hear(slug);
    calls.at(-1)!.answer.resolve(result);
    await pressed;
  };

  return {
    audio,
    calls,
    made,
    revoked,
    player,
    heard,
    state: () => state,
    changes: () => changes,
    /** URLs made and not yet revoked — a leak, once the card is gone. */
    live: () => made.filter((url) => !revoked.includes(url)),
  };
}

describe('the coach player', () => {
  it('fetches a clip, plays it, and says it is playing once it starts', async () => {
    const h = harness();
    const pressed = h.player.hear('sergeant');
    expect(h.state().fetching).toBe('sergeant');

    h.calls[0]!.answer.resolve(OK);
    await pressed;

    expect(h.audio.src).toBe('blob:clip-1');
    expect(h.state().fetching).toBeNull();
    h.audio.start();
    expect(h.state().playing).toBe('sergeant');
  });

  it('replays from the cache without a second paid call', async () => {
    const h = harness();
    await h.heard('sergeant');

    await h.player.hear('sergeant');

    expect(h.calls).toHaveLength(1);
    expect(h.audio.plays).toHaveLength(2);
  });

  it('shows the refusal and plays nothing when the server says no', async () => {
    const h = harness();
    await h.heard('sergeant', { ok: false, reason: 'budget' });

    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'budget' });
    expect(h.audio.plays).toHaveLength(0);
  });

  it('clears the last refusal the moment the next press starts', async () => {
    const h = harness();
    await h.heard('sergeant', { ok: false, reason: 'failed' });

    void h.player.hear('sergeant');
    expect(h.state().shown).toBeNull();
    expect(h.state().fetching).toBe('sergeant');
  });

  it('shows a failure when the action itself throws', async () => {
    const h = harness();
    const pressed = h.player.hear('sergeant');
    h.calls[0]!.answer.reject(new Error('network'));
    await pressed;

    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'failed' });
  });

  it('shows a failure, not "Finding…" forever, when the clip cannot be made into a URL', async () => {
    // FOUND IN THE SECOND REVIEW: a throw inside the success handler escaped
    // the error handler beside it, and the press was never settled.
    const h = harness({
      toUrl: () => {
        throw new Error('no blob');
      },
    });
    await h.heard('sergeant');

    expect(h.state().fetching).toBeNull();
    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'failed' });
  });

  it('drops a clip that will not play, so the next press fetches it again', async () => {
    // FOUND IN REVIEW: the cache kept it, and "Try again" replayed the same
    // broken clip on every press until the page was reloaded.
    const h = harness();
    await h.heard('sergeant');

    h.audio.onerror?.();
    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'failed' });
    expect(h.revoked).toEqual(['blob:clip-1']);

    await h.heard('sergeant');
    expect(h.calls).toHaveLength(2);
    expect(h.audio.src).toBe('blob:clip-2');
  });

  it('treats a rejected play() that is not a block as a failure too', async () => {
    const h = harness();
    await h.heard('sergeant');

    h.audio.plays[0]!.reject(named('NotSupportedError'));
    await settle();

    expect(h.state().shown?.reason).toBe('failed');
    expect(h.revoked).toEqual(['blob:clip-1']);
  });

  it('keeps a clip the browser blocked, so the next tap plays it inside the tap', async () => {
    const h = harness();
    await h.heard('sergeant');

    h.audio.plays[0]!.reject(named('NotAllowedError'));
    await settle();
    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'blocked' });
    expect(h.revoked).toEqual([]);

    // Synchronous from the cache: play() is called before hear() returns.
    void h.player.hear('sergeant');
    expect(h.audio.plays).toHaveLength(2);
    expect(h.calls).toHaveLength(1);
  });

  it('does not count an AbortError as a failure, even for the clip still current', async () => {
    // The browser raises it when playback is interrupted — an OS pause while
    // the clip loads. Evicting on it would make the next press pay again.
    const h = harness();
    await h.heard('sergeant');

    h.audio.plays[0]!.reject(named('AbortError'));
    await settle();

    expect(h.state().shown).toBeNull();
    expect(h.revoked).toEqual([]);
  });

  it('joins the call in flight when the same coach is pressed twice', async () => {
    // The Try button stays enabled while it fetches, so this is the ordinary
    // double tap. FOUND IN REVIEW: re-pressing paid twice and leaked a URL.
    const h = harness();
    const first = h.player.hear('sergeant');
    const second = h.player.hear('sergeant');

    expect(h.calls).toHaveLength(1);
    h.calls[0]!.answer.resolve(OK);
    await Promise.all([first, second]);

    expect(h.made).toEqual(['blob:clip-1']);
    expect(h.audio.plays).toHaveLength(1);
  });

  it('joins the call in flight after going away to another coach and back', async () => {
    const h = harness();
    const first = h.player.hear('sergeant');
    h.player.select(); // away to another coach…
    h.player.select(); // …and back
    const second = h.player.hear('sergeant');

    expect(h.calls).toHaveLength(1);
    h.calls[0]!.answer.resolve(OK);
    await Promise.all([first, second]);

    expect(h.made).toEqual(['blob:clip-1']);
    expect(h.audio.plays).toHaveLength(1);
  });

  it('never plays the first of two presses when the second is for another coach', async () => {
    /*
     * THE RACE SIX BUTTONS RUN, and the one this suite did not have — FOUND IN
     * REVIEW of rework PR 5. Every existing supersede case goes through
     * `select()` or a cached replay; the welcome flow's coach step calls neither,
     * because picking a radio there is deliberately independent of the audio. Its
     * only supersede is one uncached press overtaking another.
     *
     * Deleting `if (mine !== press || disposed) return;` from `hear` left the
     * whole suite green before this case existed. What the user would get is the
     * first coach talking over the one they just pressed.
     */
    const h = harness();
    const first = h.player.hear('old-master');
    const second = h.player.hear('sergeant');
    expect(h.state().fetching).toBe('sergeant');

    // Out of order on purpose: the superseded one is the one that lands first.
    h.calls[0]!.answer.resolve(OK);
    h.calls[1]!.answer.resolve(OK);
    await Promise.all([first, second]);

    // One clip reached the element, and it is the second press's.
    expect(h.audio.plays).toHaveLength(1);
    expect(h.audio.src).toBe('blob:clip-2');
    h.audio.start();
    expect(h.state().playing).toBe('sergeant');
    expect(h.state().fetching).toBeNull();
    // Never keyed to the coach that was superseded.
    expect(h.state().shown).toBeNull();
  });
  it("never plays one coach's clip after the user has moved to another", async () => {
    const h = harness();
    const pressed = h.player.hear('sergeant');
    h.player.select();

    h.calls[0]!.answer.resolve(OK);
    await pressed;

    expect(h.audio.plays).toHaveLength(0);
    expect(h.state().fetching).toBeNull();

    // The clip was kept: going back to that coach costs nothing.
    await h.player.hear('sergeant');
    expect(h.calls).toHaveLength(1);
    expect(h.audio.plays).toHaveLength(1);
  });

  it('lets a cached replay supersede a fetch still in flight', async () => {
    // FOUND IN THE SECOND REVIEW: the cached branch did not count as a newer
    // press, so the late clip arrived and cut the replay off.
    const h = harness();
    await h.heard('physio');

    const late = h.player.hear('sergeant');
    void h.player.hear('physio');
    expect(h.audio.src).toBe('blob:clip-1');
    expect(h.state().fetching).toBeNull();

    h.calls[1]!.answer.resolve(OK);
    await late;

    expect(h.audio.src).toBe('blob:clip-1');
    expect(h.audio.plays).toHaveLength(2);
  });

  it('makes no URL for a clip that arrives after the card is gone', async () => {
    // FOUND IN REVIEW: the late clip went into the cache unmount had just
    // cleared, and was never revoked.
    const h = harness();
    const pressed = h.player.hear('sergeant');
    h.player.dispose();

    h.calls[0]!.answer.resolve(OK);
    await pressed;

    expect(h.made).toEqual([]);
    expect(h.audio.plays).toHaveLength(0);
  });

  it('revokes every clip it made when the card is torn down', async () => {
    const h = harness();
    await h.heard('sergeant');
    await h.heard('physio');

    h.player.dispose();

    expect(h.live()).toEqual([]);
  });

  it('tells the card nothing after it is torn down', async () => {
    const h = harness();
    await h.heard('sergeant');
    h.player.dispose();
    const before = h.changes();

    h.audio.onplaying?.();
    h.audio.onerror?.();
    h.player.stop();
    h.player.select();
    await h.player.hear('physio');

    expect(h.changes()).toBe(before);
  });

  it('clears "playing" when something other than Stop pauses the audio', async () => {
    // An OS interruption or unplugged headphones: without this the button
    // would still say Stop with nothing playing.
    const h = harness();
    await h.heard('sergeant');
    h.audio.start();
    expect(h.state().playing).toBe('sergeant');

    h.audio.onpause?.();
    expect(h.state().playing).toBeNull();
  });

  it('ignores the stopped clip if it reports playing or failing after Stop', async () => {
    // Stop does not replace the handlers, so the stale-take check is the only
    // thing between a late event and a "Stop" button for silence — or an
    // eviction of a clip that was fine.
    const h = harness();
    await h.heard('sergeant');
    h.player.stop();

    h.audio.onplaying?.();
    h.audio.onerror?.();

    expect(h.state().playing).toBeNull();
    expect(h.state().shown).toBeNull();
    expect(h.revoked).toEqual([]);
  });

  it('ignores the old clip if it reports after a chip change', async () => {
    const h = harness();
    await h.heard('sergeant');
    h.player.select();

    h.audio.onplaying?.();
    h.audio.onerror?.();

    expect(h.state().playing).toBeNull();
    expect(h.revoked).toEqual([]);
  });

  it('ignores the AbortError of a clip it replaced', async () => {
    const h = harness();
    await h.heard('sergeant');
    await h.heard('physio');

    h.audio.plays[0]!.reject(named('AbortError'));
    await settle();

    expect(h.state().shown).toBeNull();
    expect(h.revoked).toEqual([]);
  });
});

describe('whyShown', () => {
  const voiced = { slug: 'sergeant', voiced: true };

  it('says nothing for a voiced coach with a key and no refusal', () => {
    expect(whyShown(EMPTY_PLAYER, voiced, true)).toBeNull();
  });

  it('explains a missing key before anything about the coach', () => {
    expect(whyShown(EMPTY_PLAYER, voiced, false)).toBe('no-key');
    expect(whyShown(EMPTY_PLAYER, { slug: 'mine', voiced: false }, false)).toBe('no-key');
  });

  it("explains a coach coachVoice would refuse — a user's own row", () => {
    expect(whyShown(EMPTY_PLAYER, { slug: 'mine', voiced: false }, true)).toBe('no-voice');
  });

  it('puts the last refusal first, and only for the coach it was about', () => {
    const refused: PlayerState = { ...EMPTY_PLAYER, shown: { slug: 'sergeant', reason: 'budget' } };
    expect(whyShown(refused, voiced, true)).toBe('budget');
    expect(whyShown(refused, { slug: 'physio', voiced: true }, true)).toBeNull();
  });

  it('says nothing with no coach chosen', () => {
    expect(whyShown(EMPTY_PLAYER, null, false)).toBeNull();
  });
});
