import { redirect } from 'next/navigation';
import { createServerDb } from '@/src/db/server';
import { DEMO_ACCOUNT_EMAIL, DEMO_FIXTURE_PASSWORD } from '@/src/db/demo-reset';
import { resetDemoAccount, signIn } from './actions';

export const dynamic = 'force-dynamic';

/**
 * WHY the seeded accounts are listed on the page: this is a demo build for a
 * class project, and the accounts are fixtures with a published password in the
 * repo. Making them one click away is the difference between a demo that runs
 * and one that stalls on a forgotten address.
 * AI-NOTE: if this ever serves real users, delete this list rather than hiding
 *          it behind an env flag — the fixtures should not exist in that build.
 */
const FIXTURES = [
  { email: 'beginner@samson.test', label: 'Noa — beginner, clean linear progression' },
  { email: 'plateaued@samson.test', label: 'Dan — plateaued for six weeks' },
  { email: 'returning@samson.test', label: 'Maya — returning after a five-week layoff' },
  { email: 'homegym@samson.test', label: 'Yossi — dumbbells capped at 30 kg' },
  { email: 'inconsistent@samson.test', label: 'Tom — makes about half his sessions' },
  // Last, and described as what it is: the other five are furnished, and this
  // is the one that shows what a real first visit looks like — ADR 0032.
  { email: DEMO_ACCOUNT_EMAIL, label: 'Nobody yet — the empty account a new user meets' },
];

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (user) redirect('/hub');

  const { error } = await searchParams;

  return (
    <>
      <header className="top">
        <h1>Samson</h1>
        <span className="muted small">Phase 1 — deterministic substrate</span>
      </header>

      <div className="card" style={{ maxWidth: 420 }}>
        <form action={signIn} className="grid">
          <label className="grid" style={{ gap: 4 }}>
            <span className="label">Email</span>
            <input name="email" type="email" required defaultValue="beginner@samson.test" />
          </label>
          <label className="grid" style={{ gap: 4 }}>
            <span className="label">Password</span>
            <input name="password" type="password" required defaultValue={DEMO_FIXTURE_PASSWORD} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Sign in</button>
        </form>
      </div>

      <h2 className="section">Seeded accounts</h2>
      <p className="muted small" style={{ marginTop: -8 }}>
        All use the password <code>{DEMO_FIXTURE_PASSWORD}</code>. Run{' '}
        <code>npm run migrate &amp;&amp; npm run seed</code> if they are missing.
      </p>
      <div className="card">
        <table>
          <tbody>
            {FIXTURES.map((f) => (
              <tr key={f.email}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <code>{f.email}</code>
                </td>
                <td className="muted small">{f.label}</td>
                <td>
                  {/*
                   * The demo reset — ADR 0032 §4, as amended twice, and this is
                   * where the owner asked for it: one button beside the account
                   * it belongs to, no explanation and no confirmation.
                   *
                   * It signs in and resets in one press and lands on /welcome,
                   * so pressing it IS starting the demo. The two earlier homes
                   * were both behind a session, and Hub's could not be reached
                   * by this account at all — it is redirected to /welcome for
                   * having a null `onboarded_at`, which is the whole fixture.
                   *
                   * Not a gate. `reset_demo_account()` refuses any caller whose
                   * `raw_app_meta_data` is not marked, and a signed-in user
                   * cannot write that column.
                   */}
                  {f.email === DEMO_ACCOUNT_EMAIL ? (
                    <form action={resetDemoAccount}>
                      <button type="submit" className="secondary">
                        Reset
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
