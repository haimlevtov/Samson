/**
 * Where a new user is up to — ADR 0032 §2.
 *
 * The routing decision is the whole of onboarding's logic, so it is the whole of
 * what can be tested without a browser. What the steps LOOK like is the browser
 * pass's problem; what they are and in what order is this file's.
 */
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  SKIP_COST,
  isAnswered,
  nextStep,
  progressFor,
  type OnboardingState,
} from './steps';

const EMPTY: OnboardingState = {
  displayName: null,
  personaSlug: null,
  hasBiometrics: false,
  dietGoal: null,
  hasEquipment: false,
  hasPlan: false,
  skipped: [],
};

describe('nextStep', () => {
  it('asks for the name first, because it is the one that cannot be skipped', () => {
    expect(nextStep(EMPTY)).toBe('name');
  });

  it('walks the steps in order as each is answered', () => {
    const named = { ...EMPTY, displayName: 'Noa' };
    expect(nextStep(named)).toBe('coach');

    const answered = { ...named, personaSlug: 'sergeant' };
    expect(nextStep(answered)).toBe('body');
    expect(nextStep({ ...answered, hasBiometrics: true })).toBe('goal');
    expect(nextStep({ ...answered, hasBiometrics: true, dietGoal: 'gain' })).toBe('equipment');
    expect(
      nextStep({ ...answered, hasBiometrics: true, dietGoal: 'gain', hasEquipment: true })
    ).toBe('plan');
  });

  it('counts a coach as chosen by which one, not by whether the question was seen', () => {
    /*
     * The column is a slug and null means "has not chosen" — the same shape
     * `diet_goal` uses, for the same reason. An empty string is what a
     * hand-written POST leaves, and it is NOT an answer: the Coach tab would
     * fall back to the first coach and the user would never have picked one.
     */
    const named = { ...EMPTY, displayName: 'Noa' };
    expect(isAnswered('coach', named)).toBe(false);
    expect(isAnswered('coach', { ...named, personaSlug: '' })).toBe(false);
    expect(isAnswered('coach', { ...named, personaSlug: '   ' })).toBe(false);
    expect(isAnswered('coach', { ...named, personaSlug: 'old-master' })).toBe(true);
  });

  it('treats a coach that no longer exists as chosen anyway', () => {
    /*
     * `is_active = false` retires a coach without deleting the row, so a stored
     * slug can stop naming anything the picker lists. The question was still
     * answered — asking it again would be the app second-guessing a choice the
     * user made — and every reader falls back. That fallback is why the column
     * carries no foreign key.
     */
    const named = { ...EMPTY, displayName: 'Noa', personaSlug: 'retired-coach' };
    expect(isAnswered('coach', named)).toBe(true);
    expect(nextStep(named)).toBe('body');
  });

  it('is over when everything is answered', () => {
    expect(
      nextStep({
        displayName: 'Noa',
        personaSlug: 'rival',
        hasBiometrics: true,
        dietGoal: 'maintain',
        hasEquipment: true,
        hasPlan: true,
        skipped: [],
      })
    ).toBeNull();
  });

  it('passes over a step the user skipped, without marking it answered', () => {
    const skipped = {
      ...EMPTY,
      displayName: 'Noa',
      personaSlug: 'physio',
      skipped: ['body'] as const,
    };
    expect(nextStep(skipped)).toBe('goal');
    // The distinction that matters: skipping is not answering, and anything
    // reading the stored data still sees an unanswered question.
    expect(isAnswered('body', skipped)).toBe(false);
  });

  it('is over when everything left has been skipped', () => {
    expect(
      nextStep({
        ...EMPTY,
        displayName: 'Noa',
        skipped: ['coach', 'body', 'goal', 'equipment', 'plan'],
      })
    ).toBeNull();
  });

  it('treats a blank name as unanswered, not as answered with nothing', () => {
    // A `users` row with `display_name: ''` is what a mis-submitted form leaves
    // behind, and it must not carry somebody past the one required question.
    expect(nextStep({ ...EMPTY, displayName: '' })).toBe('name');
    expect(nextStep({ ...EMPTY, displayName: '   ' })).toBe('name');
  });

  it('does not let a skip carry somebody past the name', () => {
    /*
     * The name is the only step ADR 0032 §2 calls unskippable. This asserts the
     * routing honours that even when the URL says otherwise — the skip list
     * comes from the query string, so it is user input like any other.
     */
    expect(nextStep({ ...EMPTY, skipped: ['name' as never] })).toBe('name');
  });
});

describe('progressFor', () => {
  it('reports the position of the step, not the number completed', () => {
    // "Question 3 of 5" is where you are. "2 of 5 done" invites somebody who
    // skipped one to wonder why the number did not move.
    expect(progressFor('name')).toEqual({ position: 1, total: 6 });
    expect(progressFor('coach')).toEqual({ position: 2, total: 6 });
    expect(progressFor('plan')).toEqual({ position: 6, total: 6 });
  });

  it('covers every step', () => {
    for (const step of ONBOARDING_STEPS) {
      const { position, total } = progressFor(step);
      expect(position).toBeGreaterThan(0);
      expect(total).toBe(ONBOARDING_STEPS.length);
    }
  });
});

describe('SKIP_COST', () => {
  it('names a cost for every skippable step and none for the name', () => {
    const skippable = ONBOARDING_STEPS.filter((s) => s !== 'name');
    expect(Object.keys(SKIP_COST).sort()).toEqual([...skippable].sort());
  });

  it('says what the app will do, not what the user should do', () => {
    // These describe refusals the app already renders. A sentence that told the
    // user off for skipping would be a different thing entirely.
    for (const cost of Object.values(SKIP_COST)) {
      expect(cost).not.toMatch(/\byou should\b|\bmust\b|\bneed to\b/i);
      expect(cost.length).toBeGreaterThan(20);
    }
  });
});
