import { describe, expect, it } from 'vitest';
import { SEXES } from '../diet/biometrics';
import { SEX_LABEL, WELCOME_SEXES } from './sex';

describe('SEX_LABEL', () => {
  it('labels every value the column admits', () => {
    // A missing key renders the bare column value. That is not hypothetical:
    // the welcome step mapped over SEXES with no labels at all and showed the
    // word "unspecified" as though it were a choice somebody might make.
    for (const sex of SEXES) expect(SEX_LABEL[sex], sex).toBeTruthy();
    expect(Object.keys(SEX_LABEL).sort()).toEqual([...SEXES].sort());
  });

  it('does not offer the word the column uses', () => {
    // The point of the map. `unspecified` is a fine value and a terrible label.
    expect(Object.values(SEX_LABEL)).not.toContain('unspecified');
  });
});

describe('WELCOME_SEXES', () => {
  it('offers male and female and nothing else', () => {
    /*
     * THE OWNER'S DECISION, pinned so it cannot drift back. `mifflinStJeor`
     * selects its constant by sex, so a BMR computed from `unspecified` is a
     * figure derived from a value nobody stated — safe, because that value
     * takes the higher constant, and still not an answer.
     *
     * It stays a valid COLUMN value; this is about what onboarding collects.
     */
    expect([...WELCOME_SEXES]).toEqual(['male', 'female']);
    expect(WELCOME_SEXES).not.toContain('unspecified');
  });

  it('labels both of them', () => {
    for (const sex of WELCOME_SEXES) expect(SEX_LABEL[sex], sex).toBeTruthy();
  });
});
