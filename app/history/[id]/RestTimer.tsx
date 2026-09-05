'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { speak } from '@/src/ui/speak';

/**
 * The only place the app signals that rest is over.
 *
 * Phase 3 made the swap this note was left for, though not the way PLAN.md
 * described: the voice is the browser's own speechSynthesis rather than a
 * precomputed persona clip, because the only key this project has is for text —
 * ADR 0006. The beep remains as the fallback, and it is not redundant: speech
 * is unavailable on plenty of devices and silently doing nothing would be worse
 * than a tone.
 *
 * AI-NOTE: still the single call site. If a real TTS provider is ever added,
 *          this is the one function that changes.
 */
function announceRestOver(): void {
  if (speak('Rest over.')) return;

  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => void ctx.close();
  } catch {
    // A blocked audio context must not break the timer. The visual state is the
    // primary cue; sound is an enhancement.
  }
}

function format(seconds: number): string {
  const clamped = Math.max(0, seconds);
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * Set by the parent when a set is ticked, to start rest without a second tap.
 * `nonce` exists so that two consecutive sets with the same rest length still
 * restart the clock — the seconds alone would not change and the effect would
 * not re-run.
 */
export interface RestTrigger {
  seconds: number;
  nonce: number;
}

/** How long "Go" stays on screen before the bar gets out of the way. */
const DONE_LINGER_MS = 5000;

const ADJUST_SECONDS = 15;

/**
 * Rest, pinned to the bottom of the viewport.
 *
 * WHY pinned rather than inline between the set rows, which is where the
 * reference design puts it: rest is rank 1 in docs/specs/mobile-interface.md §2
 * — it is the only time-critical thing on the screen — and an inline bar
 * scrolls away as soon as the session is longer than a phone. The static rest
 * lengths between logged rows stay inline; only the running one is pinned.
 *
 * WHY there are no preset buttons any more: rest length now belongs to the row
 * (tap a set number to change it) and starts on its own when the set is ticked.
 * What is left here is what someone actually reaches for mid-rest — more time,
 * less time, or stop waiting.
 */
export function RestTimer({ trigger }: { trigger?: RestTrigger | null }) {
  const [target, setTarget] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [visible, setVisible] = useState(false);

  /**
   * WHY the deadline is stored rather than decrementing a counter: setInterval
   * drifts, and browsers throttle timers in background tabs. Someone resting
   * between sets is very likely to switch away from the tab, and coming back to
   * a timer that lost thirty seconds is worse than no timer at all.
   */
  const deadlineRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const hideRef = useRef<number | null>(null);

  const cancelHide = () => {
    if (hideRef.current !== null) window.clearTimeout(hideRef.current);
    hideRef.current = null;
  };

  const startFor = useCallback((seconds: number) => {
    cancelHide();
    firedRef.current = false;
    deadlineRef.current = Date.now() + seconds * 1000;
    setTarget(seconds);
    setRemaining(seconds);
    setRunning(true);
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!running) return;

    const tick = () => {
      if (deadlineRef.current === null) return;
      const left = Math.ceil((deadlineRef.current - Date.now()) / 1000);
      setRemaining(left);

      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        setRunning(false);
        announceRestOver();
        hideRef.current = window.setTimeout(() => setVisible(false), DONE_LINGER_MS);
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [running]);

  // Auto-start when the parent logs a set.
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!trigger || trigger.nonce === lastNonce.current) return;
    lastNonce.current = trigger.nonce;
    startFor(trigger.seconds);
  }, [trigger, startFor]);

  useEffect(() => cancelHide, []);

  const adjust = (delta: number) => {
    if (deadlineRef.current === null) return;
    const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
    const next = Math.max(ADJUST_SECONDS, left + delta);
    deadlineRef.current = Date.now() + next * 1000;
    // The bar measures against the longer of the two, so adding time cannot
    // make a full bar suddenly read as empty.
    setTarget((current) => Math.max(current, next));
    setRemaining(next);
    firedRef.current = false;
    setRunning(true);
  };

  const skip = () => {
    cancelHide();
    deadlineRef.current = null;
    setRunning(false);
    setVisible(false);
  };

  if (!visible) return null;

  const done = remaining <= 0;
  const progress = done ? 1 : 1 - Math.max(0, remaining) / Math.max(1, target);

  return (
    <div className={`rest-bar ${done ? 'done' : ''}`}>
      <div className="rest-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />

      <div className="rest-face">
        {done ? (
          <span className="rest-count">Go</span>
        ) : (
          <>
            <button
              type="button"
              className="rest-adjust"
              aria-label="Fifteen seconds less rest"
              onClick={() => adjust(-ADJUST_SECONDS)}
            >
              −15
            </button>
            {/* Not announced: it changes four times a second. The end of rest
                is announced instead, in the live region below. */}
            <span className="rest-count" aria-hidden="true">
              {format(remaining)}
            </span>
            <button
              type="button"
              className="rest-adjust"
              aria-label="Fifteen seconds more rest"
              onClick={() => adjust(ADJUST_SECONDS)}
            >
              +15
            </button>
          </>
        )}

        <button type="button" className="rest-skip" onClick={skip}>
          {done ? 'Dismiss' : 'Skip'}
        </button>
      </div>

      <span className="sr-only" aria-live="polite">
        {done ? 'Rest over.' : ''}
      </span>
    </div>
  );
}
