/**
 * Tests for `src/ui/speak.ts`.
 *
 * What is left to test, now that ADR 0025 has taken the coaches off device
 * speech, is the module's promise to its one caller, the rest timer: it never
 * throws, and it says when nothing started, so the beep fires instead.
 *
 * The node environment has no `speechSynthesis`, which is exactly the condition
 * that promise is about. The asynchronous failure — queued, then `not-allowed`
 * on iOS Safari — needs a real speech engine, and a hand-built fake of one
 * would assert the fake.
 *
 * The voice-selection tests that lived here went with the functions they
 * tested: `pickVoice`, `voiceSettings`, `previewSpeech` and `personaSpeech`
 * chose and shaped a device voice for a coach, which nothing does any more.
 */
import { describe, expect, it, vi } from 'vitest';
import { speak } from './speak';

describe('speak, where the device cannot speak', () => {
  it('reports that nothing started, so the caller can fall back', () => {
    expect(speak('Rest over.')).toBe(false);
  });

  it('leaves the fallback to the caller rather than sounding it twice', () => {
    /*
     * The rest timer beeps when this returns false AND hands in the beep as
     * onFailure. Calling onFailure on this path as well would beep twice for
     * one rest — onFailure is for a failure after a successful start.
     */
    const onFailure = vi.fn();
    expect(speak('Rest over.', { onFailure })).toBe(false);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('does not throw for a blank cue', () => {
    expect(() => speak('   ')).not.toThrow();
    expect(speak('   ')).toBe(false);
  });
});
