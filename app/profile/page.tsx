import { redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadXpSummary } from '@/src/db/gamification';
import { displayDate } from '@/src/ui/format';
import { signOut } from '../sign-in/actions';
import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';

/**
 * Every timezone this runtime can resolve.
 *
 * WHY the whole list rather than a curated dozen: a curated list is a list of
 * the places the author thought of, and being absent from it means your streak
 * breaks at the wrong hour with no way to fix it. `Intl` already knows them.
 */
function knownTimezones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported('timeZone') : [];
  return zones.length > 0 ? zones : ['UTC'];
}

/**
 * Profile — ADR 0012.
 *
 * The first screen where a `users` column can be changed. Three of them are
 * here because all three change what the app does: the name every header
 * greets you by, the timezone every local date is computed in (CLAUDE.md #9),
 * and the ceiling on how rude a persona may be (ADR 0006).
 *
 * `unit_preference` is deliberately not offered. The column exists, but nothing
 * in the app converts anything — every screen is in kilograms — and a control
 * that changes no number on any screen is a lie. It arrives with the
 * conversion, not before it.
 */
export default async function ProfilePage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const today = localDateFor(user.timezone);
  const [history, xp] = await Promise.all([loadHistory(db), loadXpSummary(db, today)]);

  const first = history.workouts[0];
  const completed = history.workouts.filter((w) => w.status === 'completed').length;

  const zones = knownTimezones();
  // A stored zone this runtime does not list would otherwise vanish from the
  // select and be silently replaced on the next save.
  const timezones = zones.includes(user.timezone) ? zones : [user.timezone, ...zones];

  return (
    <>
      <header className="top">
        <div>
          <h1>{user.displayName ?? 'Your profile'}</h1>
          <span className="muted small">{user.email}</span>
        </div>
      </header>

      <div className="grid cols-2">
        <div className="stat">
          <div className="label">Sessions</div>
          <div className="value">{completed}</div>
          <div className="muted small">completed</div>
        </div>
        <div className="stat">
          <div className="label">Lifetime XP</div>
          <div className="value">{xp.lifetime.toLocaleString()}</div>
          <div className="muted small">
            {first ? `since ${displayDate(first.localDate)}` : 'nothing logged yet'}
          </div>
        </div>
      </div>

      <h2 className="section">Settings</h2>
      <div className="card">
        <SettingsForm
          displayName={user.displayName ?? ''}
          timezone={user.timezone}
          humorMaxLevel={user.humorMaxLevel}
          theme={user.theme}
          timezones={timezones}
        />
      </div>

      <h2 className="section">Units</h2>
      <p className="card muted small">
        Everything is shown in kilograms, and stored that way — CLAUDE.md #8. An imperial toggle
        lands when display conversion does; until then it would be a switch that changes no number
        on any screen.
      </p>

      <h2 className="section">Account</h2>
      <div className="card">
        <form action={signOut}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
