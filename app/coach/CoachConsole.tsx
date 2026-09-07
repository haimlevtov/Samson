'use client';

import { useActionState, useEffect, useState } from 'react';
import { deliverForPersona } from './actions';
import { EMPTY_DELIVERY, type DeliveryState } from './state';
import { canSpeak, primeVoices, speak, spokenIntensity, stopSpeaking } from '@/src/ui/speak';
import type { Persona } from '@/src/persona/schema';

export interface CoachPersona extends Persona {
  /** BCP-47 hint from the row. Best effort — see src/ui/speak.ts. */
  voice: string | null;
}

/**
 * The plan and the voice, side by side.
 *
 * WHY they are two panels rather than one narrative: ADR 0006. The persona
 * returns prose and never the block, so the numbers below come from the object
 * the critic approved and the words come from the model. Merging them into one
 * rendered paragraph would put a model between the user and a number, which is
 * the thing invariant #1 exists to prevent.
 */
export function CoachConsole({
  personas,
  weekLabels,
}: {
  personas: CoachPersona[];
  /** One label per week of the block, so notes can be shown against them. */
  weekLabels: string[];
}) {
  const [selected, setSelected] = useState(personas[0]?.slug ?? '');
  const [speechFailed, setSpeechFailed] = useState(false);
  const [state, formAction, pending] = useActionState<DeliveryState, FormData>(
    deliverForPersona,
    EMPTY_DELIVERY
  );

  /*
   * The voice follows the DELIVERED persona, not the selected chip.
   *
   * WHY: selecting a chip does not re-deliver — `state.delivered` still holds
   * whatever the last submission produced. Reading `selected` here meant that
   * picking a different coach and pressing Read it aloud spoke the previous
   * coach's words in the new coach's accent and rate, which is a genuinely
   * mismatched voice rather than merely a surprising one.
   */
  const speaking = personas.find((p) => p.slug === state.personaSlug) ?? null;

  const spoken = state.delivered
    ? [state.delivered.opening, ...state.delivered.week_notes, state.delivered.closing].join(' ')
    : '';

  // The list loads asynchronously and is empty on a first getVoices() call, so
  // it is started here rather than at the moment the button is pressed.
  useEffect(() => {
    primeVoices();
    // Speech outlives the component otherwise, and carries on over the next
    // screen until it finishes the whole delivery.
    return stopSpeaking;
  }, []);

  /*
   * Stop talking whenever the delivery changes underneath us.
   *
   * WHY: `speechSynthesis` is a global queue that outlives this subtree, and
   * the only other cancels are a new `speak()` call, the Stop button, and
   * unmount. Without this, delivering again while the previous read is still
   * playing leaves the screen showing one coach while the audio reads another
   * — the same mismatch this component's `speaking` lookup exists to prevent,
   * moved from the click boundary to the delivery boundary. It also covers the
   * failure case, where `state.delivered` goes null and the text disappears
   * while the voice carries on.
   */
  useEffect(() => {
    stopSpeaking();
    setSpeechFailed(false);
  }, [state.delivered, state.personaSlug]);

  return (
    <>
      <h2 className="section">Coach</h2>
      <div className="card">
        <span className="label">Voice</span>
        <div className="row">
          {personas.map((p) => (
            <button
              key={p.slug}
              type="button"
              className={`chip ${p.slug === selected ? 'chip-on' : ''}`}
              onClick={() => setSelected(p.slug)}
            >
              {p.name}
            </button>
          ))}
        </div>

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

            {/*
             * WHY Stop can live in here, gated on the same state as the text:
             * every path that clears `state.delivered` — including every error
             * return in actions.ts — trips the cancel effect above, so the
             * audio stops at the same moment this control disappears. Without
             * that effect this gating would strand a running utterance with no
             * way to stop it, which is what review found.
             */}
            {canSpeak() ? (
              <>
                <div className="row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      /*
                       * Both failure paths are handled, because they are
                       * different failures: `false` is "could not start", and
                       * onFailure is "started and then died", which is what iOS
                       * Safari does. docs/specs/mobile-interface.md §4 — every
                       * state renders something, and "nothing happens" is the
                       * failure that section exists to prevent. Here the speech
                       * IS the action, so silence would be the only feedback.
                       */
                      setSpeechFailed(false);
                      const started = speak(spoken, {
                        lang: speaking?.voice ?? null,
                        intensity: spokenIntensity(speaking?.intensity ?? 3, state.gentle),
                        variant: speaking?.voiceVariant ?? 0,
                        onFailure: () => setSpeechFailed(true),
                      });
                      if (!started) setSpeechFailed(true);
                    }}
                  >
                    Read it aloud
                  </button>
                  <button type="button" className="secondary" onClick={stopSpeaking}>
                    Stop
                  </button>
                </div>
                {speechFailed ? (
                  <p className="muted small">
                    This device would not read it aloud. The plan above is the whole of it.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
