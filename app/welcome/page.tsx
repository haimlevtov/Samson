import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { equipmentCatalogue } from '@/src/db/equipment';
import { userEquipment } from '@/src/db/exercises';
import { latestAcceptedPlan, listPersonas } from '@/src/db/personas';
import { hasApiKey } from '@/src/llm/config';
import {
  ONBOARDING_STEPS,
  SKIP_COST,
  nextStep,
  progressFor,
  type OnboardingStep,
} from '@/src/onboarding/steps';
import { EquipmentForm } from '../settings/EquipmentForm';
import { PlanRequestForm } from '../coach/PlanRequestForm';
import { finishOnboarding, skipStep } from './actions';
import { BodyStep, CoachStep, GoalStep, NameStep } from './Steps';

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
  // `finish` is the stamp failure's rendered owner — see finishOnboarding.
  searchParams: Promise<{ skip?: string; finish?: string }>;
}) {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const { skip, finish } = await searchParams;

  const [tags, owned, plan, personas] = await Promise.all([
    equipmentCatalogue(db),
    userEquipment(db, user.id),
    latestAcceptedPlan(db),
    listPersonas(db),
  ]);

  /*
   * Three fields of each row, not the row. `systemPrompt` is the character
   * description ADR 0006 fences into a message, and a client component has no
   * use for it — so it does not cross into one.
   */
  const coaches = personas.map((persona) => ({
    slug: persona.slug,
    name: persona.name,
    sampleLine: persona.sampleLine,
    bio: persona.bio,
    voiced: persona.voiced,
  }));

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
    personaSlug: user.personaSlug,
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

  /*
   * The stamp failed — FOUND IN REVIEW, and it is checked BEFORE the branch
   * below because that branch is what made it a loop. `/welcome` calls
   * `finishOnboarding` during render when every question is answered, so a
   * failing write sent the user to `/hub`, which sent them back here, which
   * called it again: ERR_TOO_MANY_REDIRECTS, a blank page, and no message.
   *
   * A rendered state with a live retry instead. The user's answers are all
   * still there; the only thing missing is the stamp.
   */
  if (finish === 'failed') {
    return (
      <>
        <header className="welcome-head">
          <h1>Welcome to Samson</h1>
        </header>
        <div className="card">
          <p className="error" role="status">
            Could not finish setting you up.
          </p>
          <p className="muted small">
            Nothing you answered was lost. This is the last step — press it again.
          </p>
          <form action={finishOnboarding} className="welcome-form">
            <button type="submit">Try again</button>
          </form>
        </div>
      </>
    );
  }

  // Nothing left to ask. `finishOnboarding` stamps the flow and redirects, so
  // it never returns — arriving here with everything answered is the same thing
  // as pressing the last button.
  if (step === null) {
    await finishOnboarding();
    redirect('/hub');
  }

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

      {step === 'name' ? (
        <>
          <h2 className="section">What should the coach call you?</h2>
          <div className="card">
            <NameStep carried={carried} />
          </div>
        </>
      ) : null}

      {step === 'coach' ? (
        <>
          <h2 className="section">Who do you want in your corner?</h2>
          <div className="card">
            {/*
             * A coach with no rows to offer would be a step with no answer, and
             * the flow would stick on it — `isAnswered` wants a slug. The
             * personas are shared content seeded by a migration, so an empty
             * list means the catalogue is missing rather than that the user has
             * nothing; either way the honest move is to say so and let them past.
             */}
            {coaches.length === 0 ? (
              <p className="muted">
                No coaches are available just now. You can pick one later on the Coach tab.
              </p>
            ) : (
              <CoachStep coaches={coaches} voiceAvailable={hasApiKey()} carried={carried} />
            )}
            <SkipButton step="coach" carried={carried} />
          </div>
        </>
      ) : null}

      {step === 'body' ? (
        <>
          <h2 className="section">A few numbers, so the coach can talk about food</h2>
          <div className="card">
            <BodyStep carried={carried} />
            <SkipButton step="body" carried={carried} />
          </div>
        </>
      ) : null}

      {step === 'goal' ? (
        <>
          <h2 className="section">What are you training towards?</h2>
          <div className="card">
            <GoalStep carried={carried} />
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
            {/* Only while there is nothing saved — `steps.ts`'s INVARIANT is
                that every SKIP_COST string describes a state the app really
                renders, and it does not render this one for somebody who just
                ticked five tags above. */}
            {owned.length === 0 ? <p className="muted small">{SKIP_COST.equipment}</p> : null}
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
