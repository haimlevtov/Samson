/**
 * Which tab lights up.
 *
 * WHY this is worth a test: the failure is silent and looks like nothing. A
 * route the tab bar does not recognise lights NO tab, so the user is somewhere
 * in the app and the navigation says they are nowhere — and nothing throws,
 * nothing logs, and it renders perfectly.
 */
import { describe, expect, it } from 'vitest';
import { OWNED_BY, isCurrent } from './tabs';

const TAB_HREFS = ['/history', '/coach', '/hub', '/workout', '/profile'];

/** The one tab lit for a path, or null when the bar would light nothing. */
function litTab(pathname: string): string | null {
  const lit = TAB_HREFS.filter((href) => isCurrent(pathname, href));
  if (lit.length > 1) throw new Error(`${pathname} lit ${lit.length} tabs: ${lit.join(', ')}`);
  return lit[0] ?? null;
}

describe('isCurrent — a tab and its own pages', () => {
  it('lights the tab you are on', () => {
    for (const href of TAB_HREFS) expect(litTab(href)).toBe(href);
  });

  it('lights the parent tab for a page underneath it', () => {
    expect(litTab('/history/abc-123')).toBe('/history');
    expect(litTab('/history/exercise/xyz')).toBe('/history');
    expect(litTab('/workout/new')).toBe('/workout');
  });

  it('does not light a tab for a path that merely starts with its name', () => {
    // "/workouts" is not under "/workout" — the slash is what makes it a child.
    expect(litTab('/workouts')).toBeNull();
    expect(litTab('/profile-settings')).toBeNull();
  });
});

describe('isCurrent — routes a tab owns without containing', () => {
  it('lights Profile on /settings', () => {
    // ADR 0013's amendment. Without OWNED_BY this lights nothing, which is the
    // failure isCurrent exists to prevent, arriving through a route that is
    // simply not nested rather than one that is unknown.
    expect(litTab('/settings')).toBe('/profile');
  });

  it('lights the owner for a page under an owned route too', () => {
    expect(litTab('/settings/anything')).toBe('/profile');
  });

  it('never lights two tabs at once', () => {
    // litTab throws on a tie. This is the assertion that an owned route did not
    // also match its own prefix somewhere.
    for (const path of ['/settings', '/profile', '/history/1', '/workout/new']) {
      expect(() => litTab(path)).not.toThrow();
    }
  });
});

describe('OWNED_BY', () => {
  it('maps every owned route to a real tab', () => {
    // A typo here is invisible: the route would light nothing, exactly as if
    // the entry were missing.
    for (const [route, owner] of Object.entries(OWNED_BY)) {
      expect(TAB_HREFS, `${route} is owned by ${owner}, which is not a tab`).toContain(owner);
    }
  });

  it('owns no route that is already under a tab', () => {
    // Such an entry would be dead weight, and would disagree with the prefix
    // rule the moment somebody edited one of them.
    for (const route of Object.keys(OWNED_BY)) {
      const nested = TAB_HREFS.some((href) => route.startsWith(`${href}/`));
      expect(nested, `${route} already lives under a tab`).toBe(false);
    }
  });
});
