'use client';

import { useActionState, useEffect, useRef } from 'react';
import { MAX_CHAT_MESSAGE_CHARS } from '@/src/llm/config';
import { sendChatMessage } from './actions';
import { EMPTY_CHAT, type ChatState } from './chat-state';

/**
 * The open chat. Design and threat model: ADR 0015.
 *
 * WHY the transcript lives in this component's action state rather than in a
 * table: the chat has no database write path, and that absence is what makes
 * "a jailbroken chat cannot persist anything" a guarantee instead of a hope.
 * The cost is that the conversation ends with the page, which is stated to the
 * user rather than left to be discovered.
 *
 * Everything that constrains the coach is on the server — this component sends
 * a string and renders one back. Nothing here is a control.
 */
export function ChatPanel() {
  const [state, formAction, pending] = useActionState<ChatState, FormData>(
    sendChatMessage,
    EMPTY_CHAT
  );

  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /*
   * Clear the box once a turn lands, not on submit.
   *
   * WHY: clearing optimistically loses what the user wrote whenever the call
   * fails, and the failure case here is the common one — no API key, or the
   * weekly budget spent. The action returns the user's own turn in `turns`
   * either way, so by the time this runs the message is on screen.
   */
  useEffect(() => {
    formRef.current?.reset();
  }, [state.turns]);

  // Newest turn into view. `block: 'nearest'` so the page does not jump when
  // the panel is already fully visible.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.turns]);

  return (
    <>
      <h2 className="section">Talk to your coach</h2>

      <div className="card chat">
        {state.turns.length === 0 ? (
          /*
           * The boundary is stated before somebody hits it. A refusal that
           * arrives with no warning reads as the app being broken; the same
           * refusal after this line reads as the thing it is.
           */
          <p className="muted chat-empty">
            Ask about your training — a lift that has stalled, whether to deload, why a week felt
            heavy. This coach only talks about your training, and it can only see the figures on
            your Profile and History tabs. The conversation is not saved: it ends when you leave
            this page.
          </p>
        ) : (
          <ol className="chat-log">
            {state.turns.map((turn, i) => (
              <li
                // Index is part of the key on purpose: the same question asked
                // twice is two turns, and the text alone would collide.
                key={`${i}-${turn.role}`}
                className={`chat-turn chat-${turn.role}`}
              >
                <span className="chat-who">{turn.role === 'user' ? 'You' : 'Coach'}</span>
                <p>{turn.text}</p>
              </li>
            ))}
          </ol>
        )}

        <div ref={endRef} />

        {state.error ? <p className="error small">{state.error}</p> : null}

        <form action={formAction} ref={formRef} className="chat-form">
          <label className="sr-only" htmlFor="chat-message">
            Message your coach
          </label>
          <textarea
            id="chat-message"
            name="message"
            rows={2}
            // The server rejects anything longer and says so; this stops most
            // people reaching that error at all.
            maxLength={MAX_CHAT_MESSAGE_CHARS}
            placeholder="How is my squat going?"
            disabled={pending}
          />
          <div className="row chat-actions">
            <button type="submit" disabled={pending}>
              {pending ? 'Asking…' : 'Send'}
            </button>
            {state.turns.length > 0 ? (
              <button
                type="submit"
                name="intent"
                value="clear"
                className="secondary"
                disabled={pending}
              >
                Clear
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </>
  );
}
