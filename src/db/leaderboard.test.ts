/**
 * What `src/db/leaderboard.ts` does to a row on its way to the Hub.
 *
 * Two halves. **The display-name clamp** is the one string in the app that ONE
 * user writes and ANOTHER user reads, and every case for it below is a way to
 * vandalise somebody else's screen rather than your own. **The level mapping**
 * is what the board actually prints, and it is derived here rather than in the
 * view — ADR 0016's amendment.
 *
 * The db suite proves who is on the leaderboard and what the boundary exposes;
 * this proves what the loader does with what comes back.
 *
 * No database: `clampDisplayName` is pure and `loadLeaderboard` takes its client
 * as a parameter, so a stub covers it.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { levelForXp } from '../gamification/level';
import { clampDisplayName, loadLeaderboard } from './leaderboard';

/*
 * The hostile characters, built from code points.
 *
 * AI-NOTE: never paste these as literals. A control or zero-width character in
 *          a source file is invisible in every diff that would have to approve
 *          it, and `grep` reports the file as binary and stops printing line
 *          numbers. src/llm/safety.test.ts writes them as `\u` escapes for the
 *          same reason; fromCharCode is the version a copy-paste cannot get
 *          wrong, and it names each one in the code rather than in a comment.
 */
const ch = (code: number): string => String.fromCharCode(code);
const RLO = ch(0x202e); // right-to-left override
const ZWSP = ch(0x200b); // zero-width space
const BOM = ch(0xfeff); // byte-order mark
const SHY = ch(0x00ad); // soft hyphen
const NUL = ch(0x0000); // C0 control

describe('clampDisplayName — characters that attack the reader, not the writer', () => {
  it('strips a bidirectional override', () => {
    // Left in, everything rendered after it on the row reverses — including
    // other people's names, depending on how the browser resolves the run.
    expect(clampDisplayName(`Haim${RLO} reversed`)).toBe('Haim reversed');
  });

  it('strips zero-width characters used to pad a name out of its cell', () => {
    expect(clampDisplayName(`A${ZWSP.repeat(40)}B`)).toBe('AB');
  });

  it('strips the byte-order mark and the soft hyphen', () => {
    expect(clampDisplayName(`${BOM}Ha${SHY}im`)).toBe('Haim');
  });

  it('flattens control characters and newlines to a single space', () => {
    /*
     * A newline in a table cell is a name occupying two rows. It becomes a
     * SPACE rather than nothing — matching how `stripInvisible` treats a
     * control character — because deleting it would glue two words together
     * and quietly change how somebody's name reads.
     */
    expect(clampDisplayName(`Haim${NUL}\nLev`)).toBe('Haim Lev');
  });

  it('collapses a run of whitespace, so padding buys no width', () => {
    expect(clampDisplayName('Haim         Lev')).toBe('Haim Lev');
  });

  it('trims surrounding whitespace', () => {
    expect(clampDisplayName('   Haim   ')).toBe('Haim');
  });
});

describe('clampDisplayName — ordinary names are left alone', () => {
  it('keeps accents, scripts and punctuation', () => {
    // A guard that mangles real names is one somebody turns off.
    for (const name of ['Zoë', 'Ólafur', 'חיים', '大山', "O'Neill", 'Jean-Luc']) {
      expect(clampDisplayName(name)).toBe(name);
    }
  });

  it('keeps an emoji intact', () => {
    expect(clampDisplayName('Haim 🏋')).toBe('Haim 🏋');
  });
});

describe('clampDisplayName — length', () => {
  it('leaves a name at the limit untouched', () => {
    const exact = 'a'.repeat(60);
    expect(clampDisplayName(exact)).toBe(exact);
  });

  it('truncates a longer one and marks it', () => {
    expect(clampDisplayName('a'.repeat(200))).toBe(`${'a'.repeat(60)}…`);
  });

  it('counts code points, not UTF-16 units', () => {
    /*
     * The bug this prevents: `slice()` on a string of astral characters cuts a
     * surrogate pair in half and renders a replacement glyph. 40 two-unit
     * emoji are 80 UTF-16 units and 40 characters, so nothing should be cut.
     */
    const emoji = '🏋'.repeat(40);
    expect(clampDisplayName(emoji)).toBe(emoji);

    // 70 of them is over the limit, and the cut lands on a character boundary.
    const long = clampDisplayName('🏋'.repeat(70));
    expect([...long]).toHaveLength(61); // 60 emoji plus the ellipsis
    expect(long).not.toContain('�');
  });

  it('measures after stripping, so padding cannot force a truncation', () => {
    // Otherwise a name of 60 real characters plus invisible padding would be
    // truncated to 59 and an ellipsis — the author vandalising themselves, but
    // still a wrong answer.
    expect(clampDisplayName(`${'a'.repeat(60)}${ZWSP.repeat(50)}`)).toBe('a'.repeat(60));
  });
});

describe('clampDisplayName — combining marks, which stack vertically', () => {
  const ACUTE = ch(0x0301);

  it('keeps a normal accented name', () => {
    // The case that must not break: one base character, one mark.
    expect(clampDisplayName(`e${ACUTE}quipe`)).toBe(`e${ACUTE}quipe`);
  });

  it('keeps two marks on one base character', () => {
    // Vietnamese vowels and pointed Hebrew genuinely stack two.
    const two = `a${ACUTE}${ch(0x0323)}`;
    expect(clampDisplayName(two)).toBe(two);
  });

  it('drops the rest of a stack, keeping the base character', () => {
    /*
     * The attack: 59 marks on one base is a legal 60-character name that grows
     * one row of the table on EVERY other user's screen. The horizontal axis is
     * defended by .lb-name's overflow; nothing defended this one.
     */
    const attack = `A${ACUTE.repeat(59)}`;
    expect(clampDisplayName(attack)).toBe(`A${ACUTE}${ACUTE}`);
  });

  it('counts the run per base character, not per name', () => {
    // Two accented letters in a row is an ordinary name, not a stack.
    const name = `e${ACUTE}te${ACUTE}`;
    expect(clampDisplayName(name)).toBe(name);
  });
});

describe('clampDisplayName — names that are nothing at all', () => {
  it('returns empty for whitespace the view used to let through', () => {
    // btrim() in Postgres strips ASCII space only, so these reached the page.
    // loadLeaderboard drops a row whose name clamps to empty.
    const NBSP = ch(0x00a0);
    const IDEOGRAPHIC = ch(0x3000);

    for (const blank of [
      String.fromCharCode(9),
      NBSP,
      IDEOGRAPHIC,
      NBSP + String.fromCharCode(9),
      '   ',
    ]) {
      expect(clampDisplayName(blank)).toBe('');
    }
  });

  it('returns empty for a name made only of invisible characters', () => {
    expect(clampDisplayName(ZWSP.repeat(10))).toBe('');
  });
});

/**
 * The level is derived from XP in TypeScript, and this is what fails if anyone
 * moves it into the view.
 *
 * `docs/plans/rework-hub-history-coach.md` PR 2: the request was to rank by
 * level rather than XP, and the finding was that no migration is needed —
 * `levelForXp` is monotonic non-decreasing, so the view's ordering already
 * agrees with a level ordering. What changed is the figure a reader sees.
 */
describe('the leaderboard shows a level, derived from the XP the view returns', () => {
  /**
   * A `Db` that returns the given rows from the view, and nothing else.
   *
   * Only the four columns the loader selects, shaped the way PostgREST returns
   * them, so this exercises the real mapping rather than a paraphrase of it.
   */
  function dbReturning(rows: unknown[]) {
    const asked = { from: '', select: '' };

    /*
     * `as unknown as Db` rather than `as never` — FOUND IN REVIEW. `never` is
     * assignable to everything, so that cast made TypeScript verify nothing at
     * all about the stub, including whether it still resembles the client.
     */
    const db = {
      from: (table: string) => {
        asked.from = table;
        return {
          select: (columns: string) => {
            asked.select = columns;
            return {
              order: () => ({ limit: async () => ({ data: rows, error: null }) }),
            };
          },
        };
      },
    } as unknown as Parameters<typeof loadLeaderboard>[0];

    return { db, asked };
  }

  it('maps each row through levelForXp, and does not carry the XP onward', async () => {
    // Rank ascending, which is the order `loadLeaderboard` asks PostgREST for.
    // The stub cannot sort, so feeding them out of order would read as though
    // the board renders worst-first.
    const { db } = dbReturning([
      { display_name: 'Maya', lifetime_xp: 12_000, rank: 1, is_you: false },
      { display_name: 'Dan', lifetime_xp: 300, rank: 2, is_you: true },
      { display_name: 'Noa', lifetime_xp: 0, rank: 3, is_you: false },
    ]);
    const rows = await loadLeaderboard(db);

    expect(rows.map((r) => r.level)).toEqual([levelForXp(12_000), levelForXp(300), levelForXp(0)]);

    /*
     * And the XP it derived from is NOT carried. FOUND IN REVIEW: the first
     * version returned it with a comment calling it "the tiebreak", which it is
     * not — the tiebreak is computed in Postgres. Nothing rendered it, and it is
     * the field that would serialise every listed user's exact total into the
     * page HTML the day this table becomes sortable.
     */
    for (const row of rows) expect(row).not.toHaveProperty('lifetimeXp');
  });

  it('never returns a level below 1, including for a row with no XP at all', async () => {
    const { db } = dbReturning([
      { display_name: 'Tom', lifetime_xp: null, rank: 9, is_you: false },
    ]);
    const rows = await loadLeaderboard(db);

    expect(rows[0]?.level).toBe(1);
  });

  /*
   * The select list, pinned here as well as in tests/db/leaderboard.test.ts.
   *
   * That file holds the real allowlist and is the one that proves the VIEW
   * exposes nothing more — but it needs Postgres. This asserts the narrower
   * thing a unit test can: that the loader does not start asking for a column
   * the boundary was never reviewed for. The stub used to discard its arguments,
   * so it could not have noticed.
   */
  it('asks the view for four columns and no more', async () => {
    const { db, asked } = dbReturning([]);
    await loadLeaderboard(db);

    expect(asked.from).toBe('leaderboard');
    expect(
      asked.select
        .split(',')
        .map((c) => c.trim())
        .sort()
    ).toEqual(['display_name', 'is_you', 'lifetime_xp', 'rank']);
  });

  /*
   * THE property the no-migration decision rests on. If this ever fails, the
   * view's `order by lifetime_xp desc` no longer produces a level ordering and
   * the board would need to sort in SQL after all.
   */
  it('never puts a lower level above a higher one when ordered by XP', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 2_000_000 }), { minLength: 2, maxLength: 40 }),
        (totals) => {
          const byXpDescending = [...totals].sort((a, b) => b - a);
          const levels = byXpDescending.map(levelForXp);

          return levels.every((level, i) => i === 0 || levels[i - 1]! >= level);
        }
      ),
      { numRuns: 5_000 }
    );
  });

  it('starts at 1, so nobody on the board is level 0', () => {
    for (const xp of [0, 1, 299, 300, 301]) {
      expect(levelForXp(xp), `${xp} XP`).toBeGreaterThanOrEqual(1);
    }
  });

  /*
   * A worked example, so the test file says what the board actually shows
   * rather than only that two functions agree with each other. 300 XP is the
   * first level-up — LEVEL_BASE_XP — and the curve is geometric from there.
   */
  it('reads the way the spec describes the curve', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
  });
});
