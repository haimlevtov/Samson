/**
 * The persona stage, proved with no key, no network and no database.
 *
 * The criterion this file exists for: "Persona layer cannot alter any number in
 * the plan it receives — asserted by test, not by prompt" (PLAN.md phase 3).
 * guard.test.ts proves the check; this proves the stage actually applies it and
 * refuses to return anything that fails it.
 */
import { describe, expect, it } from 'vitest';
import type { CallOptions, LlmResult } from '../llm/types';
import type { TrainingBlock } from '../planner/schema';
import { InventedNumberError } from './guard';
import { BannedPhraseError, MAX_DELIVERY_ATTEMPTS, deliverPlan } from './deliver';
import { GENTLE_OVERRIDE } from './tone';
import type { DeliveredPlan, Persona } from './schema';

const BLOCK: TrainingBlock = {
  rationale: 'test',
  weeks: [1, 2].map((n) => ({
    week_number: n,
    is_deload: false,
    sessions: [
      {
        day_index: 0,
        focus: 'lower',
        exercises: [
          {
            exercise_slug: 'barbell-full-squat',
            set_groups: [{ count: 1, weight_kg: 62.5, reps: 5, rpe: 8, rest_seconds: 120 }],
          },
        ],
      },
    ],
  })),
};

const RIVAL: Persona = {
  slug: 'rival',
  name: 'The Rival',
  systemPrompt: 'You are competitive and you never let them coast.',
  intensity: 5,
  humorLevel: 'crude',
  bannedPhrases: [],
  voiceVariant: 0,
};

const ANALYST: Persona = { ...RIVAL, slug: 'analyst', name: 'The Analyst', intensity: 2 };
const MASTER: Persona = { ...RIVAL, slug: 'old-master', name: 'The Old Master', intensity: 3 };
const ALL = [RIVAL, ANALYST, MASTER];

const good: DeliveredPlan = {
  opening: 'Two weeks. Same lift, same 62.5 kg.',
  week_notes: ['Week 1: 5 reps, no heroics.', 'Week 2: same again, cleaner.'],
  closing: 'Log every set.',
};

const invents: DeliveredPlan = {
  ...good,
  opening: 'Work up to 70 kg by the end.',
};

const CALM = { notes: ['felt good'], adherenceRate: 0.95 };

interface Harness {
  call: <T>(o: CallOptions<T>) => Promise<LlmResult<T>>;
  captured: CallOptions<unknown>[];
}

function harness(script: DeliveredPlan[]): Harness {
  const captured: CallOptions<unknown>[] = [];
  let next = 0;
  return {
    captured,
    call: async <T>(options: CallOptions<T>): Promise<LlmResult<T>> => {
      captured.push(options as CallOptions<unknown>);
      const response = script[next++];
      if (response === undefined) throw new Error(`script exhausted at call ${next}`);
      return {
        data: response as T,
        modelUsed: 'stub',
        attempts: 1,
        costCredits: 0.0005,
        ledger: [],
      };
    },
  };
}

describe('deliverPlan', () => {
  it('returns prose that quotes the plan', async () => {
    const h = harness([good]);
    const result = await deliverPlan(
      'u1',
      {
        block: BLOCK,
        persona: RIVAL,
        userHumorMax: 'crude',
        tone: CALM,
      },
      { call: h.call }
    );

    expect(result.delivered).toEqual(good);
    expect(result.attempts).toBe(1);
  });

  it('rejects an invented number and asks again with it named', async () => {
    const h = harness([invents, good]);
    const result = await deliverPlan(
      'u1',
      {
        block: BLOCK,
        persona: RIVAL,
        userHumorMax: 'crude',
        tone: CALM,
      },
      { call: h.call }
    );

    expect(result.attempts).toBe(2);
    const retry = h.captured[1];
    expect(retry?.messages.at(-1)?.content).toContain('70');
  });

  it('throws rather than returning unchecked prose when the guard keeps failing', async () => {
    // ADR 0006: a delivery that fails the guard is not a degraded delivery. The
    // user cannot tell a quoted number from an invented one, so they see none.
    const h = harness([invents, invents]);
    await expect(
      deliverPlan(
        'u1',
        { block: BLOCK, persona: RIVAL, userHumorMax: 'crude', tone: CALM },
        { call: h.call }
      )
    ).rejects.toBeInstanceOf(InventedNumberError);
    expect(h.captured).toHaveLength(MAX_DELIVERY_ATTEMPTS);
  });

  it('rejects a note count that does not match the plan', async () => {
    const wrong: DeliveredPlan = { ...good, week_notes: ['only one'] };
    const h = harness([wrong, good]);
    const result = await deliverPlan(
      'u1',
      {
        block: BLOCK,
        persona: RIVAL,
        userHumorMax: 'crude',
        tone: CALM,
      },
      { call: h.call }
    );

    expect(result.attempts).toBe(2);
    expect(h.captured[1]?.messages.at(-1)?.content).toContain('2 week');
  });

  it("enforces the row's banned phrases in code, not by asking nicely", async () => {
    const fussy: Persona = { ...RIVAL, bannedPhrases: ['no pain no gain'] };
    const offending: DeliveredPlan = { ...good, closing: 'No pain no gain.' };
    const h = harness([offending, offending]);

    await expect(
      deliverPlan(
        'u1',
        { block: BLOCK, persona: fussy, userHumorMax: 'crude', tone: CALM },
        { call: h.call }
      )
    ).rejects.toBeInstanceOf(BannedPhraseError);
  });
});

describe('deliverPlan — the persona row is data, not instruction', () => {
  it.each(ALL.map((p) => [p.slug, p] as const))(
    "%s: the row's prompt is fenced in the user message and absent from system",
    async (_slug, persona) => {
      const h = harness([good]);
      await deliverPlan(
        'u1',
        { block: BLOCK, persona, userHumorMax: 'crude', tone: CALM },
        { call: h.call }
      );

      const sent = h.captured[0];
      // ADR 0005 §1 and ADR 0006: a persona row cannot escalate its own
      // privileges, because it never reaches the instruction channel.
      expect(sent?.system).not.toContain(persona.systemPrompt);
      expect(sent?.messages[0]?.content).toContain('SAMSON-UNTRUSTED');
      expect(sent?.messages[0]?.content).toContain(persona.systemPrompt);
    }
  );
});

describe('deliverPlan — the tone override applies regardless of persona', () => {
  it.each(ALL.map((p) => [p.slug, p] as const))(
    '%s: an injury note puts the override in the request',
    async (_slug, persona) => {
      const h = harness([good]);
      const result = await deliverPlan(
        'u1',
        {
          block: BLOCK,
          persona,
          userHumorMax: 'crude',
          tone: { notes: ['sharp knee pain on the second set'], adherenceRate: 0.95 },
        },
        { call: h.call }
      );

      expect(result.tone.gentle).toBe(true);
      expect(h.captured[0]?.messages[0]?.content).toContain(GENTLE_OVERRIDE);
    }
  );

  it.each(ALL.map((p) => [p.slug, p] as const))(
    '%s: a calm history leaves the override out',
    async (_slug, persona) => {
      const h = harness([good]);
      await deliverPlan(
        'u1',
        { block: BLOCK, persona, userHumorMax: 'crude', tone: CALM },
        { call: h.call }
      );
      expect(h.captured[0]?.messages[0]?.content).not.toContain(GENTLE_OVERRIDE);
    }
  );
});
