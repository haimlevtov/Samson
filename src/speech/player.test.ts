/**
 * Tests for `src/speech/player.ts` — the Voice card's fetching, cache and
 * in-flight presses, driven with a fake audio element and a scripted action.
 *
 * The first version of this logic lived in the component, untested, and review
 * found three bugs in it: a clip that would not play was cached forever, a
 * second press mid-fetch paid twice and leaked a URL, and a clip arriving after
 * unmount leaked. Each has a case below that fails against that version.
 */
import { describe, expect, it } from 'vitest';
import { createCoachPlayer, type AudioLike, type PlayerState, type VoiceResult } from './player';

/** An <audio> element whose play() the test settles, and whose events it fires. */
class FakeAudio implements AudioLike {
  src = '';
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pauses = 0;
  plays: { src: string; resolve: () => void; reject: (cause: unknown) => void }[] = [];

  play(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.plays.push({ src: this.src, resolve, reject });
    });
  }

  pause(): void {
    this.pauses += 1;
  }

  /** The browser starting playback. */
  start(): void {
    this.plays.at(-1)?.resolve();
    this.onplaying?.();
  }
}

const OK: VoiceResult = {
  ok: true,
  audio: new Uint8Array([0xff, 0xf3]),
  contentType: 'audio/mpeg',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Settles every promise already queued, so a continuation has run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  const audio = new FakeAudio();
  const calls: { slug: string; answer: ReturnType<typeof deferred<VoiceResult>> }[] = [];
  const made: string[] = [];
  const revoked: string[] = [];
  let state: PlayerState | null = null;

  const player = createCoachPlayer({
    audio,
    fetchClip: (slug) => {
      const answer = deferred<VoiceResult>();
      calls.push({ slug, answer });
      return answer.promise;
    },
    toUrl: () => {
      const url = `blob:clip-${made.length + 1}`;
      made.push(url);
      return url;
    },
    revoke: (url) => revoked.push(url),
    onChange: (next) => (state = next),
  });

  return {
    audio,
    calls,
    made,
    revoked,
    player,
    state: () => state ?? player.state,
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
    const first = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve(OK);
    await first;

    await h.player.hear('sergeant');

    expect(h.calls).toHaveLength(1);
    expect(h.audio.plays).toHaveLength(2);
  });

  it('shows the refusal and plays nothing when the server says no', async () => {
    const h = harness();
    const pressed = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve({ ok: false, reason: 'budget' });
    await pressed;

    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'budget' });
    expect(h.audio.plays).toHaveLength(0);
  });

  it('shows a failure when the action itself throws', async () => {
    const h = harness();
    const pressed = h.player.hear('sergeant');
    h.calls[0]!.answer.reject(new Error('network'));
    await pressed;

    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'failed' });
  });

  it('drops a clip that will not play, so the next press fetches it again', async () => {
    // FOUND IN REVIEW: the cache kept it, and "Try again" replayed the same
    // broken clip on every press until the page was reloaded.
    const h = harness();
    const first = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve(OK);
    await first;

    h.audio.onerror?.();
    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'failed' });
    expect(h.revoked).toEqual(['blob:clip-1']);

    const again = h.player.hear('sergeant');
    expect(h.calls).toHaveLength(2);
    h.calls[1]!.answer.resolve(OK);
    await again;
    expect(h.audio.src).toBe('blob:clip-2');
  });

  it('treats a rejected play() that is not a block as a failure too', async () => {
    const h = harness();
    const first = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve(OK);
    await first;

    h.audio.plays[0]!.reject(Object.assign(new Error('bad format'), { name: 'NotSupportedError' }));
    await settle();

    expect(h.state().shown?.reason).toBe('failed');
    expect(h.revoked).toEqual(['blob:clip-1']);
  });

  it('keeps a clip the browser blocked, so the next tap plays it inside the tap', async () => {
    const h = harness();
    const first = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve(OK);
    await first;

    h.audio.plays[0]!.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' }));
    await settle();
    expect(h.state().shown).toEqual({ slug: 'sergeant', reason: 'blocked' });
    expect(h.revoked).toEqual([]);

    // Synchronous from the cache: play() is called before hear() returns.
    void h.player.hear('sergeant');
    expect(h.audio.plays).toHaveLength(2);
    expect(h.calls).toHaveLength(1);
  });

  it('joins the call in flight when the same coach is pressed again mid-fetch', async () => {
    // FOUND IN REVIEW: re-pressing paid twice and leaked the first URL.
    const h = harness();
    const first = h.player.hear('sergeant');
    h.player.select(); // the lit chip, or away and back
    const second = h.player.hear('sergeant');

    expect(h.calls).toHaveLength(1);
    h.calls[0]!.answer.resolve(OK);
    await Promise.all([first, second]);

    expect(h.made).toEqual(['blob:clip-1']);
    expect(h.audio.plays).toHaveLength(1);
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
    const a = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve(OK);
    await a;
    const b = h.player.hear('physio');
    h.calls[1]!.answer.resolve(OK);
    await b;

    h.player.dispose();

    expect(h.live()).toEqual([]);
  });

  it('clears "playing" when something other than Stop pauses the audio', async () => {
    // An OS interruption or unplugged headphones: without this the button
    // would still say Stop with nothing playing.
    const h = harness();
    const pressed = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve(OK);
    await pressed;
    h.audio.start();
    expect(h.state().playing).toBe('sergeant');

    h.audio.onpause?.();
    expect(h.state().playing).toBeNull();
  });

  it('ignores the AbortError of a clip it replaced', async () => {
    const h = harness();
    const a = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve(OK);
    await a;
    const b = h.player.hear('physio');
    h.calls[1]!.answer.resolve(OK);
    await b;

    h.audio.plays[0]!.reject(Object.assign(new Error('replaced'), { name: 'AbortError' }));
    await settle();

    expect(h.state().shown).toBeNull();
    expect(h.revoked).toEqual([]);
  });

  it('lets an event from a replaced clip touch nothing', async () => {
    const h = harness();
    const a = h.player.hear('sergeant');
    h.calls[0]!.answer.resolve(OK);
    await a;
    const staleError = h.audio.onerror;

    const b = h.player.hear('physio');
    h.calls[1]!.answer.resolve(OK);
    await b;
    h.audio.start();

    staleError?.();
    expect(h.state().playing).toBe('physio');
    expect(h.state().shown).toBeNull();
  });
});
