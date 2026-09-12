import { describe, expect, it } from 'vitest';
import { openingCoach } from './choice';

const LISTED = ['analyst', 'old-master', 'physio', 'rival', 'sergeant'];

describe('openingCoach', () => {
  it('opens on the coach the user chose', () => {
    expect(openingCoach(LISTED, 'sergeant')).toBe('sergeant');
  });

  it('falls back to the first listed when nobody has chosen', () => {
    // ADR 0031 §5's settle-for, and it is still the right answer for a user
    // who has not been asked yet.
    expect(openingCoach(LISTED, null)).toBe('analyst');
  });

  it('falls back when the stored coach is no longer listed', () => {
    /*
     * THE CASE THIS MODULE EXISTS FOR. `is_active = false` retires a coach
     * without deleting its row, so `users.persona_slug` can name something the
     * picker does not offer — with or without a foreign key, which is the
     * argument for not having one. A select whose value matches no option
     * renders with nothing selected.
     */
    expect(openingCoach(LISTED, 'retired')).toBe('analyst');
  });

  it('gives an empty slug when there are no coaches at all', () => {
    // The catalogue is seeded by a migration, so this means something is wrong
    // rather than that the user has nothing. It must not throw either way.
    expect(openingCoach([], 'sergeant')).toBe('');
    expect(openingCoach([], null)).toBe('');
  });
});
