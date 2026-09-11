'use client';

import { useActionState, useEffect, useState, useSyncExternalStore } from 'react';
import { deliverForPersona } from './actions';
import { EMPTY_DELIVERY, type DeliveryState } from './state';
import {
  canSpeak,
  previewSpeech,
  primeVoices,
  speak,
  spokenIntensity,
  stopSpeaking,
} from '@/src/ui/speak';
import type { ListedPersona } from '@/src/db/personas';

export interface CoachPersona extends ListedPersona {
  /** BCP-47 hint from the row. Best effort — see src/ui/speak.ts. */
  voice: string | null;
}

/** Speech support does not change during a visit, so there is nothing to watch. */
const noSubscription = () => () => {};

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
  const [previewFailed, setPreviewFailed] = useState(false);

  /*
   * WHY not `canSpeak()` in render, as the delivery below uses it: that block
   * only exists after a client-side action, but the preview is on first paint.
   * The server has no `speechSynthesis`, so a render-time check would print the
   * text version on the server and a button in the browser — a hydration
   * mismatch. The server snapshot is false, and the client re-renders with the
   * real answer.
   */
  const speakable = useSyncExternalStore(noSubscription, canSpeak, () => false);
  const chosen = personas.find((p) => p.slug === selected) ?? null;
  const preview = chosen ? previewSpeech(chosen) : null;
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

  /*
   * And whenever the chip changes. The same mismatch one boundary over: without
   * this, one coach's preview carries on in that coach's voice while another
   * coach's chip is lit.
   */
  useEffect(() => {
    stopSpeaking();
    setPreviewFailed(false);
  }, [selected]);

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
              onClick={() => setSelected(p.slug)}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/*
         * The preview — rework plan, PR 6. Every state renders something
         * (docs/specs/mobile-interface.md §4): a device that cannot speak gets
         * the line as text rather than a dead button, and one that starts and
         * then dies gets the text with the same note "Read it aloud" uses.
         */}
        {preview && chosen ? (
          <>
            {speakable ? (
              <div className="row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPreviewFailed(false);
                    const started = speak(preview.text, {
                      ...preview.options,
                      onFailure: () => setPreviewFailed(true),
                    });
                    if (!started) setPreviewFailed(true);
                  }}
                >
                  Hear {chosen.name}
                </button>
              </div>
            ) : null}
            {!speakable || previewFailed ? (
              <p className="muted small">
                {previewFailed ? 'This device would not read it aloud. ' : null}
                {chosen.name}: “{preview.text}”
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
