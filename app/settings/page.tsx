import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { equipmentCatalogue } from '@/src/db/equipment';
import { loadNotes } from '@/src/db/notes';
import { userEquipment } from '@/src/db/exercises';
import { EquipmentForm } from './EquipmentForm';
import { SettingsForm } from './SettingsForm';
import { SignOutButton } from './SignOutButton';
import { forgetCoachNote } from './actions';

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

  const [tags, owned, notes] = await Promise.all([
    equipmentCatalogue(db),
    userEquipment(db, user.id),
    loadNotes(db),
  ]);

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
          leaderboardOptOut={user.leaderboardOptOut}
          theme={user.theme}
          timezones={timezones}
          bodyweightKg={user.bodyweightKg}
          heightCm={user.heightCm}
          birthDate={user.birthDate}
          sex={user.sex}
          // INVARIANT: the user's local date, never the server's — CLAUDE.md #9.
          maxBirthDate={localDateFor(user.timezone)}
        />

        <p className="muted small">
          Everything is shown in kilograms, and stored that way. An imperial toggle lands when
          display conversion does; until then it would be a switch that changes no number on any
          screen — which is why the bodyweight and height above are asked for in metric rather than
          following a preference nothing reads.
        </p>
      </div>

      {/*
       * Equipment — ADR 0029. Its own card and its own form, because it saves
       * to a different table and because the rest of this page is one `users`
       * row while this is a set of rows.
       *
       * WHY it belongs on Settings at all: equipment is filtered in SQL before
       * the planner sees anything (invariant #5), so it is a fact about the
       * user rather than a planner input — which is what the rework plan said
       * when it declined to put it in the plan questionnaire.
       */}
      <h2 className="section">Equipment</h2>
      <div className="card settings-body">
        <EquipmentForm tags={tags} owned={owned} />
      </div>

      {/*
       * What the coach remembers — ADR 0030 §4.
       *
       * WHY it is here and not on Coach: a list you audit and prune is a thing
       * you manage about yourself, which is what this route is for (ADR 0013's
       * amendment), and the Coach tab is where you talk to it rather than where
       * you administer it. It sits after Equipment because both are "facts about
       * me the app acts on", and before Account because Account is the
       * irreversible corner.
       *
       * A bare `<form action>` per note: no client state, no confirmation step.
       * Deleting one note is not destructive in the way signing out is — it is
       * one sentence, the coach simply stops being told it, and nothing else in
       * the app reads these rows.
       */}
      <h2 className="section">What the coach remembers</h2>
      {notes.length === 0 ? (
        // Every state renders something — docs/specs/mobile-interface.md §4.
        // And this is the honest normal state for most users: the coach keeps
        // very little, which is the point.
        <p className="card muted">
          Nothing yet. When you tell the coach something about yourself — a sore shoulder, a lift
          you want to bring up — it may keep a short note here.
        </p>
      ) : (
        <div className="card">
          <ul className="note-list">
            {notes.map((note) => (
              <li key={note.id}>
                <span>{note.text}</span>
                <form action={forgetCoachNote}>
                  <input type="hidden" name="noteId" value={note.id} />
                  <button type="submit" className="secondary">
                    Forget
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <p className="muted small">
            The coach keeps at most twenty of these, newest first, and never a number. Forgetting
            one removes it for good.
          </p>
        </div>
      )}

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
