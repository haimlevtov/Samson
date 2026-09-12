'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { askDuringSession } from '../actions';
import type { SessionAnswer, SilentReason } from '../session-coach';
import {
  EMPTY_LISTEN,
  createListener,
  type ListenFailure,
  type ListenState,
  type Listener,
  type Recogniser,
} from '@/src/speech/listen';

/**
 * Ask the coach mid-session — ADR 0031.
 *
 * WHY it is its own component rather than a block inside `SessionConsole`: that
 * file is already 400 lines of set-logging state, and this shares none of it.
 * It also unmounts cleanly, which matters — a live recogniser and a playing clip
 * both have to be torn down when the session screen goes away.
 *
 * INVARIANT: nothing here decides what the coach says or whether it is spoken.
 *            It sends a string and renders what comes back. Every guard is on
 *            the server — ADR 0031 §6.
 */

/** What the card says when there was no clip. `not-asked` says nothing at all. */
const SILENT_TEXT: Record<Exclude<SilentReason, 'not-asked'>, string> = {
  'no-key': 'The coach voices are not set up here.',
  budget: "This week's coaching budget is spent, so the coach cannot speak until it resets.",
  'no-voice': 'No coach has a voice yet, so this one is written only.',
  failed: 'The voice did not come through.',
  'too-long': 'That answer was too long to read aloud — it is above.',
};

/** What the card says when a hold produced nothing. */
const LISTEN_TEXT: Record<ListenFailure, string> = {
  'no-speech': 'I did not catch anything. Hold the button and speak.',
  'no-permission': 'This browser is not letting the page use the microphone.',
  failed: 'Listening did not work that time.',
};

/**
 * The browser's recogniser, or null where there is none.
 *
 * INVARIANT: null is a FIRST-CLASS state, not an error — ADR 0031 §1. iOS Safari
 *            has no `SpeechRecognition` at all, and this is a phone-first
 *            product, so the card renders a text box there instead of a button
 *            that cannot work.
 */
function makeRecogniser(): Recogniser | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recogniser;
    webkitSpeechRecognition?: new () => Recogniser;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function SessionCoach() {
  const [answer, setAnswer] = useState<SessionAnswer | null>(null);
  const [listen, setListen] = useState<ListenState>(EMPTY_LISTEN);
  const [speak, setSpeak] = useState(false);
  const [typed, setTyped] = useState('');
  const [canListen, setCanListen] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();

  const listener = useRef<Listener | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const clipUrl = useRef<string | null>(null);

  /*
   * `speak` is read through a ref inside the listener's callback, because the
   * listener is built once and would otherwise close over the toggle's value at
   * mount — a user who turns speech on mid-session would keep getting silence.
   */
  const wantsVoice = useRef(speak);
  wantsVoice.current = speak;

  const ask = (text: string): void => {
    const question = text.trim();
    if (question === '') return;
    startTransition(async () => {
      const result = await askDuringSession(question, wantsVoice.current);
      setAnswer(result);
      play(result);
    });
  };

  const play = (result: SessionAnswer): void => {
    if (result.audio === null || audio.current === null) return;
    // The previous clip's URL is revoked before the next is made: a session is
    // many questions, and a leaked blob per answer is a leak per question.
    if (clipUrl.current !== null) URL.revokeObjectURL(clipUrl.current);
    const blob = new Blob([new Uint8Array(result.audio.bytes)], { type: result.audio.contentType });
    clipUrl.current = URL.createObjectURL(blob);
    audio.current.src = clipUrl.current;
    // A rejected play() is the browser's autoplay policy, not a failure worth a
    // sentence: the text is on screen either way.
    void audio.current.play().catch(() => {});
  };

  useEffect(() => {
    audio.current = new Audio();
    const recogniser = makeRecogniser();
    setCanListen(recogniser !== null);

    if (recogniser !== null) {
      listener.current = createListener({
        recogniser,
        onTranscript: ask,
        onChange: setListen,
      });
    }

    return () => {
      listener.current?.dispose();
      listener.current = null;
      audio.current?.pause();
      audio.current = null;
      if (clipUrl.current !== null) URL.revokeObjectURL(clipUrl.current);
      clipUrl.current = null;
    };
    /*
     * Mount only, and deliberately: `ask` reads the toggle through a ref rather
     * than closing over it, so there is nothing in this effect that goes stale.
     * Rebuilding the recogniser on every render would abort a hold in progress.
     *
     * (No eslint-disable: this project does not configure react-hooks, so a
     * suppression here would be a comment about a rule that does not run.)
     */
  }, []);

  return (
    <>
      <h2 className="section">Ask the coach</h2>
      <div className="card session-coach">
        {/*
         * Rendered before the control, because it is what decides what the
         * control costs — ADR 0031 §3. Off by default, per session, and it says
         * what it costs in words: the money is the project's, and a figure would
         * be asking the user to budget something that is not theirs.
         */}
        <label className="row speak-toggle">
          <input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} />
          <span>
            Read the answers aloud
            <span className="muted small block">
              Off by default — a spoken answer costs the app money, and a chatty session adds up.
            </span>
          </span>
        </label>

        {canListen === false ? (
          /*
           * No `SpeechRecognition` — iOS Safari, notably. Every state renders
           * something (docs/specs/mobile-interface.md §4), and what this one
           * renders is the same feature with a keyboard rather than an apology.
           */
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              ask(typed);
              setTyped('');
            }}
          >
            <label className="grow">
              <span className="label">This browser cannot listen — type instead</span>
              <input
                type="text"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Shoulder feels off on presses"
              />
            </label>
            <button type="submit" disabled={pending || typed.trim() === ''}>
              {pending ? 'Asking…' : 'Ask'}
            </button>
          </form>
        ) : (
          <div className="row">
            {/*
             * Hold, speak, release. Pointer events rather than mouse/touch: one
             * pair covers both, and `onPointerLeave` releases a press dragged
             * off the button, which on a phone is most of the mis-presses.
             */}
            <button
              type="button"
              className={listen.holding ? 'holding' : ''}
              disabled={pending || canListen === null}
              onPointerDown={() => listener.current?.press()}
              onPointerUp={() => listener.current?.release()}
              onPointerLeave={() => listener.current?.release()}
              onPointerCancel={() => listener.current?.release()}
            >
              {listen.holding ? 'Listening…' : pending ? 'Asking…' : 'Hold to talk'}
            </button>
          </div>
        )}

        {listen.failure !== null ? (
          <p className="muted small" role="status">
            {LISTEN_TEXT[listen.failure]}
          </p>
        ) : null}

        {answer !== null ? (
          <div className="session-answer">
            {/*
             * What was HEARD, shown as the user's own turn — ADR 0031's "what
             * this does not guarantee". A gym is loud and recognition is a model
             * too; seeing the question is how somebody knows to say it again.
             */}
            {answer.asked !== '' ? <p className="asked">“{answer.asked}”</p> : null}
            {answer.error !== null ? (
              <p className="error" role="status">
                {answer.error}
              </p>
            ) : (
              <p role="status">{answer.reply}</p>
            )}
            {answer.silent !== null && answer.silent !== 'not-asked' && answer.error === null ? (
              <p className="muted small">{SILENT_TEXT[answer.silent]}</p>
            ) : null}
            {answer.coach !== null && answer.audio !== null ? (
              <p className="muted small">In {answer.coach}&rsquo;s voice.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
