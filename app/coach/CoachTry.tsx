'use client';

/**
 * The control that makes a coach speak, and the sentences it says instead.
 *
 * Two surfaces have one now — the Coach tab's Voice card and the welcome flow's
 * coach step — so the button, its states and its accessible name live here
 * rather than being written twice. `SHOWN_TEXT` was single-sourced on the same
 * argument when this file was `coach-voice.ts`: two surfaces that can refuse for
 * the same five reasons must say the same five sentences, or one is quietly
 * worse. FOUND IN REVIEW that the markup had not followed the copy.
 *
 * WHAT IS NOT SHARED is the layout around it. The Coach tab has one selected
 * coach and puts the reason beside the line it would have spoken; the welcome
 * step has six rows and always shows the line as part of the coach's
 * description. Forcing one arrangement onto both would be the copy-paste
 * wearing a component's clothes.
 */
import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_PLAYER,
  createCoachPlayer,
  type CoachPlayer,
  type PlayerState,
  type ShownReason,
} from '@/src/speech/player';
import { hearCoach } from './actions';

/**
 * What a card says beside a coach's line when it is shown instead of heard —
 * every state renders something (docs/specs/mobile-interface.md §4).
 */
export const SHOWN_TEXT: Record<ShownReason, string> = {
  'no-key': 'The coach voices are not set up here.',
  budget: "This week's coaching budget is spent, so the coach cannot speak until it resets.",
  'no-voice': 'This coach has no voice yet.',
  /*
   * "Try again in a moment" was here until the button became Try — FOUND IN
   * REVIEW. Under a control with that word on it, the sentence stopped being a
   * reassurance and became an instruction to press the thing that just failed.
   * The button is right there and is still pressable, so the affordance did not
   * need a sentence; ADR 0025's open item is that this wording is wrong for a
   * provider REFUSAL, and saying less is the smaller claim.
   */
  failed: 'The voice did not come through.',
  blocked: 'This browser held the sound back. Tap again to play.',
};

/**
 * One coach player for a component, made on demand and disposed on unmount.
 *
 * WHY a hook rather than a second copy of the wiring: the player owns the audio
 * element, the in-flight request, the supersede-on-change rule and every blob
 * URL it creates — `dispose` stops the audio, supersedes any press in flight and
 * revokes them all. A second hand-rolled copy would be a second place for a leak
 * to live.
 *
 * The player already keys everything by slug — `fetching`, `playing` and `shown`
 * all name a coach — so ONE of these drives a single button or six.
 */
export function useCoachVoice(): {
  voice: PlayerState;
  /** Fetch and play this coach's line. A second press joins the call in flight. */
  hear: (slug: string) => void;
  stop: () => void;
  /** Tell the player the selection changed, so a press in flight is superseded. */
  select: () => void;
} {
  const [voice, setVoice] = useState<PlayerState>(EMPTY_PLAYER);
  const player = useRef<CoachPlayer | null>(null);

  /*
   * Made on demand, not only in the effect — FOUND IN REVIEW. A passive effect
   * has not flushed when the first paint lands, so a press arriving before it
   * did NOTHING AT ALL: no "Finding…", no sentence, no log. On the Coach tab
   * that is a narrow window on a page somebody navigated to; on the welcome step
   * it is six buttons on the first screen a new user sees.
   *
   * The effect still owns teardown, which is the part that must not be skipped.
   */
  const ensure = (): CoachPlayer => {
    player.current ??= createCoachPlayer({
      audio: new Audio(),
      fetchClip: hearCoach,
      toUrl: (audio, contentType) => URL.createObjectURL(new Blob([audio], { type: contentType })),
      revoke: (url) => URL.revokeObjectURL(url),
      onChange: setVoice,
    });
    return player.current;
  };

  useEffect(() => {
    const created = ensure();
    return () => {
      created.dispose();
      player.current = null;
    };
    // `ensure` closes over a ref and `setVoice`, both stable for the life of
    // the component, so an empty dependency list is correct here: one player
    // per mount is the whole contract.
  }, []);

  return {
    voice,
    hear: (slug: string) => void ensure().hear(slug),
    stop: () => ensure().stop(),
    select: () => ensure().select(),
  };
}

/**
 * Try, or Stop while this coach is playing.
 *
 * WHY it stays enabled while fetching: disabling the focused button drops
 * keyboard focus, and a second press joins the call already in flight rather
 * than paying twice.
 *
 * WHY the coach's name is in the CONTENT rather than an `aria-label` — FOUND IN
 * REVIEW on the Coach tab, and it matters more here where six of these sit
 * together. A constant label is a name that does not change when the button is
 * pressed, and `aria-busy` announces nothing on a button, so a screen-reader
 * user got silence for the whole fetch — about eight seconds, measured in ADR
 * 0025. The name changes with the state instead, and the visible word is
 * contained in it, which an overriding `aria-label` was not (WCAG 2.5.3).
 */
export function CoachTryButton({
  slug,
  name,
  voice,
  hear,
  stop,
  className,
}: {
  slug: string;
  name: string;
  voice: PlayerState;
  hear: (slug: string) => void;
  stop: () => void;
  /**
   * PRIMARY on the Coach tab, where it is the one thing to press — this plan's
   * PR 1 made it so deliberately. SECONDARY on the welcome step, where six
   * primary buttons would out-shout the Continue that ends the step.
   */
  className?: string;
}) {
  if (voice.playing === slug) {
    return (
      <button type="button" className="secondary" onClick={stop}>
        Stop
      </button>
    );
  }

  const fetching = voice.fetching === slug;

  return (
    <button type="button" className={className} aria-busy={fetching} onClick={() => hear(slug)}>
      {fetching ? 'Finding…' : 'Try'}
      {/* Clipped rather than shortened, because the button's width is why the
          name left the visible label in the first place. */}
      <span className="sr-only"> {name}’s voice</span>
    </button>
  );
}
