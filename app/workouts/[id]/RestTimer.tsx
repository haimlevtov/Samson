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

export function RestTimer({ defaultSeconds = 120 }: { defaultSeconds?: number }) {
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

  const start = useCallback(() => {
    firedRef.current = false;
    deadlineRef.current = Date.now() + target * 1000;
    setRemaining(target);
    setRunning(true);
  }, [target]);

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

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="label muted small" style={{ textTransform: 'uppercase' }}>
            Rest
          </div>
          <div className={`timer ${done ? 'done' : ''}`} aria-live="polite">
            {done ? 'Go' : format(remaining)}
          </div>
        </div>

        <div className="row">
          {[60, 90, 120, 180].map((s) => (
            <button
              key={s}
              type="button"
              className="secondary"
              aria-pressed={target === s}
              style={target === s ? { borderColor: 'var(--accent)' } : undefined}
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
            <button type="button" onClick={start}>
              Start
            </button>
          )}
          <button type="button" className="secondary" onClick={reset}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
