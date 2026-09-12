/**
 * The one decision on the Coach tab's voice path that has to be held by a test
 * — rework PR 6. `performReply` itself does I/O and is exercised through the
 * session card and the db suite; what is pinned here is what happens AROUND it.
 */
import { describe, expect, it, vi } from 'vitest';
import { MissingApiKeyError } from '../llm/config';
import { BudgetExceededError } from '../llm/types';
import { speakIfAsked, type Performance } from './perform';

const CLIP: Performance = {
  audio: { bytes: new Uint8Array([1, 2]), contentType: 'audio/wav' },
  silent: null,
  coach: 'The Austrian',
};

describe('speakIfAsked', () => {
  it('does not speak, and does not spend, when the switch is off', async () => {
    const perform = vi.fn(async () => CLIP);
    expect(await speakIfAsked({ wanted: false, reply: 'Squat on Tuesday.' }, perform)).toEqual({
      audio: null,
      silent: 'not-asked',
      coach: null,
    });
    // The paid call is never made. Off by default is only a promise if this holds.
    expect(perform).not.toHaveBeenCalled();
  });

  it('has nothing to speak on the supplement route, whose answer is a row', async () => {
    const perform = vi.fn(async () => CLIP);
    expect(await speakIfAsked({ wanted: true, reply: null }, perform)).toEqual({
      audio: null,
      silent: null,
      coach: null,
    });
    expect(perform).not.toHaveBeenCalled();
  });

  it('speaks the reply it was given, and nothing else', async () => {
    const perform = vi.fn(async () => CLIP);
    expect(await speakIfAsked({ wanted: true, reply: 'Squat on Tuesday.' }, perform)).toBe(CLIP);
    expect(perform).toHaveBeenCalledWith('Squat on Tuesday.');
  });

  it("names the two refusals that are the user's business", async () => {
    const noKey = async () => {
      throw new MissingApiKeyError();
    };
    const spent = async () => {
      throw new BudgetExceededError(0.5, 0.5);
    };
    expect((await speakIfAsked({ wanted: true, reply: 'x' }, noKey)).silent).toBe('no-key');
    expect((await speakIfAsked({ wanted: true, reply: 'x' }, spent)).silent).toBe('budget');
  });

  it('NEVER rejects, so a failure to speak cannot cost the written answer', async () => {
    /*
     * THE INVARIANT THIS FUNCTION EXISTS FOR. It runs after the chat call has
     * succeeded. If it rejected, the action's outer catch would replace a reply
     * the user can read with "the coach could not answer that one" — trading an
     * answer for an error over something as minor as a voice.
     */
    const onFailure = vi.fn();
    const broken = async (): Promise<Performance> => {
      throw new Error('upstream 502 with a body that must not be logged whole');
    };
    const result = await speakIfAsked({ wanted: true, reply: 'x' }, broken, onFailure);
    expect(result).toEqual({ audio: null, silent: 'failed', coach: null });
    // Handed to the caller to log by name — never swallowed without a trace.
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
