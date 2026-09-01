'use client';

import { useActionState, useState } from 'react';
import { deliverForPersona } from './actions';
import { EMPTY_DELIVERY, type DeliveryState } from './state';
import { canSpeak, speak, stopSpeaking } from '@/src/ui/speak';
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
  const [state, formAction, pending] = useActionState<DeliveryState, FormData>(
    deliverForPersona,
    EMPTY_DELIVERY
  );

  const persona = personas.find((p) => p.slug === selected) ?? null;
  const spoken = state.delivered
    ? [state.delivered.opening, ...state.delivered.week_notes, state.delivered.closing].join(' ')
    : '';

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

            {canSpeak() ? (
              <div className="row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    speak(spoken, { lang: persona?.voice ?? null, intensity: persona?.intensity })
                  }
                >
                  Read it aloud
                </button>
                <button type="button" className="secondary" onClick={stopSpeaking}>
                  Stop
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
