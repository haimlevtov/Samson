'use client';

import { useActionState, useState } from 'react';
import { deliverForPersona } from './actions';
import { EMPTY_DELIVERY, type DeliveryState } from './state';
import { canHear as hearable, whyShown } from '@/src/speech/player';
import type { ListedPersona } from '@/src/db/personas';
import { openingCoach } from '@/src/persona/choice';
import { CoachTryButton, SHOWN_TEXT, useCoachVoice } from './CoachTry';
import { deliveredBy } from '@/src/ui/coach';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';

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
  chosenSlug,
  weekLabels,
  voiceAvailable,
}: {
  personas: ListedPersona[];
  /**
   * The coach this user picked in onboarding — `users.persona_slug`, PR 8.
   *
   * Null for somebody who has not chosen, and for a slug that no longer names a
   * listed coach the fallback below catches it. That case is real rather than
   * defensive: `is_active = false` retires a coach without deleting the row,
   * which is why the column carries no foreign key.
   */
  chosenSlug: string | null;
  /** One label per week of the block, so notes can be shown against them. */
  weekLabels: string[];
  /** Whether the server can speak at all — false with no key configured. */
  voiceAvailable: boolean;
}) {
  /*
   * The stored choice first, and the first LISTED coach as the fallback — which
   * on this tab means the first row `listPersonas` returned, user-owned and
   * unvoiced rows included. That is NOT ADR 0031 §5's "first shared, voiced
   * coach alphabetically": §5 records a review correcting precisely that
   * conflation, because the two surfaces then name different coaches. What §5
   * gives this is the reason the column had to exist at all.
   *
   * Changing it here still lasts one page: persisting the PICKER is PR 6's, and
   * it needs the voice switch beside it to be worth the write. What changes now
   * is only which coach the page opens on.
   */
  const [selected, setSelected] = useState(
    openingCoach(
      personas.map((p) => p.slug),
      chosenSlug
    )
  );
  // One player per mount, disposed on unmount — `./coach-voice`, which the
  // welcome flow's coach step shares. The markup below is not shared: this tab
  // has one selected coach and one button, that step has six rows.
  const { voice, hear, stop, select } = useCoachVoice();

  const chosen = personas.find((p) => p.slug === selected) ?? null;
  const line = chosen?.sampleLine?.trim() ?? '';
  const [state, formAction, pending] = useActionState<DeliveryState, FormData>(
    deliverForPersona,
    EMPTY_DELIVERY
  );
  const deliverer = deliveredBy(personas, state.personaSlug);

  /*
   * A native `<select>` fires `change` only when the value actually changes, so
   * there is no same-slug case to short-circuit — the guard that used to sit
   * here existed for the chips, where pressing the lit one was a real event.
   */
  const choose = (slug: string) => {
    select();
    setSelected(slug);
  };

  // The shared predicate — src/speech/player.ts, where it sits beside
  // `whyShown` because the two are complements: exactly one of a button and a
  // sentence should show. Written out here AND on the welcome step until review
  // found the two spellings disagreeing about a whitespace-only line.
  const canHear = hearable(chosen, voiceAvailable);
  const why = whyShown(voice, chosen, voiceAvailable);

  return (
    <>
      {/* "Voice", not "Coach": the page's h1 is Coach now that the chat
          shares the tab, and an h2 repeating it reads as a broken heading
          outline to anyone navigating by headings. This section is the persona
          picker and the delivery, which is what a voice is. */}
      <h2 className="section">Voice</h2>
      <div className="card">
        {/*
         * The coach at the head of the card — the Quest Log. The menu below it
         * is still how the coach is chosen; the handoff's "Change" chip would
         * have hidden a control that ships (docs/plans/quest-log-redesign.md).
         */}
        <div className="voice-head">
          <Hex size={52}>
            <Icon name="message-circle" size={26} />
          </Hex>
          {/*
           * "Explains", not the handoff's "speaks" — FOUND IN REVIEW. On a card
           * with a Try button, "speaks" means audio, and the delivered plan is not
           * read aloud (ADR 0025 §4).
           */}
          <span className="voice-words">
            <strong className="display voice-name">{chosen?.name ?? 'No coach available'}</strong>
            <span className="muted small">
              Explains the plan in its own words; never changes a number in it.
            </span>
          </span>
        </div>
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
            {/*
             * NOT disabled during a delivery, and it was on the first pass —
             * FOUND IN REVIEW. React serialises the form at submit, so a later
             * choice cannot reach a request already in flight; the hidden field
             * below was never at risk. And it contradicted the button's own
             * reason for staying live: disabling the focused control drops
             * keyboard focus. The mismatch it looked like it prevented — a plan
             * rendered under a coach who did not deliver it — is not prevented
             * by it either, since the choice is free again the moment the
             * delivery lands. The delivery below answers it instead, by naming
             * the coach who wrote it.
             */}
            <select value={selected} onChange={(event) => choose(event.target.value)}>
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
            <CoachTryButton
              slug={chosen.slug}
              name={chosen.name}
              voice={voice}
              hear={hear}
              stop={stop}
            />
          ) : null}
        </div>

        {chosen?.bio ? (
          /*
           * Who this coach is, under the menu that names them — rework PR 5.
           *
           * The menu gave a name and nothing else, which was survivable at
           * three coaches and guesswork at six. It is a row (`personas.bio`),
           * not copy per slug, and it changes with the selection from personas
           * already loaded — no request per change, which is what PR 1 was
           * careful about when it made this a menu.
           *
           * `aria-live` is deliberately absent: the select announces its own
           * value on change, and a live region repeating the same choice as a
           * paragraph would say everything twice.
           */
          <p className="muted small persona-bio">{chosen.bio}</p>
        ) : null}

        {chosen && why !== null ? (
          // A coach with no line still says why it is silent — every state
          // renders something, docs/specs/mobile-interface.md §4.
          <p className="muted small" role="status">
            {SHOWN_TEXT[why]}
            {line !== '' ? ` ${chosen.name}: “${line}”` : null}
          </p>
        ) : null}

        <form action={formAction} className="coach-actions">
          <input type="hidden" name="personaSlug" value={selected} />
          <button type="submit" disabled={pending || selected === ''}>
            {pending ? 'Asking…' : 'Deliver this plan'}
          </button>
        </form>

        {state.error ? <p className="error small">{state.error}</p> : null}

        {/*
         * A delivery shown under a menu that has moved on names the coach who
         * wrote it (`deliverer`, from the slug the delivery returned) rather than
         * being hidden whenever `state.personaSlug` differs from `selected`.
         *
         * WHY not hide: the menu stays live after a delivery on purpose (the
         * comment on the select), and the reason to move it is to Try the other
         * voices. Hiding would make the plan somebody waited a model call for
         * vanish on the first menu change, with nothing on screen saying where it
         * went — every state renders something, docs/specs/mobile-interface.md §4
         * — and nobody would guess that moving the menu back restores it. A label
         * keeps the words and says whose they are.
         *
         * The gentle note is inside the same condition and names the same coach:
         * it describes this prose, and above a menu showing somebody else a bare
         * "Gentler tone" read as the new coach's. It stays OUTSIDE the box, and
         * says "in what X says" rather than "from X", because the tone is not the
         * coach's choice: code sets it from the log whichever coach is asked —
         * ADR 0006.
         */}
        {state.delivered ? (
          <>
            {state.gentle ? (
              // The user should know why the coach sounds different today, or the
              // tone change reads as the app being inconsistent.
              <p className="muted small gentle-note">
                Gentler tone in what {deliverer} says: your recent notes or attendance suggest this
                is not a week to push.
              </p>
            ) : null}

            <div className="delivered">
              <span className="label delivered-by">What {deliverer} says</span>
              <p>{state.delivered.opening}</p>
              {state.delivered.week_notes.map((note, i) => (
                <p key={weekLabels[i] ?? i}>
                  <span className="label">{weekLabels[i] ?? `Week ${i + 1}`}</span>
                  {note}
                </p>
              ))}
              <p>{state.delivered.closing}</p>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
