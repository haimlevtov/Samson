'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { askDuringSession } from '../actions';
import type { SessionAnswer } from '../session-coach';
import {
  EMPTY_LISTEN,
  createListener,
  type ListenFailure,
  type ListenState,
  type Listener,
  type Recogniser,
} from '@/src/speech/listen';
import { SILENT_TEXT, useReplyVoice } from '@/src/ui/reply-voice';
import { SpeakSwitch } from '@/src/ui/SpeakSwitch';

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
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    /*
     * FOUND IN REVIEW. An unguarded `new Ctor()` that throws took the effect
     * down with it, which left `canListen` at null forever — a permanently
     * disabled button, no fallback (it is gated on `false`, not `null`), and no
     * cleanup registered because the effect never returned one. Null routes
     * into the text box, which is the right answer for "this browser has the
     * constructor and cannot use it".
     */
    return null;
  }
}

export function SessionCoach() {
  const [answer, setAnswer] = useState<SessionAnswer | null>(null);
  const [listen, setListen] = useState<ListenState>(EMPTY_LISTEN);
  const [speak, setSpeak] = useState(false);
  const [typed, setTyped] = useState('');
  const [canListen, setCanListen] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();

  const listener = useRef<Listener | null>(null);
  /*
   * The clip's playback — `src/ui/reply-voice.ts`, which the Coach tab's chat
   * now shares. It moved there verbatim: the pause-before-return, the rejection
   * guard and the NotAllowedError replay were each found in review on THIS
   * card, and a second copy would have had to find them again.
   */
  const { blocked, play: playClip, replay } = useReplyVoice();
  /*
   * Which question the rendered answer belongs to — FOUND IN REVIEW.
   *
   * `disabled={pending}` guards the BUTTON, and `ask` is not called by the
   * button: it is called by the recogniser, which knows nothing about pending
   * and which Chrome can fire more than once for a single hold. So two requests
   * can overlap, and a text-only answer routinely beats a spoken one by seconds
   * — which without this would publish the OLDER answer last.
   */
  const turn = useRef(0);

  /*
   * `speak` is read through a ref inside the listener's callback, because the
   * listener is built once and would otherwise close over the toggle's value at
   * mount — a user who turns speech on mid-session would keep getting silence.
   */
  const wantsVoice = useRef(speak);
  wantsVoice.current = speak;

  /*
   * FOUND IN REVIEW, and it was a permanent dead end. A denied microphone is
   * remembered by the browser FOR THE ORIGIN, so every later press fires
   * `not-allowed` forever — with `canListen` still true, because the constructor
   * worked. The user was left with a button that could never work and the
   * working alternative ten lines above it, which is exactly what
   * docs/specs/mobile-interface.md §4 forbids and what ADR 0031 §1 says the
   * design is for.
   */
  const mustType = canListen === false || listen.failure === 'no-permission';

  const ask = (text: string): void => {
    const question = text.trim();
    if (question === '') return;
    const mine = ++turn.current;
    startTransition(async () => {
      /*
       * CAUGHT HERE, and the first version had no catch at all — FOUND IN
       * RE-REVIEW, rated critical and rightly.
       *
       * The action's own try cannot help: this rejects when the REQUEST fails —
       * offline in a gym basement, a 502, deploy skew, a serialization error at
       * the action boundary. React rethrows a rejected transition during render,
       * and the nearest boundary is the ROOT one, so a failed question replaced
       * the entire session route — the set grid and its unsaved rows with it.
       *
       * `src/speech/player.ts` already carries this exact guard, added by its
       * own second review, and docs/specs/mobile-interface.md §4 has the row:
       * offline or a failed request renders the inline error path.
       */
      const result = await askDuringSession(question, wantsVoice.current).catch(
        (): SessionAnswer => ({
          asked: question,
          reply: '',
          audio: null,
          silent: 'failed',
          coach: null,
          error: 'That did not get through. Try again in a moment.',
        })
      );
      // Superseded, or unmounted: publish nothing. The cleanup bumps this too,
      // so a continuation crossing teardown cannot touch the refs either.
      if (mine !== turn.current) return;
      setAnswer(result);
      play(result);
    });
  };

  /*
   * A clip that will not play at all marks the answer silent, so the card stops
   * claiming a voice it cannot deliver — the reasoning `player.ts` carries about
   * replaying a broken clip under a message saying "Try again".
   */
  const play = (result: SessionAnswer): void =>
    playClip(result.audio, () =>
      setAnswer((current) => (current === null ? current : { ...current, silent: 'failed' }))
    );

  useEffect(() => {
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
      // Bumped so a request still in flight publishes nothing after unmount.
      turn.current += 1;
      listener.current?.dispose();
      listener.current = null;
      // The audio and its blob URL are torn down by `useReplyVoice`'s own effect.
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
         * be asking the user to budget something that is not theirs. The markup
         * is `SpeakSwitch`, shared with the Coach tab's chat.
         */}
        <SpeakSwitch speak={speak} onChange={setSpeak} describedBy="speak-cost" />

        {mustType ? (
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
              <span className="label">
                {canListen === false
                  ? 'This browser cannot listen — type instead'
                  : 'The microphone is blocked — type instead'}
              </span>
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
            {blocked ? (
              // The clip exists and is paid for; the browser wants a tap.
              <button type="button" className="secondary" onClick={() => void replay()}>
                Tap to play
              </button>
            ) : answer.coach !== null && answer.audio !== null ? (
              <p className="muted small">In {answer.coach}&rsquo;s voice.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
