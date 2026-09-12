'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { deliverForPersona, hearCoach } from './actions';
import { EMPTY_DELIVERY, type DeliveryState } from './state';
import {
  EMPTY_PLAYER,
  createCoachPlayer,
  whyShown,
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
  const [voice, setVoice] = useState<PlayerState>(EMPTY_PLAYER);
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

  const canHear = voiceAvailable && chosen?.voiced === true && line !== '';
  const why = whyShown(voice, chosen, voiceAvailable);
  const fetching = chosen !== null && voice.fetching === chosen.slug;

  return (
    <>
      {/* "Voice", not "Coach": the page's h1 is Coach now that the chat
          shares the tab, and an h2 repeating it reads as a broken heading
          outline to anyone navigating by headings. This section is the persona
          picker and the delivery, which is what a voice is. */}
      <h2 className="section">Voice</h2>
      <div className="card">
        {/*
         * A menu, not five chips — this plan's PR 1. Five chips spent a whole
         * line of a 375px screen on a choice made once, and every one of them
         * was a 44px target competing with the control people actually press.
         *
         * A native `<select>` rather than a custom dropdown: keyboard and screen
         * reader navigable for free, rendered as the platform's own picker on a
         * phone, and `docs/specs/mobile-interface.md`'s 44px rule is already
         * satisfied by the base `select` min-height rather than by new CSS.
         */}
        <div className="row persona-picker">
          <label className="persona-choice">
            <span className="label">Change persona</span>
            <select
              value={selected}
              onChange={(event) => choose(event.target.value)}
              disabled={pending}
            >
              {personas.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {/*
           * The preview — rework plan PRs 6 and 6b, and PR 1 here made it a
           * PRIMARY button. Primary is already `--accent`, so this is a token
           * change rather than a new colour: nothing in this project carries
           * state in a hardcoded hex.
           *
           * "Try" rather than "Hear {name}": the name is in the menu beside it,
           * and a label that rebuilt itself per selection made the button change
           * width every time somebody changed their mind.
           *
           * WHY it stays enabled while fetching: disabling the focused button
           * drops keyboard focus, and a second press is harmless — the player
           * joins the call already in flight rather than paying twice.
           */}
          {chosen && canHear ? (
            voice.playing === chosen.slug ? (
              <button type="button" className="secondary" onClick={() => player.current?.stop()}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                aria-busy={fetching}
                aria-label={`Try ${chosen.name}'s voice`}
                onClick={() => void player.current?.hear(chosen.slug)}
              >
                {fetching ? 'Finding…' : 'Try'}
              </button>
            )
          ) : null}
        </div>

        {chosen ? (
          <>
            {why !== null ? (
              // A coach with no line still says why it is silent — every
              // state renders something, docs/specs/mobile-interface.md §4.
              <p className="muted small" role="status">
                {SHOWN_TEXT[why]}
                {line !== '' ? ` ${chosen.name}: “${line}”` : null}
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
