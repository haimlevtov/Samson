'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * AI-NOTE: this is the only place the app signals that rest is over. Phase 3
 *          replaces it with a precomputed persona audio clip — "rest over" is
 *          named in PLAN.md as one of the high-frequency live events. Keep the
 *          cue behind this one function so that swap touches nothing else.
 */
function announceRestOver(): void {
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
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Set by the parent when a set is logged, to start rest without a second click.
 * `nonce` exists so that two consecutive sets with the same rest length still
 * restart the clock — the seconds alone would not change and the effect would
 * not re-run.
 */
export interface RestTrigger {
  seconds: number;
  nonce: number;
}

const PRESETS = [60, 90, 120, 180] as const;

export function RestTimer({
  defaultSeconds = 120,
  trigger,
}: {
  defaultSeconds?: number;
  trigger?: RestTrigger | null;
}) {
  const [target, setTarget] = useState(defaultSeconds);
  const [remaining, setRemaining] = useState(defaultSeconds);
  const [running, setRunning] = useState(false);

  /**
   * WHY the deadline is stored rather than decrementing a counter: setInterval
   * drifts, and browsers throttle timers in background tabs. Someone resting
   * between sets is very likely to switch away from the tab, and coming back to
   * a timer that lost thirty seconds is worse than no timer at all.
   */
  const deadlineRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const startFor = useCallback((seconds: number) => {
    firedRef.current = false;
    deadlineRef.current = Date.now() + seconds * 1000;
    setTarget(seconds);
    setRemaining(seconds);
    setRunning(true);
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

  const stop = useCallback(() => {
    setRunning(false);
    deadlineRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    firedRef.current = false;
    setRemaining(target);
  }, [stop, target]);

  const done = remaining <= 0 && !running;
  const progress = running || done ? 1 - Math.max(0, remaining) / Math.max(1, target) : 0;

  return (
    <div className="card timer-card timer-rest">
      <div className="timer-head">
        <div>
          <div className="label">Rest</div>
          <div className={`timer ${done ? 'done' : ''}`} aria-live="polite">
            {done ? 'Go' : format(remaining)}
          </div>
        </div>

        <div className="timer-controls">
          {PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip ${target === s ? 'chip-on' : ''}`}
              aria-pressed={target === s}
              onClick={() => {
                setTarget(s);
                if (!running) setRemaining(s);
              }}
            >
              {s}s
            </button>
          ))}
          {running ? (
            <button type="button" className="secondary" onClick={stop}>
              Pause
            </button>
          ) : (
            <button type="button" onClick={() => startFor(target)}>
              Start
            </button>
          )}
          <button type="button" className="secondary" onClick={reset}>
            Reset
          </button>
        </div>
      </div>

      <div className="bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
    </div>
  );
}
