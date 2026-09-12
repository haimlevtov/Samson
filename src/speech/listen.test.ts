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

  it('survives a double press, because the recognition it wants is already open', () => {
    const { calls, recogniser } = fake();
    recogniser.start = () => {
      calls.push('start');
      // What the API really throws when one is already running.
      throw new Error('InvalidStateError');
    };
    const listener = createListener({ recogniser, onTranscript: vi.fn(), onChange: vi.fn() });

    expect(() => {
      listener.press();
      listener.press();
    }).not.toThrow();
  });

  describe('failures, each of which the card says differently', () => {
    it('reports no-speech, which needs another press', () => {
      const h = harness();
      h.listener.press();
      h.recogniser.onerror!({ error: 'no-speech' });
      expect(h.states.at(-1)!.failure).toBe('no-speech');
    });

    it('reports a refused microphone, which needs a permission instead', () => {
      for (const error of ['not-allowed', 'service-not-allowed']) {
        const h = harness();
        h.listener.press();
        h.recogniser.onerror!({ error });
        expect(h.states.at(-1)!.failure).toBe('no-permission');
      }
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
