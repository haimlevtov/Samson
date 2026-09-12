/**
 * The playback races, driven by a fake audio element — rework PR 6.
 *
 * Each case is a sequence the shared hook runs on the session card or the Coach
 * tab and that nothing tested before it moved: FOUND IN REVIEW, and the guard
 * had changed shape in the move.
 */
import { describe, expect, it } from 'vitest';
import { createReplyPlayer, type ReplyClip } from './reply-player';

const CLIP: ReplyClip = { bytes: new Uint8Array([1, 2]), contentType: 'audio/wav' };

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness() {
  const plays: ReturnType<typeof deferred>[] = [];
  const revoked: string[] = [];
  const blocked: boolean[] = [];
  let pauses = 0;
  let made = 0;

  const audio = {
    src: '',
    play: () => {
      const d = deferred();
      plays.push(d);
      return d.promise;
    },
    pause: () => {
      pauses += 1;
    },
  };

  const player = createReplyPlayer({
    audio,
    toUrl: () => `blob:clip-${++made}`,
    revoke: (url) => revoked.push(url),
    onBlocked: (value) => blocked.push(value),
  });

  const settle = () => new Promise((r) => setTimeout(r, 0));
  const refused = () => Object.assign(new Error('refused'), { name: 'NotAllowedError' });

  return {
    player,
    audio,
    plays,
    revoked,
    settle,
    refused,
    blocked: () => blocked.at(-1),
    pauses: () => pauses,
  };
}

describe('createReplyPlayer', () => {
  it('stops the previous clip even when the next answer has none', () => {
    // A text-only answer must not leave the last voice talking under its words.
    const h = harness();
    h.player.play(CLIP);
    const before = h.pauses();
    h.player.play(null);
    expect(h.pauses()).toBe(before + 1);
  });

  it('treats an autoplay refusal as recoverable, not a failure', async () => {
    const h = harness();
    let unplayable = false;
    h.player.play(CLIP, () => (unplayable = true));
    h.plays[0]!.reject(h.refused());
    await h.settle();

    expect(h.blocked()).toBe(true);
    // The clip was paid for and is still loaded — it is not "failed".
    expect(unplayable).toBe(false);
  });

  it('ignores a rejection from a clip a later answer has replaced', async () => {
    /*
     * THE GUARD. Without it, a refused autoplay from answer one sets `blocked`
     * under answer two, and the replay button then plays answer one's clip.
     */
    const h = harness();
    let firstUnplayable = false;
    h.player.play(CLIP, () => (firstUnplayable = true));
    h.player.play(CLIP);

    h.plays[0]!.reject(h.refused());
    h.plays[0]!.reject(new Error('decode'));
    await h.settle();

    expect(h.blocked()).toBe(false);
    expect(firstUnplayable).toBe(false);
  });

  it('reports a clip that will never play', async () => {
    const h = harness();
    let unplayable = false;
    h.player.play(CLIP, () => (unplayable = true));
    h.plays[0]!.reject(new Error('the source is not supported'));
    await h.settle();
    expect(unplayable).toBe(true);
  });

  it('revokes the previous URL before making the next', () => {
    // A leaked blob per answer is a leak per question.
    const h = harness();
    h.player.play(CLIP);
    h.player.play(CLIP);
    expect(h.revoked).toEqual(['blob:clip-1']);
    expect(h.audio.src).toBe('blob:clip-2');
  });

  it('does nothing at all once disposed', async () => {
    const h = harness();
    let unplayable = false;
    h.player.play(CLIP, () => (unplayable = true));
    h.player.dispose();
    h.plays[0]!.reject(new Error('late'));
    await h.settle();

    expect(unplayable).toBe(false);
    expect(h.revoked).toContain('blob:clip-1');
    h.player.play(CLIP);
    expect(h.plays).toHaveLength(1);
  });

  it('keeps the button on a second autoplay refusal', async () => {
    const h = harness();
    h.player.play(CLIP);
    h.plays[0]!.reject(h.refused());
    await h.settle();

    const replay = h.player.replay();
    h.plays[1]!.reject(h.refused());
    await replay;
    expect(h.blocked()).toBe(true);
  });

  it('drops the button and reports it when a replay can never play', async () => {
    /*
     * FOUND IN REVIEW: every replay rejection read as "still refused", so a clip
     * that could not decode left a "Tap to play" that never worked and never
     * said so.
     */
    const h = harness();
    let unplayable = false;
    h.player.play(CLIP, () => (unplayable = true));
    h.plays[0]!.reject(h.refused());
    await h.settle();

    const replay = h.player.replay();
    h.plays[1]!.reject(new Error('the source is not supported'));
    await replay;

    expect(h.blocked()).toBe(false);
    expect(unplayable).toBe(true);
  });
});
