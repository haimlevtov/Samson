'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { deliverForPersona, hearCoach } from './actions';
import { EMPTY_DELIVERY, type DeliveryState } from './state';
import {
  IDLE,
  createCoachPlayer,
  type CoachPlayer,
  type PlayerState,
  type ShownReason,
} from '@/src/speech/player';
import type { ListedPersona } from '@/src/db/personas';

/**
 * What the card says beside a coach's line when it is shown instead of heard —
 * every state renders something (docs/specs/mobile-interface.md §4).
 */
const SHOWN_TEXT: Record<ShownReason, string> = {
  'no-key': 'The coach voices are not set up here.',
  budget: "This week's coaching budget is spent, so the coach cannot speak until it resets.",
  'no-voice': 'This coach has no voice yet.',
  failed: 'The voice did not come through. Try again in a moment.',
  blocked: 'This browser held the sound back. Tap again to play.',
};

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
 * the gateway's speech stage and played by src/speech/player.ts, which owns
 * the fetching, the cache and the in-flight presses. There is no device-voice
 * fallback — a voice that does not fit the coach is worse than none — so every
 * path that cannot play shows the line as text and says why.
 *
 * AI-NOTE: the delivered plan is not read aloud. That was device speech, and it
 *          went with it; reading it in the coach's voice needs the delivery
 *          stored server-side first, because the server never speaks text the
 *          browser sends — ADR 0025 §4. A later PR, not yet planned.
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
  const [voice, setVoice] = useState<PlayerState>(IDLE);
  const player = useRef<CoachPlayer | null>(null);

  // One player per mount, made in the browser and disposed on unmount: it
  // stops the audio, supersedes any press in flight and revokes every URL.
  useEffect(() => {
    const created = createCoachPlayer({
      audio: new Audio(),
      fetchClip: hearCoach,
      toUrl: (audio, contentType) => URL.createObjectURL(new Blob([audio], { type: contentType })),
      revoke: (url) => URL.revokeObjectURL(url),
      onChange: setVoice,
    });
    player.current = created;
    return () => {
      created.dispose();
      player.current = null;
    };
  }, []);

  const chosen = personas.find((p) => p.slug === selected) ?? null;
  const line = chosen?.sampleLine?.trim() ?? '';
  const [state, formAction, pending] = useActionState<DeliveryState, FormData>(
    deliverForPersona,
    EMPTY_DELIVERY
  );

  const choose = (slug: string) => {
    // The lit chip changes nothing, so it supersedes nothing either.
    if (slug === selected) return;
    player.current?.select();
    setSelected(slug);
  };

  const canHear = voiceAvailable && chosen?.voiced === true;
  const refused = chosen !== null && voice.shown?.slug === chosen.slug ? voice.shown.reason : null;
  // Why the line is on screen as text: the last press's refusal, or that there
  // is no voice to ask for.
  const why: ShownReason | null =
    refused ?? (!voiceAvailable ? 'no-key' : chosen !== null && !chosen.voiced ? 'no-voice' : null);
  const fetching = chosen !== null && voice.fetching === chosen.slug;

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
         * The preview — rework plan PRs 6 and 6b. A Hear button only where a
         * voice exists; otherwise, or after a refusal or a blocked play, the
         * line as text with the reason.
         *
         * WHY the button stays enabled while fetching: disabling the focused
         * button drops keyboard focus, and a second press is harmless — the
         * player joins the call already in flight rather than paying twice.
         */}
        {chosen && line !== '' ? (
          <>
            {canHear ? (
              <div className="row">
                {voice.playing === chosen.slug ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => player.current?.stop()}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    aria-busy={fetching}
                    onClick={() => void player.current?.hear(chosen.slug)}
                  >
                    {fetching ? `Finding ${chosen.name}’s voice…` : `Hear ${chosen.name}`}
                  </button>
                )}
              </div>
            ) : null}
            {why !== null ? (
              <p className="muted small" role="status">
                {SHOWN_TEXT[why]} {chosen.name}: “{line}”
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
