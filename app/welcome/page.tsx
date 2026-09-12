import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { equipmentCatalogue } from '@/src/db/equipment';
import { userEquipment } from '@/src/db/exercises';
import { latestAcceptedPlan } from '@/src/db/personas';
import { DIET_GOALS } from '@/src/diet/energy';
import { SEXES } from '@/src/diet/biometrics';
import {
  ONBOARDING_STEPS,
  SKIP_COST,
  nextStep,
  progressFor,
  type OnboardingStep,
} from '@/src/onboarding/steps';
import { EquipmentForm } from '../settings/EquipmentForm';
import { PlanRequestForm } from '../coach/PlanRequestForm';
import { finishOnboarding, saveBiometrics, saveGoal, saveName, skipStep } from './actions';

export const dynamic = 'force-dynamic';

/**
 * The first sixty seconds — ADR 0032 §2.
 *
 * One question per screen, and the screen is chosen by reading what is stored
 * rather than by a cursor. That is the whole of why it is resumable: there is no
 * progress to lose, because progress IS the data.
 *
 * INVARIANT: every step writes its own table before the next one renders. A
 *            closed tab costs nothing, and an abandoned onboarding leaves a user
 *            in exactly the state they answered their way to.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ skip?: string; invalid?: string }>;
}) {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const { skip, invalid } = await searchParams;

  const [tags, owned, plan] = await Promise.all([
    equipmentCatalogue(db),
    userEquipment(db, user.id),
    latestAcceptedPlan(db),
  ]);

  /*
   * The skip list is query-string input, so it is filtered against the known
   * steps rather than trusted. `nextStep` independently refuses to skip `name`,
   * which is the guard that matters — this one only keeps junk out of the round
   * trip.
   */
  const known = new Set<string>(ONBOARDING_STEPS);
  const skipped = (skip ?? '')
    .split(',')
    .filter((value): value is OnboardingStep => known.has(value));

  const step = nextStep({
    displayName: user.displayName,
    // The four ADR 0024 needs. All four or none: a partial profile is what its
    // three refusals are about, and the step asks for all four together.
    hasBiometrics:
      user.bodyweightKg !== null &&
      user.heightCm !== null &&
      user.birthDate !== null &&
      user.sex !== null,
    dietGoal: user.dietGoal,
    hasEquipment: owned.length > 0,
    hasPlan: plan !== null,
    skipped,
  });

  // Nothing left to ask. Somebody who arrives here with a finished profile has
  // finished onboarding, whether or not they remember doing it.
  if (step === null) redirect('/hub');

  const { position, total } = progressFor(step);
  const carried = skipped.join(',');

  return (
    <>
      <header className="welcome-head">
        <h1>Welcome to Samson</h1>
        {/*
         * The POSITION, not the count completed — src/onboarding/steps.ts says
         * why: somebody who skipped one should not have to wonder why the
         * number did not move.
         */}
        <p className="muted small" role="status">
          Question {position} of {total}
        </p>
        <div className="welcome-progress" aria-hidden="true">
          <span style={{ width: `${(position / total) * 100}%` }} />
        </div>
      </header>

      {invalid !== undefined ? (
        // Every state renders something — docs/specs/mobile-interface.md §4.
        // The step re-renders with its own question rather than an error page.
        <p className="card error" role="status">
          That did not look right. Have another go.
        </p>
      ) : null}

      {step === 'name' ? (
        <>
          <h2 className="section">What should the coach call you?</h2>
          <div className="card">
            <form action={saveName} className="welcome-form">
              <label>
                <span className="label">Your name</span>
                <input type="text" name="displayName" maxLength={60} autoFocus required />
              </label>
              <input type="hidden" name="skipped" value={carried} />
              <button type="submit">Continue</button>
            </form>
            {/* The only question with no skip — ADR 0032 §2. Said here rather
                than left to be discovered by looking for a button. */}
            <p className="muted small">This is the one thing we need.</p>
          </div>
        </>
      ) : null}

      {step === 'body' ? (
        <>
          <h2 className="section">A few numbers, so the coach can talk about food</h2>
          <div className="card">
            <form action={saveBiometrics} className="welcome-form">
              <label>
                <span className="label">Bodyweight (kg)</span>
                <input type="text" inputMode="decimal" name="bodyweightKg" defaultValue="" />
              </label>
              <label>
                <span className="label">Height (cm)</span>
                <input type="text" inputMode="decimal" name="heightCm" defaultValue="" />
              </label>
              <label>
                <span className="label">Date of birth</span>
                <input type="date" name="birthDate" defaultValue="" />
              </label>
              <label>
                <span className="label">Sex</span>
                <select name="sex" defaultValue="">
                  <option value="">Prefer not to say</option>
                  {SEXES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="skipped" value={carried} />
              <button type="submit">Continue</button>
            </form>
            <SkipButton step="body" carried={carried} />
          </div>
        </>
      ) : null}

      {step === 'goal' ? (
        <>
          <h2 className="section">What are you training towards?</h2>
          <div className="card">
            <form action={saveGoal} className="welcome-form">
              <label>
                <span className="label">Diet goal</span>
                <select name="goal" defaultValue="maintain">
                  {DIET_GOALS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="skipped" value={carried} />
              <button type="submit">Continue</button>
            </form>
            <SkipButton step="goal" carried={carried} />
          </div>
        </>
      ) : null}

      {step === 'equipment' ? (
        <>
          <h2 className="section">What can you train with?</h2>
          <div className="card settings-body">
            {/* ADR 0029's picker, reused rather than rebuilt. It saves in place;
                Continue re-reads and moves on, because the step is answered by
                the ROWS rather than by a submission. */}
            <EquipmentForm tags={tags} owned={owned} />
          </div>
          <div className="card welcome-form">
            <form action={skipStep}>
              <input type="hidden" name="step" value="equipment" />
              <input type="hidden" name="skipped" value={carried} />
              <button type="submit" className="secondary">
                Continue
              </button>
            </form>
            <p className="muted small">{SKIP_COST.equipment}</p>
          </div>
        </>
      ) : null}

      {step === 'plan' ? (
        <>
          <h2 className="section">Shall the coach write you a plan?</h2>
          <div className="card">
            {/*
             * 8b's questionnaire and 8b's action, unchanged. Last on purpose:
             * it is the only step that spends money, and it must be a press
             * rather than the side effect of finishing a form — ADR 0032 §2.
             */}
            <PlanRequestForm />
          </div>
          <div className="card welcome-form">
            <form action={finishOnboarding}>
              <button type="submit" className="secondary">
                Skip for now
              </button>
            </form>
            <p className="muted small">{SKIP_COST.plan}</p>
          </div>
        </>
      ) : null}
    </>
  );
}

/** The skip control and the sentence saying what it costs — ADR 0032 §2. */
function SkipButton({ step, carried }: { step: Exclude<OnboardingStep, 'name'>; carried: string }) {
  return (
    <form action={skipStep} className="welcome-skip">
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="skipped" value={carried} />
      <button type="submit" className="secondary">
        Skip this
      </button>
      {/* Explained rather than blocked: the sentence names the refusal the app
          will give, which is a state it already renders honestly. */}
      <p className="muted small">{SKIP_COST[step]}</p>
    </form>
  );
}
