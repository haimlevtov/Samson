'use client';

/**
 * The voice switch — ADR 0031 §3, on the session card and the Coach tab's chat.
 *
 * Shared because both surfaces make the same promise in the same words: off by
 * default, per sitting, and it says what it costs before it is turned on. Two
 * copies of the sentence would drift, and the markup below carries two findings
 * from review that a second copy would lose.
 */

export function SpeakSwitch({
  speak,
  onChange,
  describedBy,
  label = 'Read the answers aloud',
  next = false,
}: {
  speak: boolean;
  onChange: (speak: boolean) => void;
  /** The id of the cost sentence, which each surface renders beside it. */
  describedBy: string;
  label?: string;
  /**
   * Say that the switch governs the NEXT answer only. The Coach tab needs it:
   * its transcript holds replies that were never spoken, and turning this on
   * does not read them out. The plan asked for that to be visible, not only in
   * a code comment. FOUND IN REVIEW.
   */
  next?: boolean;
}) {
  return (
    <>
      <label className="speak-toggle">
        {/*
         * A switch, not a tickbox — and still an `<input type="checkbox">`
         * underneath. `role="switch"` is the ARIA name for a control that is ON
         * or OFF right now rather than one submitted with a form, which is what
         * this is: nothing is saved, the toggle governs the next question.
         *
         * Built on the native input rather than a styled `<div>`: the keyboard
         * (space toggles), the label association, the focus ring and the
         * disabled semantics come free. A hand-rolled switch has to reimplement
         * all four and usually reimplements three.
         */}
        <input
          type="checkbox"
          role="switch"
          className="sr-only"
          aria-describedby={describedBy}
          checked={speak}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="track" aria-hidden="true">
          <span className="knob" />
        </span>
        <span className="speak-label">{label}</span>
      </label>
      {/*
       * OUTSIDE the label, and a description rather than part of the name —
       * FOUND IN REVIEW on the session card. Inside it, this sentence joined the
       * input's accessible name: `role="switch"` announced the state and the
       * name said it again, and because the name changed on every press the
       * whole two-sentence string was re-announced each time. A description is
       * read once, after the name and the state, which is the order somebody
       * needs it in.
       */}
      <p className="muted small speak-cost" id={describedBy}>
        {speak
          ? next
            ? 'On — the next answer is spoken, which costs the app money. Earlier ones stay written.'
            : 'On — the coach speaks its answers, which costs the app money.'
          : 'Off — answers arrive written. Speaking them costs the app money.'}
      </p>
    </>
  );
}
