import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { SettingsForm } from './SettingsForm';
import { SignOutButton } from './SignOutButton';

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
 * Settings — ADR 0013, as amended 2026-09-07.
 *
 * These lived in a `<details>` at the bottom of Profile. That was wrong for a
 * reason ADR 0013 had already written down without noticing: it argued Profile
 * would become the longest page in the app, which makes a control at the bottom
 * of it a scroll target rather than a control. Changing a timezone meant
 * scrolling past every badge, chart and diagnostic first.
 *
 * A route rather than a region, so it has an address, the back gesture leaves
 * it, and the cog that opens it sits in a header where nothing has to be
 * scrolled to reach it.
 *
 * Still a server component with no client state — the thing the original
 * decision was protecting, and a route costs none of it.
 *
 * AI-NOTE: this page is not in the tab bar, deliberately. Five tabs is the
 *          budget ADR 0012 set, and settings are visited rarely. The cog on
 *          Profile is therefore the ONLY route in, and deleting that link
 *          orphans this page without breaking a build. tests/unit/
 *          invariants.test.ts asserts every route in OWNED_BY is linked from
 *          somewhere under app/, which is the check that catches it.
 */
export default async function SettingsPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const zones = knownTimezones();
  // A stored zone this runtime does not list would otherwise vanish from the
  // select and be silently replaced on the next save.
  const timezones = zones.includes(user.timezone) ? zones : [user.timezone, ...zones];

  return (
    <>
      <header className="top">
        <div>
          <h1>Settings</h1>
          <span className="muted small">{user.email}</span>
        </div>
        {/* Named for where it goes. This page is reached from Profile and
            returns there; "Back" would be a promise about history rather than
            about a destination. */}
        <Link href="/profile" className="chip">
          Profile
        </Link>
      </header>

      <div className="card settings-body">
        <SettingsForm
          displayName={user.displayName ?? ''}
          timezone={user.timezone}
          humorMaxLevel={user.humorMaxLevel}
          theme={user.theme}
          timezones={timezones}
        />

        <p className="muted small">
          Everything is shown in kilograms, and stored that way. An imperial toggle lands when
          display conversion does; until then it would be a switch that changes no number on any
          screen.
        </p>
      </div>

      {/*
       * Sign out is its own card, away from the form.
       *
       * WHY separated: it was the last control inside the settings disclosure,
       * which put the one irreversible action on the page in the least
       * reachable spot, immediately below a Save button. Two buttons that do
       * very different things should not sit in one group.
       */}
      {/* "Account", not "Session": a session is a workout everywhere else in
          this product — the session screen, the session bar, "during a
          session". */}
      <h2 className="section">Account</h2>
      <div className="card">
        <SignOutButton />
        <p className="muted small">
          Signing out also clears any unfinished session saved on this device.
        </p>
      </div>
    </>
  );
}
