/**
 * Hold-to-talk, proved without a DOM — ADR 0031 §1.
 *
 * The recogniser is injected, so every case here is the state machine rather
 * than the browser. What the browser does with `SpeechRecognition` is the one
 * thing this cannot prove, which is why the component holds as little as it can.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_LISTEN,
  createListener,
  transcriptOf,
  type ListenState,
  type RecognitionEvent,
  type Recogniser,
} from './listen';

/** A recogniser that records what was asked of it and fires nothing on its own. */
function fake() {
  const calls: string[] = [];
  const recogniser: Recogniser = {
    lang: '',
    continuous: true,
    interimResults: true,
    start: () => calls.push('start'),
    stop: () => calls.push('stop'),
    abort: () => calls.push('abort'),
    onresult: null,
    onerror: null,
    onend: null,
  };
  return { calls, recogniser };
}

function harness() {
  const { calls, recogniser } = fake();
  const heard: string[] = [];
  const states: ListenState[] = [];
  const listener = createListener({
    recogniser,
    onTranscript: (text) => heard.push(text),
    onChange: (state) => states.push(state),
  });
  return { calls, recogniser, heard, states, listener };
}

const resultFor = (...alternatives: string[]): RecognitionEvent => ({
  results: alternatives.map((transcript) => [{ transcript }]),
});

describe('createListener', () => {
  it('configures the recogniser for one utterance per hold', () => {
    const h = harness();
    // Interim results would be work nobody reads: the transcript is only taken
    // on release.
    expect(h.recogniser.continuous).toBe(false);
    expect(h.recogniser.interimResults).toBe(false);
    expect(h.recogniser.lang).toBe('en-US');
  });

  it('starts on press and asks for the final result on release', () => {
    const h = harness();
    h.listener.press();
    h.listener.release();

    // `stop`, never `abort`: abort would throw away the words just spoken.
    expect(h.calls).toEqual(['start', 'stop']);
  });

  it('stays holding until the recogniser says it has ended', () => {
    const h = harness();
    h.listener.press();
    expect(h.states.at(-1)!.holding).toBe(true);

    h.listener.release();
    // Still holding: the transcript has not arrived, and a button reading
    // "ready" while the recogniser is still settling is lying about its state.
    expect(h.states.at(-1)!.holding).toBe(true);

    h.recogniser.onend!();
    expect(h.states.at(-1)!.holding).toBe(false);
  });

  it('delivers the transcript, joined and collapsed', () => {
    const h = harness();
    h.listener.press();
    h.recogniser.onresult!(resultFor('my shoulder', '  feels   off '));

    expect(h.heard).toEqual(['my shoulder feels off']);
  });

  it('delivers nothing for an empty transcript', () => {
    // A hold that produced only whitespace is a hold that produced nothing, and
    // sending it would spend a chat call on an empty question.
    const h = harness();
    h.listener.press();
    h.recogniser.onresult!(resultFor('   '));

    expect(h.heard).toEqual([]);
  });

  it('ignores a release with no press, rather than stopping nothing', () => {
    const h = harness();
    h.listener.release();
    expect(h.calls).toEqual([]);
  });

  describe('the holding latch, which must never outlive the recognition', () => {
    /*
     * FOUND IN REVIEW, and the first draft of this file had neither guard nor
     * test. `holding` was set by press and cleared only by `onend`, so any path
     * that set it without a recognition that would actually end left the button
     * reading "Listening…" with no way out.
     */
    it('clears it when start() throws with nothing running', () => {
      const { calls, recogniser } = fake();
      recogniser.start = () => {
        calls.push('start');
        // No speech service, an insecure context — nothing is open, so nothing
        // will ever fire onend.
        throw new Error('SecurityError');
      };
      const states: ListenState[] = [];
      const listener = createListener({
        recogniser,
        onTranscript: vi.fn(),
        onChange: (state) => states.push(state),
      });

      listener.press();

      expect(states.at(-1)!.holding).toBe(false);
      expect(states.at(-1)!.failure).toBe('failed');
    });

    it('keeps it while a double press throws, because one IS already running', () => {
      // The other half: here the throw means the recognition the user wants is
      // open, so the latch is correct and must stay up.
      const h = harness();
      h.listener.press();
      h.recogniser.start = () => {
        throw new Error('InvalidStateError');
      };

      expect(() => h.listener.press()).not.toThrow();
      expect(h.states.at(-1)!.holding).toBe(true);
    });

    it('tells the user when a press after a release got no recognition', () => {
      /*
       * press → release → press. The second `start()` throws because the first
       * recognition is still settling, so THIS press has nothing of its own and
       * nothing will ever deliver its transcript.
       *
       * FOUND IN RE-REVIEW, twice: the first fix let the first recognition's
       * `onend` clear the second hold's latch — a silently dropped utterance —
       * and the test written for it asserted only that `release()` did not
       * throw, which was ALSO true of the broken code it was meant to catch.
       * This asserts the state the user actually sees.
       */
      const h = harness();
      h.listener.press();
      h.listener.release();
      h.recogniser.start = () => {
        throw new Error('InvalidStateError');
      };

      h.listener.press();

      // Told immediately, at the press — not left holding until somebody else's
      // recognition happens to end.
      expect(h.states.at(-1)!.holding).toBe(false);
      expect(h.states.at(-1)!.failure).toBe('failed');
    });

    it('keeps the latch for a double press INSIDE one utterance', () => {
      // The other side of the same distinction: no release between, so the open
      // recognition is genuinely the one this press wants.
      const h = harness();
      h.listener.press();
      h.recogniser.start = () => {
        throw new Error('InvalidStateError');
      };

      h.listener.press();

      expect(h.states.at(-1)!.holding).toBe(true);
      expect(h.states.at(-1)!.failure).toBeNull();
    });

    it('clears it on an error, without waiting for onend', () => {
      // The spec says onend always follows onerror. This API is explicitly
      // non-standard, and relying on that costs a permanently stuck button.
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'not-allowed' });

      expect(h.states.at(-1)!.holding).toBe(false);
      expect(h.states.at(-1)!.failure).toBe('no-permission');
    });

    it('clears it on an abort, which reports no failure but is still an end', () => {
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'aborted' });

      expect(h.states.at(-1)!.holding).toBe(false);
      expect(h.states.at(-1)!.failure).toBeNull();
    });

    it('ignores a release after a failed start, rather than stopping nothing', () => {
      const { recogniser } = fake();
      const calls: string[] = [];
      recogniser.start = () => {
        throw new Error('SecurityError');
      };
      recogniser.stop = () => calls.push('stop');
      const listener = createListener({ recogniser, onTranscript: vi.fn(), onChange: vi.fn() });

      listener.press();
      listener.release();

      expect(calls).toEqual([]);
    });
  });

  describe('failures, each of which the card says differently', () => {
    it('reports no-speech, which needs another press', () => {
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'no-speech' });
      expect(h.states.at(-1)!.failure).toBe('no-speech');
    });

    it('reports a refused microphone, which needs a permission instead', () => {
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'not-allowed' });
      expect(h.states.at(-1)!.failure).toBe('no-permission');
    });

    it('treats an unavailable speech service as retryable, not as a refusal', () => {
      /*
       * FOUND IN RE-REVIEW. `service-not-allowed` was mapped to 'no-permission'
       * alongside 'not-allowed', and the component latches its text-box
       * fallback on that value — so one bad network second removed the
       * microphone for the whole session, blaming a permission the user had
       * granted.
       */
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'service-not-allowed' });
      expect(h.states.at(-1)!.failure).toBe('failed');
    });

    it('says nothing about an abort, which is what a silent release fires', () => {
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'aborted' });
      expect(h.states.at(-1)!.failure).toBeNull();
    });

    it('falls back to a generic failure for anything else', () => {
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'network' });
      expect(h.states.at(-1)!.failure).toBe('failed');
    });

    it('clears the last failure on the next press, not on the next success', () => {
      // A sentence about the previous attempt must not sit beside a live one.
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'no-speech' });
      h.listener.press();
      expect(h.states.at(-1)!.failure).toBeNull();
    });
  });

  describe('dispose', () => {
    it('aborts rather than stopping, and delivers nothing afterwards', () => {
      const h = harness();
      h.listener.press();
      h.listener.dispose();

      // `abort`, because on unmount there is nobody to hand a transcript to —
      // `stop` would produce one.
      expect(h.calls).toEqual(['start', 'abort']);
      expect(h.recogniser.onresult).toBeNull();
      expect(h.recogniser.onerror).toBeNull();
      expect(h.recogniser.onend).toBeNull();
    });

    it('makes every method a no-op afterwards', () => {
      /*
       * FOUND IN REVIEW. `dispose` nulled the handlers and aborted, and left
       * `press` callable — which would open a live microphone with no handler
       * to end it and no state anybody reads. Unreachable from the component by
       * one line, and this module is exported and used standalone.
       */
      const h = harness();
      h.listener.dispose();
      const calls = h.calls.length;
      const published = h.states.length;

      h.listener.press();
      h.listener.release();

      // Nothing touched the recogniser, and nothing was published to a
      // component that is gone — `set` returns early once disposed.
      expect(h.calls).toHaveLength(calls);
      expect(h.states).toHaveLength(published);
    });

    it('detaches the handlers BEFORE aborting, since abort fires onend', () => {
      /*
       * The ordering is the whole point: `abort()` synchronously fires `onend`
       * in real browsers, and a disposed listener pushing state into a component
       * that is unmounting is the React warning this exists to avoid. Proved by
       * asserting the handler is already gone at the moment abort runs.
       */
      const { calls, recogniser } = fake();
      let handlerAtAbort: unknown = 'not-called';
      recogniser.abort = () => {
        calls.push('abort');
        handlerAtAbort = recogniser.onend;
      };
      const listener = createListener({
        recogniser,
        onTranscript: vi.fn(),
        onChange: vi.fn(),
      });

      listener.dispose();
      expect(handlerAtAbort).toBeNull();
    });
  });
});

describe('transcriptOf', () => {
  it('takes the first alternative of each result', () => {
    // The API orders alternatives by confidence, so the first is the one it
    // means. Reading further would be second-guessing it.
    const event: RecognitionEvent = {
      results: [[{ transcript: 'squat' }, { transcript: 'squad' }], [{ transcript: 'felt heavy' }]],
    };
    expect(transcriptOf(event)).toBe('squat felt heavy');
  });

  it('returns an empty string for an empty result set', () => {
    expect(transcriptOf({ results: [] })).toBe('');
  });

  it('skips a result with no alternatives at all', () => {
    expect(transcriptOf({ results: [[], [{ transcript: 'ok' }]] })).toBe('ok');
  });
});

describe('EMPTY_LISTEN', () => {
  it('is not holding and has nothing to report', () => {
    expect(EMPTY_LISTEN).toEqual({ holding: false, failure: null });
  });
});

describe('one transcript per hold', () => {
  it('delivers only the first final result', () => {
    /*
     * FOUND IN RE-REVIEW. Chrome can fire more than one final `onresult` for a
     * single utterance, and each one started its own request: two model calls,
     * two charges, and a race over which answer was rendered. The component's
     * generation guard could pick a winner; it could not stop the second call
     * from being made, and the cooldown added in the same pass made it worse —
     * the SECOND call was the one refused, and being later it won.
     */
    const h = harness();
    h.listener.press();
    h.recogniser.onresult!({ results: [[{ transcript: 'my shoulder' }]] });
    h.recogniser.onresult!({ results: [[{ transcript: 'my shoulder again' }]] });

    expect(h.heard).toEqual(['my shoulder']);
  });

  it('delivers again after the next press', () => {
    // Per HOLD, not per listener: a session is many questions.
    const h = harness();
    h.listener.press();
    h.recogniser.onresult!({ results: [[{ transcript: 'first' }]] });
    h.recogniser.onend!();
    h.listener.press();
    h.recogniser.onresult!({ results: [[{ transcript: 'second' }]] });

    expect(h.heard).toEqual(['first', 'second']);
  });

  it('does not count an empty result as the one delivery', () => {
    // A blank result must not burn the hold's single slot.
    const h = harness();
    h.listener.press();
    h.recogniser.onresult!({ results: [[{ transcript: '   ' }]] });
    h.recogniser.onresult!({ results: [[{ transcript: 'the real one' }]] });

    expect(h.heard).toEqual(['the real one']);
  });
});
