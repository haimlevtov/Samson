'use client';

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
 *
 * Moved out of `CoachConsole` when the welcome flow's coach step grew a Try
 * button of its own. Two surfaces that can refuse to speak for the same five
 * reasons must say the same five sentences, or one of them is quietly worse.
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
 * One coach player for a component, made in the browser and disposed on unmount.
 *
 * WHY this is a hook rather than a second copy of the wiring: the player owns
 * the audio element, the in-flight request, the supersede-on-change rule and
 * every blob URL it creates — `dispose` stops the audio, supersedes any press in
 * flight and revokes them all. A second hand-rolled copy of that on the welcome
 * step would be a second place for a leak to live.
 *
 * WHAT IS DELIBERATELY NOT SHARED is the markup. The Coach tab has one selected
 * coach and one button; the welcome step has six rows, each with its own. The
 * player already keys everything by slug — `fetching`, `playing` and `shown` all
 * name a coach — so one player drives either shape, and forcing one layout onto
 * both would be the copy-paste wearing a component's clothes.
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

  return {
    voice,
    hear: (slug: string) => void player.current?.hear(slug),
    stop: () => player.current?.stop(),
    select: () => player.current?.select(),
  };
}
