import { describe, expect, it } from 'vitest';
import { SEXES } from '../diet/biometrics';
import { SEX_LABEL } from './sex';

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
