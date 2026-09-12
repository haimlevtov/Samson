/**
 * Where a new user is up to — ADR 0032 §2.
 *
 * Pure, and deliberately so: this is the whole of the routing decision, and it
 * runs in the unit suite with no database. The route reads what is stored and
 * asks this function what to render; there is no onboarding state table, because
 * that would be a second source of truth about a thing the real tables know.
 *
 * INVARIANT: derived from stored data, never from a cursor — which is what makes
 *            the flow resumable. A closed tab loses nothing; there is nothing to
 *            lose.
 */

/**
 * The steps, in the order they are asked.
 *
 * Order is a decision, not a list. The name is first because it is the only one
 * that cannot be skipped and because it is what the coach calls you. Equipment
 * is late because it is the longest, and a long form early is where people
 * leave. The plan is last because it is the only step that spends money.
 */
export const ONBOARDING_STEPS = ['name', 'body', 'goal', 'equipment', 'plan'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** What the route knows about a user, as far as onboarding cares. */
export interface OnboardingState {
  displayName: string | null;
  /** True when all four the diet engine needs are present — ADR 0024. */
  hasBiometrics: boolean;
  dietGoal: string | null;
  hasEquipment: boolean;
  hasPlan: boolean;
  /**
   * Steps the user has explicitly passed over. Held in the URL rather than
   * stored: a skip is a statement about this sitting, not about the user, and
   * somebody who comes back later should be asked again rather than silently
   * carried past a question they never answered.
   */
  skipped: readonly OnboardingStep[];
}

/** Whether a step's question has been answered by what is stored. */
export function isAnswered(step: OnboardingStep, state: OnboardingState): boolean {
  switch (step) {
    case 'name':
      return state.displayName !== null && state.displayName.trim() !== '';
    case 'body':
      return state.hasBiometrics;
    case 'goal':
      return state.dietGoal !== null;
    case 'equipment':
      return state.hasEquipment;
    case 'plan':
      return state.hasPlan;
  }
}

/**
 * The step to render, or null when there is nothing left to ask.
 *
 * A step is skipped past when it is answered OR when the user said to skip it.
 * Null means onboarding is over — the caller sends them to the app.
 */
export function nextStep(state: OnboardingState): OnboardingStep | null {
  /*
   * `name` is never skippable, and the guard is here rather than at the caller
   * because the skip list comes from the QUERY STRING — it is user input like
   * any other, and `?skip=name` would otherwise walk past the one step ADR 0032
   * §2 says cannot be passed over. FOUND BY ITS OWN TEST, before it shipped.
   */
  const skipped: Set<OnboardingStep> = new Set(
    state.skipped.filter((step): step is OnboardingStep => step !== 'name')
  );
  return ONBOARDING_STEPS.find((step) => !isAnswered(step, state) && !skipped.has(step)) ?? null;
}

/**
 * How far along, for the progress line.
 *
 * INVARIANT: counted over ALL steps, including skipped ones, and the number the
 *            user sees is the step they are ON rather than the number completed.
 *            "Question 3 of 5" is a position; "2 of 5 done" invites somebody to
 *            wonder why skipping did not move it.
 */
export function progressFor(step: OnboardingStep): { position: number; total: number } {
  return { position: ONBOARDING_STEPS.indexOf(step) + 1, total: ONBOARDING_STEPS.length };
}

/**
 * What skipping this step costs, in the app's own words.
 *
 * INVARIANT: every one of these describes a state the app ALREADY renders
 *            honestly — ADR 0029's no-equipment card, ADR 0024's missing
 *            biometric refusals. Onboarding is not making a promise here; it is
 *            naming the refusal the user will meet, before they meet it. If one
 *            of these stops being true, the surface it describes changed and
 *            this string is the bug.
 *
 * `name` is absent because it cannot be skipped.
 */
export const SKIP_COST: Record<Exclude<OnboardingStep, 'name'>, string> = {
  body: 'Without these the coach cannot work out a calorie target, and the diet answers will say so.',
  goal: 'The coach will assume you want to maintain. You can change it on the Coach tab, and it will remember.',
  equipment:
    'Without equipment there is nothing for a plan to choose from, so the planner will have nothing to offer.',
  plan: 'You can ask for one any time on the Coach tab.',
};
