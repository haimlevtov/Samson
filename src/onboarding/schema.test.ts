/**
 * Onboarding's biometrics step — ADR 0032 §2.
 *
 * This file exists because `readBodyForm` is a second reader of the four fields
 * `readSettingsForm` already reads, and that function's own header says why the
 * pair needs pinning: *"a field present in the schema and absent here is
 * permanently `undefined`, which fails EVERY save … and typecheck cannot see it.
 * This is the class, not the instance."* The copy reproduced the hazard; this is
 * the guard that came with it.
 */
import { describe, expect, it } from 'vitest';
import {
  BIRTH_DATE_FIELDS,
  BIRTH_MONTH_OPTIONS,
  EARLIEST_BIRTH_YEAR,
  birthYears,
  composeBirthDate,
  isCompleteBody,
  namesARealDate,
  onboardingBodySchema,
  readBirthDateParts,
  readBodyForm,
} from './schema';

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
};

/**
 * A whole form, as the step posts it.
 *
 * The date is THREE FIELDS since rework PR 9 — `readBodyForm` composes them, so
 * a fixture posting `birthDate` would be exercising a control that no longer
 * exists.
 */
const COMPLETE = {
  bodyweightKg: '82.5',
  heightCm: '178',
  birthDay: '2',
  birthMonth: '4',
  birthYear: '1995',
  sex: 'male',
};

describe('readBodyForm and the schema agree', () => {
  it('reads every field the schema declares, in both directions', () => {
    /*
     * The assertion `settings-schema.test.ts` makes for its own pair, and for
     * the same reason: a field in one and not the other is invisible to the
     * compiler and fails every save at runtime.
     */
    const read = Object.keys(readBodyForm(form(COMPLETE))).sort();
    const declared = Object.keys(onboardingBodySchema.shape).sort();
    expect(read).toEqual(declared);
  });

  it('accepts a complete submission', () => {
    const parsed = onboardingBodySchema.safeParse(readBodyForm(form(COMPLETE)));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.bodyweightKg).toBe(82.5);
    expect(parsed.success && parsed.data.sex).toBe('male');
  });
});

describe('absent is not blank', () => {
  it('rejects a submission that OMITS a field rather than clearing it', () => {
    /*
     * The bug `readSettingsForm` records: these four treat blank as "clear
     * this", so a POST that simply leaves one out used to be indistinguishable
     * from one clearing it — and a request carrying only some fields **erased a
     * health profile** while reporting success. `undefined` must fail.
     *
     * FOR EVERY FIELD, not just the first — FOUND IN REVIEW of rework PR 9. This
     * omitted only the bodyweight, so when the date became three selects and its
     * reader started coalescing a missing field to `''`, omitting the date parsed
     * as a deliberate clear and nothing went red. `settings-schema.test.ts` has
     * always looped; this now does too.
     */
    const DATE = ['birthDay', 'birthMonth', 'birthYear'];
    const fields = Object.keys(COMPLETE).filter((key) => !DATE.includes(key));

    for (const omitted of fields) {
      const rest = Object.fromEntries(Object.entries(COMPLETE).filter(([key]) => key !== omitted));
      expect(onboardingBodySchema.safeParse(readBodyForm(form(rest))).success, omitted).toBe(false);
    }

    // The date is ONE answer posted as three fields, so it is absent when all
    // three are — the only way a hand-written request can omit it.
    const noDate = Object.fromEntries(
      Object.entries(COMPLETE).filter(([key]) => !DATE.includes(key))
    );
    expect(onboardingBodySchema.safeParse(readBodyForm(form(noDate))).success, 'date').toBe(false);
  });

  it('accepts a blank field as a deliberate "no answer"', () => {
    // The other half: the real form always posts all four, and a blank text
    // input posts `''`. Skipping the step is a separate control.
    const parsed = onboardingBodySchema.safeParse(
      readBodyForm(form({ ...COMPLETE, bodyweightKg: '', sex: '' }))
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.bodyweightKg).toBeNull();
    expect(parsed.success && parsed.data.sex).toBeNull();
  });
});

describe('the bounds are the diet engine own', () => {
  it('refuses an implausible measurement', () => {
    // Not re-stated here — `measurementField` owns them. This asserts the
    // composition actually uses it rather than that the number is right.
    const parsed = onboardingBodySchema.safeParse(
      readBodyForm(form({ ...COMPLETE, heightCm: '9000' }))
    );
    expect(parsed.success).toBe(false);
  });

  it('refuses a measurement that is not a number at all', () => {
    // `<input type="text">` with `inputMode="decimal"` is what the step uses, so
    // unparseable text really can arrive — which is the whole reason ADR 0029
    // moved off `type="number"`, whose blanking hid this case.
    const parsed = onboardingBodySchema.safeParse(
      readBodyForm(form({ ...COMPLETE, bodyweightKg: '80 kg' }))
    );
    expect(parsed.success).toBe(false);
  });

  it('refuses an unrecognised sex rather than falling back', () => {
    const parsed = onboardingBodySchema.safeParse(
      readBodyForm(form({ ...COMPLETE, sex: 'banana' }))
    );
    expect(parsed.success).toBe(false);
  });

  it('rejects a field the form did not declare', () => {
    // strictObject: nothing rides along into an upsert.
    const parsed = onboardingBodySchema.safeParse({
      ...readBodyForm(form(COMPLETE)),
      admin: 'yes',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('isCompleteBody', () => {
  /** What the schema makes of a form, which is what the action branches on. */
  const parse = (entries: Record<string, string>) => {
    const parsed = onboardingBodySchema.safeParse(readBodyForm(form(entries)));
    if (!parsed.success) throw new Error('fixture did not parse');
    return parsed.data;
  };

  it('accepts all four', () => {
    expect(isCompleteBody(parse(COMPLETE))).toBe(true);
  });

  it('refuses three, which is the case that used to loop in silence', () => {
    /*
     * THE BUG THIS EXISTS FOR. Every field is nullable, so three answers parse
     * cleanly and the upsert succeeds — and `hasBiometrics` wants all four, so
     * `/welcome` re-renders the same step with empty boxes and no message. The
     * user's own answers leave the screen with nothing to explain why.
     */
    for (const missing of Object.keys(COMPLETE)) {
      const partial = { ...COMPLETE };
      // Blank, not absent: a blank text input posts '' and the schema reads
      // that as "clear this", which is exactly what the form sends.
      partial[missing as keyof typeof COMPLETE] = '';
      expect(isCompleteBody(parse(partial)), missing).toBe(false);
    }
  });

  it('refuses an empty form', () => {
    expect(
      isCompleteBody(
        parse({
          bodyweightKg: '',
          heightCm: '',
          birthDay: '',
          birthMonth: '',
          birthYear: '',
          sex: '',
        })
      )
    ).toBe(false);
  });
});

describe('composeBirthDate', () => {
  const parts = (day: string, month: string, year: string) => ({ day, month, year });

  it('joins three selects into the ISO date the schema validates', () => {
    expect(composeBirthDate(parts('2', '4', '1995')).iso).toBe('1995-04-02');
  });

  it('zero-pads, because the shape is load-bearing', () => {
    // `isRealDate` requires the ISO shape and `ageOn` slices fixed offsets out
    // of the string, so an unpadded date silently reads the wrong year.
    expect(composeBirthDate(parts('9', '9', '2001')).iso).toBe('2001-09-09');
  });

  it('takes a year ending in zero, which is what was reported', () => {
    /*
     * The owner could not set 1990 or 2000 in the native date input. That was
     * never reproduced here and this does not claim to explain it — what it
     * pins is that nothing in this project refuses those years, end to end,
     * through the real reader and the real schema.
     */
    for (const year of ['1990', '2000', '2010', '1900']) {
      const { iso } = composeBirthDate(parts('1', '1', year));
      expect(iso, year).toBe(`${year}-01-01`);

      const posted = form({ ...COMPLETE, birthDay: '1', birthMonth: '1', birthYear: year });
      const parsed = onboardingBodySchema.safeParse(readBodyForm(posted));
      expect(parsed.success, year).toBe(true);
      expect(parsed.success && parsed.data.birthDate, year).toBe(`${year}-01-01`);
    }
  });

  it('reads all three blank as not answered, not as a broken date', () => {
    expect(composeBirthDate(parts('', '', ''))).toEqual({ iso: '', partial: false });
  });

  it('reports a partial date rather than silently discarding it', () => {
    /*
     * THE STATE A SINGLE INPUT COULD NOT PRODUCE. Two selects answered is
     * neither a date nor a blank, and treating it as blank would throw away
     * answers the user gave and then ask the whole step again with nothing in
     * it — the silent loop PR 8 spent a section closing.
     */
    expect(composeBirthDate(parts('2', '4', '')).partial).toBe(true);
    expect(composeBirthDate(parts('', '4', '1995')).partial).toBe(true);
    expect(composeBirthDate(parts('2', '', '')).partial).toBe(true);
  });

  it('composes an impossible date rather than deciding about it here', () => {
    // 31 February composes; `isRealDate` refuses it, with a message that already
    // exists. One definition of a real date, not two.
    const { iso } = composeBirthDate(parts('31', '2', '1995'));
    expect(iso).toBe('1995-02-31');
    expect(
      onboardingBodySchema.safeParse({ ...readBodyForm(form(COMPLETE)), birthDate: iso }).success
    ).toBe(false);
  });
});

describe('birthYears', () => {
  it('stops at the local year, because the save refuses a future date', () => {
    const years = birthYears('2026-09-12');
    expect(years[0]).toBe(2026);
    expect(years).not.toContain(2027);
  });

  it('runs back to the earliest the bounds admit', () => {
    const years = birthYears('2026-09-12');
    expect(years.at(-1)).toBe(EARLIEST_BIRTH_YEAR);
    expect(EARLIEST_BIRTH_YEAR).toBe(1900);
  });

  it('is newest first, because a birth year is nearly always recent-ish', () => {
    const years = birthYears('2026-09-12');
    expect(years[0]).toBeGreaterThan(years[1]!);
  });
});

describe('namesARealDate', () => {
  const parts = (day: string, month: string, year: string) => ({ day, month, year });

  it('refuses a day the month does not have', () => {
    /*
     * FOUND IN REVIEW. A list of 1–31 reaches states the browser's date widget
     * could not — it clamps the day to the month. 31 February composed, then
     * failed the schema as "that did not look right" under four controls of
     * which three were fine, and pressing Continue again reproduced it exactly.
     */
    expect(namesARealDate(parts('31', '2', '1995'))).toBe(false);
    expect(namesARealDate(parts('31', '9', '1995'))).toBe(false);
    expect(namesARealDate(parts('29', '2', '1995'))).toBe(false);
  });

  it('accepts the leap day in a leap year', () => {
    expect(namesARealDate(parts('29', '2', '2000'))).toBe(true);
  });

  it('has no opinion on partial or blank dates, which have their own sentences', () => {
    expect(namesARealDate(parts('31', '2', ''))).toBe(true);
    expect(namesARealDate(parts('', '', ''))).toBe(true);
    expect(namesARealDate({})).toBe(true);
  });
});

describe('BIRTH_MONTH_OPTIONS', () => {
  it('pairs every month with the number the composer reads', () => {
    /*
     * FOUND IN REVIEW: the control derived each month's value from its position
     * in a list of names, so reordering the list would have silently produced
     * wrong birth dates. Value and label are one record now, and this pins them.
     */
    expect(BIRTH_MONTH_OPTIONS).toHaveLength(12);
    BIRTH_MONTH_OPTIONS.forEach((month, index) => {
      expect(month.value, month.label).toBe(String(index + 1));
    });
    expect(BIRTH_MONTH_OPTIONS[1]).toEqual({ value: '2', label: 'February' });
    expect(BIRTH_MONTH_OPTIONS[11]).toEqual({ value: '12', label: 'December' });
  });

  it('round-trips through the composer', () => {
    for (const month of BIRTH_MONTH_OPTIONS) {
      const { iso } = composeBirthDate({ day: '1', month: month.value, year: '1995' });
      expect(iso, month.label).toBe(`1995-${month.value.padStart(2, '0')}-01`);
    }
  });
});

describe('BIRTH_DATE_FIELDS', () => {
  it('names the fields the reader actually reads', () => {
    // Spelled once and used by both the control and the reader. A rename that
    // reached one and not the other would post a blank date with nothing failing.
    const posted = form({
      [BIRTH_DATE_FIELDS.day]: '2',
      [BIRTH_DATE_FIELDS.month]: '4',
      [BIRTH_DATE_FIELDS.year]: '1995',
    });
    expect(composeBirthDate(readBirthDateParts(posted)).iso).toBe('1995-04-02');
  });
});
