'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { deliverForPersona, hearCoach } from './actions';
import { EMPTY_DELIVERY, type DeliveryState } from './state';
import { VOICE_REFUSAL_TEXT, type VoiceRefusal } from './voice-state';
import type { ListedPersona } from '@/src/db/personas';

/** Why the chosen coach's line is on screen instead of in the speaker. */
type Shown = { slug: string; reason: VoiceRefusal | 'blocked' };

/** The server's base64 audio as something an <audio> element can play. */
function clipUrl(audio: string, contentType: string): string {
  const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}

/**
 * The plan and the voice, side by side.
 *
 * WHY they are two panels rather than one narrative: ADR 0006. The persona
 * returns prose and never the block, so the numbers below come from the object
 * the critic approved and the words come from the model. Merging them into one
 * rendered paragraph would put a model between the user and a number, which is
 * the thing invariant #1 exists to prevent.
 *
 * The voice is ADR 0025's: each coach's line in a voice cast for it, made by
 * the gateway's speech stage. There is no device-voice fallback — a voice that
 * does not fit the coach is worse than none — so every path that cannot play
 * shows the line as text and says why (docs/specs/mobile-interface.md §4).
 *
 * AI-NOTE: the delivered plan is not read aloud. That was device speech, and it
 *          went with it; reading it in the coach's voice needs the delivery
 *          stored server-side first, because the server never speaks text the
 *          browser sends — ADR 0025 §4, the next PR.
 */
export function CoachConsole({
  personas,
  weekLabels,
  voiceAvailable,
}: {
  personas: ListedPersona[];
  /** One label per week of the block, so notes can be shown against them. */
  weekLabels: string[];
  /** Whether the server can speak at all — false with no key configured. */
  voiceAvailable: boolean;
}) {
  const [selected, setSelected] = useState(personas[0]?.slug ?? '');
  const [fetching, setFetching] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  /*
   * One element for every clip, kept across renders.
   *
   * WHY one: a second press, a chip change and unmount all have to stop what is
   * playing, and one element is one thing to stop.
   */
  const audio = useRef<HTMLAudioElement | null>(null);

  /*
   * Clips already fetched, by slug, for this visit.
   *
   * WHY: each fetch is a paid call against the user's weekly budget — ADR 0025,
   * Cost — and a replay of the same line should not be a second one. It is
   * also what makes "Tap again to play" work where a browser blocks playback
   * after a network wait: the second tap plays from here, inside the tap.
   */
  const clips = useRef(new Map<string, string>());

  /*
   * Which press is current. A press that resolves after the user has moved to
   * another coach keeps its clip for later and plays nothing — otherwise one
   * coach's voice arrives under another coach's chip.
   */
  const request = useRef(0);

  const chosen = personas.find((p) => p.slug === selected) ?? null;
  const line = chosen?.sampleLine?.trim() ?? '';
  const [state, formAction, pending] = useActionState<DeliveryState, FormData>(
    deliverForPersona,
    EMPTY_DELIVERY
  );

  const stop = () => {
    audio.current?.pause();
    setPlaying(null);
  };

  // Made on mount, in the browser, and torn down on unmount: audio outlives the
  // component otherwise, and object URLs outlive the page's need for them until
  // the tab closes.
  useEffect(() => {
    const element = new Audio();
    const cache = clips.current;
    audio.current = element;
    return () => {
      element.pause();
      element.removeAttribute('src');
      audio.current = null;
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  const play = (slug: string, url: string) => {
    const element = audio.current;
    if (element === null) return;
    element.pause();
    element.src = url;
    element.onplaying = () => setPlaying(slug);
    element.onended = () => setPlaying(null);
    element.onerror = () => {
      setPlaying(null);
      setShown({ slug, reason: 'failed' });
    };
    element.play().catch((cause: unknown) => {
      // AbortError is this code replacing the clip or stopping it — not a
      // failure, the same distinction src/ui/speak.ts draws for utterances.
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setPlaying(null);
      setShown({
        slug,
        reason:
          cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'blocked' : 'failed',
      });
    });
  };

  const hear = async (slug: string) => {
    setShown(null);
    const cached = clips.current.get(slug);
    if (cached) {
      play(slug, cached);
      return;
    }

    const mine = ++request.current;
    setFetching(slug);
    try {
      const result = await hearCoach(slug);
      if (result.ok) {
        const url = clipUrl(result.audio, result.contentType);
        clips.current.set(slug, url);
        if (request.current === mine) play(slug, url);
      } else if (request.current === mine) {
        setShown({ slug, reason: result.reason });
      }
    } catch {
      if (request.current === mine) setShown({ slug, reason: 'failed' });
    } finally {
      if (request.current === mine) setFetching(null);
    }
  };

  const choose = (slug: string) => {
    /*
     * The chip is the user's answer to "who do I want to hear now", so the last
     * coach stops talking and any press still in flight is superseded.
     */
    request.current += 1;
    stop();
    setFetching(null);
    setShown(null);
    setSelected(slug);
  };

  const reason =
    shown !== null && chosen !== null && shown.slug === chosen.slug ? shown.reason : null;

  return (
    <>
      {/* "Voice", not "Coach": the page's h1 is Coach now that the chat
          shares the tab, and an h2 repeating it reads as a broken heading
          outline to anyone navigating by headings. This section is the persona
          picker and the delivery, which is what a voice is. */}
      <h2 className="section">Voice</h2>
      <div className="card">
        <span className="label">Pick one</span>
        <div className="row">
          {personas.map((p) => (
            <button
              key={p.slug}
              type="button"
              className={`chip ${p.slug === selected ? 'chip-on' : ''}`}
              onClick={() => choose(p.slug)}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/*
         * The preview — rework plan PRs 6 and 6b. Every state renders something:
         * with no key there is no button and the line is text; a refusal or a
         * blocked play shows the line and says why.
         */}
        {chosen && line !== '' ? (
          <>
            {voiceAvailable ? (
              <div className="row">
                {playing === chosen.slug ? (
                  <button type="button" className="secondary" onClick={stop}>
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    disabled={fetching === chosen.slug}
                    onClick={() => void hear(chosen.slug)}
                  >
                    {fetching === chosen.slug
                      ? `Finding ${chosen.name}’s voice…`
                      : `Hear ${chosen.name}`}
                  </button>
                )}
              </div>
            ) : null}
            {!voiceAvailable || reason !== null ? (
              <p className="muted small" role="status">
                {reason !== null ? `${VOICE_REFUSAL_TEXT[reason]} ` : null}
                {chosen.name}: “{line}”
              </p>
            ) : null}
          </>
        ) : null}

        <form action={formAction} className="coach-actions">
          <input type="hidden" name="personaSlug" value={selected} />
          <button type="submit" disabled={pending || selected === ''}>
            {pending ? 'Asking…' : 'Deliver this plan'}
          </button>
        </form>

        {state.error ? <p className="error small">{state.error}</p> : null}

        {state.gentle ? (
          // The user should know why the coach sounds different today, or the
          // tone change reads as the app being inconsistent.
          <p className="muted small">
            Gentler tone: your recent notes or attendance suggest this is not a week to push.
          </p>
        ) : null}

        {state.delivered ? (
          <div className="delivered">
            <p>{state.delivered.opening}</p>
            {state.delivered.week_notes.map((note, i) => (
              <p key={weekLabels[i] ?? i}>
                <span className="label">{weekLabels[i] ?? `Week ${i + 1}`}</span>
                {note}
              </p>
            ))}
            <p>{state.delivered.closing}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
