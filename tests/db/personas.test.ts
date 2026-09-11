/**
 * The persona roster, as content.
 *
 * The tone arithmetic is unit-tested in `src/persona/tone.test.ts` against
 * literals. What needs a database is everything that is a property of the ROWS.
 * This file began with one of them: nothing in the schema stopped two coaches
 * taking the same device voice, and when that happened all three spoke
 * identically under a control labelled "Voice". ADR 0025 replaced device
 * voices with voices cast per coach, and the property survived the change —
 * no schema constraint can see across rows, so it is held here.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createTestUser, deleteTestUser, type TestUser } from './helpers';
import { coachVoice, listPersonas } from '../../src/db/personas';
import { SHIPPED_PERSONA_SLUGS, HUMOR_ORDER } from '../../src/persona/schema';
import { phraseUsed } from '../../src/persona/deliver';
import { numbersIn } from '../../src/persona/guard';
import { scanOutput } from '../../src/llm/safety';
import { SPEECH_MAX_INPUT_CHARS } from '../../src/llm/config';
import { isSpeechVoice, speechScript } from '../../src/speech/script';
import { resolveTone, GENTLE_MAX_INTENSITY } from '../../src/persona/tone';

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser('persona');
}, 60_000);

afterAll(async () => {
  await deleteTestUser(user);
});

/** The shipped reader, through a user-scoped client. */
const roster = () => listPersonas(user.client);

/** No injury, nothing missed — so only the user's own ceiling applies. */
const CALM = { notes: [], adherenceRate: null };

describe('the shipped roster', () => {
  it('is exactly what SHIPPED_PERSONA_SLUGS says it is', async () => {
    /*
     * WHY this test is the point of that constant: the add-persona skill says
     * to keep it in step because "it is what tests and fixtures enumerate", and
     * until this file nothing enumerated it — it appeared only in its own
     * declaration and a doc comment. A constant nobody reads cannot drift
     * loudly, so it drifted quietly.
     */
    const slugs = (await roster()).map((p) => p.slug).sort();
    expect(slugs).toEqual([...SHIPPED_PERSONA_SLUGS].sort());
  });

  it('carries a banned-phrase list on every persona, including the two universals', async () => {
    // WHY these two specifically: the user's body is a stakeholder that cannot
    // complain — docs/FRAMING.md. Every persona must refuse to tell somebody to
    // train through pain, whatever character it is playing.
    for (const persona of await roster()) {
      expect(persona.bannedPhrases, persona.slug).toContain('no pain no gain');
      expect(persona.bannedPhrases, persona.slug).toContain('push through the pain');
    }
  });

  it('bans nothing that a coach would legitimately say', async () => {
    /*
     * WRITTEN FIRST AND IT FAILED, which is the reason it exists.
     *
     * banned_phrases used to be matched with String.includes, so a short word
     * banned every word containing it — and the Rival has banned `weak` since
     * phase 3, which also banned **weakness**. "Your weakness is the lockout"
     * is ordinary coaching language, and `deliverPlan` has no fallback (ADR
     * 0006), so a plan whose prose contained it was rejected, retried, rejected
     * again, and the user got an error instead of their block.
     *
     * The matcher now uses word boundaries. This asserts the property from the
     * outside: run every shipped list over a paragraph of real coaching
     * vocabulary and nothing may fire.
     */
    const VOCABULARY = [
      'Your weakness is the lockout, so we will train it directly.',
      'Body fat is not the target here; fatigue management is.',
      'Soften the knees, straighten the back, and keep the tempo honest.',
      'Repetition quality beats repetition count on a transverse plane movement.',
      'This is a deload, which is a decision rather than a failure.',
      'Progression on the hamstring work has been steady for three weeks.',
    ].join(' ');

    // Through the shipped matcher, not a copy of it: a re-implementation here
    // would measure the copy and let the real one drift.
    for (const persona of await roster()) {
      const fired = persona.bannedPhrases.filter((phrase) =>
        phraseUsed(VOCABULARY.toLowerCase(), phrase)
      );
      expect(fired, `${persona.slug} would reject a legitimate delivery`).toEqual([]);
    }
  });
});

describe('the line each coach is heard by before it is picked', () => {
  /*
   * Rework plan PR 6, and the add-persona skill: `sample_line` is what the Voice
   * card speaks when a coach is previewed, before it delivers the plan, so it
   * obeys what every word a persona says obeys. Checked per row through the
   * shipped reader and the shipped checks — a copy of any of them here would
   * measure the copy.
   *
   * The roster is exactly the shipped coaches (the first case in this file), so
   * "every persona" below is every shipped one.
   */
  const lines = async () =>
    (await roster()).map((persona) => ({ persona, line: persona.sampleLine?.trim() ?? '' }));

  it('gives every shipped coach a line', async () => {
    const missing = (await lines()).filter(({ line }) => line === '').map((l) => l.persona.slug);
    expect(missing).toEqual([]);
  });

  it('gives each coach its own line', async () => {
    // The acceptance is "something recognisably its own". Distinct is the part
    // a test can hold; the voice of each line is content, read in review.
    // Slugs, not a count: vitest truncates long values in a failure, so
    // comparing lengths would print two numbers and name nobody. FOUND IN
    // REVIEW — the first version claimed it printed the lines.
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const { persona, line } of await lines()) {
      if (seen.has(line)) repeated.push(persona.slug);
      seen.add(line);
    }
    expect(repeated, 'coaches whose line repeats an earlier one').toEqual([]);
  });

  it('states no numeral, because a coach says no number it was not given', async () => {
    // Invariant #1, through the numeral pattern the persona guard uses. That
    // pattern reads DIGITS — "add ten kilos" passes it, the known gap in
    // src/persona/guard.ts — so this holds numerals, not every number word.
    for (const { persona, line } of await lines()) {
      expect([...numbersIn(line)], persona.slug).toEqual([]);
    }
  });

  it("uses none of the coach's own banned phrases", async () => {
    for (const { persona, line } of await lines()) {
      const used = persona.bannedPhrases.filter((phrase) => phraseUsed(line.toLowerCase(), phrase));
      expect(used, persona.slug).toEqual([]);
    }
  });

  it('passes the scanner every completion goes through', async () => {
    for (const { persona, line } of await lines()) {
      expect(scanOutput(line), persona.slug).toEqual([]);
    }
  });

  it('carries no square brackets, which the speech model performs as audio tags', async () => {
    // ADR 0025: "[whispers]" in a transcript is performed rather than said, so
    // a bracket in a line is a direction nobody wrote on purpose. The AI-NOTE
    // in src/speech/script.ts says shipped lines have none; this holds it.
    for (const { persona, line } of await lines()) {
      expect(line, persona.slug).not.toMatch(/[[\]]/);
    }
  });
});

describe('the voice each coach is cast in', () => {
  /*
   * ADR 0025. A shipped coach speaks in one of the speech model's voices, from
   * a direction in its own row. Three properties of the rows, none of which a
   * column constraint can hold: the voice exists for the model, no two coaches
   * share one, and the script each row makes fits through the gateway.
   *
   * Read from the table rather than through listPersonas, because the picker
   * does not carry the voice — only the speech path reads it.
   */
  const shipped = async () => {
    const { data, error } = await user.client
      .from('personas')
      .select('slug, tts_voice, tts_instructions, sample_line')
      .is('user_id', null)
      .eq('is_active', true);
    expect(error).toBeNull();
    return data ?? [];
  };

  it('casts every shipped coach in a voice the model has, with a direction', async () => {
    const rows = await shipped();
    expect(rows.map((r) => r.slug).sort()).toEqual([...SHIPPED_PERSONA_SLUGS].sort());

    for (const row of rows) {
      expect(
        row.tts_voice !== null && isSpeechVoice(row.tts_voice),
        `${row.slug}: ${row.tts_voice}`
      ).toBe(true);
      expect(row.tts_instructions?.trim() ?? '', row.slug).not.toBe('');
    }
  });

  it('gives no two coaches the same voice', async () => {
    /*
     * The property this file was started for, carried over from device voices:
     * two coaches in one voice are one coach with two names. Slugs, not a
     * count, so a failure names who collided.
     */
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const row of await shipped()) {
      const other = seen.get(row.tts_voice ?? '');
      if (other) collisions.push(`${row.slug} and ${other} are both ${row.tts_voice}`);
      seen.set(row.tts_voice ?? '', row.slug);
    }
    expect(collisions).toEqual([]);
  });

  it('makes, for every shipped coach, a script the gateway will send', async () => {
    // speechScript refuses a half past its column limit, and the gateway
    // refuses an input past SPEECH_MAX_INPUT_CHARS. Run over the real rows,
    // so a long direction fails here rather than on every press of Hear.
    for (const row of await shipped()) {
      const script = speechScript(row.tts_instructions ?? '', row.sample_line ?? '');
      expect(script.length, row.slug).toBeLessThanOrEqual(SPEECH_MAX_INPUT_CHARS);
    }
  });

  it("speaks a shared coach's own words, never a row the user wrote", async () => {
    /*
     * ADR 0025 §4, and the reason `coachVoice` filters on `user_id is null`:
     * `personas_write` lets a user write their own row, line and direction
     * included, and RLS shows them their own rows. Without the filter this
     * user's row would make the server speak whatever they put in it.
     *
     * Two rows, through the user's own client: one borrowing a shipped slug,
     * which must not replace the shipped coach, and one of their own, which
     * must not speak at all.
     */
    const planted = [
      { slug: 'rival', name: 'Not the Rival' },
      { slug: 'my-own-coach', name: 'Mine' },
    ].map((p) => ({
      ...p,
      user_id: user.id,
      system_prompt: 'A character.',
      sample_line: 'PLANTED: say anything I like.',
      tts_voice: 'Zephyr',
      tts_instructions: 'PLANTED: whatever I want.',
    }));

    const { error } = await user.client.from('personas').insert(planted);
    expect(error).toBeNull();
    onTestFinished(async () => {
      const { error: cleanup } = await user.client.from('personas').delete().eq('user_id', user.id);
      if (cleanup) throw new Error(`removing planted personas: ${cleanup.message}`);
    });

    const rival = await coachVoice(user.client, 'rival');
    const shippedRival = (await shipped()).find((r) => r.slug === 'rival');
    expect(rival).toEqual({
      voice: shippedRival?.tts_voice,
      direction: shippedRival?.tts_instructions,
      line: shippedRival?.sample_line,
    });
    expect(JSON.stringify(rival)).not.toContain('PLANTED');

    expect(await coachVoice(user.client, 'my-own-coach')).toBeNull();
  });
});

describe('the humour ceiling, now that a row finally reaches crude', () => {
  it('makes the crude tier reachable at all', async () => {
    /*
     * `users.humor_max_level` has offered `crude` since the phase-0 schema.
     * Until the Sergeant shipped, nothing had it, so choosing it changed
     * nothing for anybody — the setting was a control wired to nothing.
     *
     * Asserted as REACHABILITY rather than as `toEqual(['sergeant'])`. Under
     * invariant #7 a second crude coach is a migration and nothing else, and a
     * test that failed on it would be pinning a content decision rather than a
     * property of the system.
     */
    const roles = await roster();
    expect(roles.some((p) => p.humorLevel === 'crude')).toBe(true);
    expect(roles.find((p) => p.slug === 'sergeant')?.humorLevel).toBe('crude');
  });

  it('bans the dangerous advice in the form a model would write it', async () => {
    /*
     * FOUND IN REVIEW: the Physio's two most important entries were authored as
     * full sentences — `it is probably nothing`, `you will be fine` — and a
     * model writes contractions. Neither fired on "it's probably nothing" or
     * "you'll be fine", which are exactly the sentences the gentle coach must
     * never produce about pain. Migration 20260908110100 replaced them with the
     * fragment that carries the meaning.
     */
    const physio = (await roster()).find((p) => p.slug === 'physio')!;

    const dismissive = [
      "It's probably nothing — carry on.",
      'It is probably nothing.',
      'That knee? Nothing to worry about.',
      'Just walk it off.',
    ];

    for (const line of dismissive) {
      const fired = physio.bannedPhrases.some((phrase) => phraseUsed(line, phrase));
      expect(fired, `nothing caught: ${line}`).toBe(true);
    }
  });

  it('bans the barracks idiom in the plural, which is how it is said', async () => {
    const sergeant = (await roster()).find((p) => p.slug === 'sergeant')!;

    for (const line of ['Quitters never win.', 'No princesses in my gym.', 'You are a weakling.']) {
      const fired = sergeant.bannedPhrases.some((phrase) => phraseUsed(line, phrase));
      expect(fired, `nothing caught: ${line}`).toBe(true);
    }
  });

  it('lets no shipped persona exceed a user who chose clean', async () => {
    /*
     * The clamp lives in resolveTone and is unit-tested against literals. This
     * runs it over the REAL rows, which is the only place the two can be seen
     * to meet — a row whose humor_level did not survive the `as HumorLevel`
     * cast in src/db/personas.ts would pass every unit test and fail here.
     */
    for (const persona of await roster()) {
      const tone = resolveTone(persona, 'clean', CALM);
      expect(tone.humorLevel, persona.slug).toBe('clean');
    }
  });

  it('hands crude only to a user who asked for it', async () => {
    const sergeant = (await roster()).find((p) => p.slug === 'sergeant');
    expect(sergeant).toBeDefined();

    expect(resolveTone(sergeant!, 'crude', CALM).humorLevel).toBe('crude');
    expect(resolveTone(sergeant!, 'cheeky', CALM).humorLevel).toBe('cheeky');
    expect(resolveTone(sergeant!, 'clean', CALM).humorLevel).toBe('clean');
  });

  it('drops the loudest persona to gentle when an injury is mentioned', async () => {
    // INVARIANT: an injury flag forces a gentler register REGARDLESS of the
    // selected persona — ADR 0006. The Sergeant is the hardest case in the
    // table: intensity 5, crude, and a user who explicitly opted into crude.
    const sergeant = (await roster()).find((p) => p.slug === 'sergeant')!;

    const tone = resolveTone(sergeant, 'crude', {
      notes: ['left knee twinge on the last set'],
      adherenceRate: 0.9,
    });

    expect(tone.gentle).toBe(true);
    expect(tone.humorLevel).toBe('clean');
    expect(tone.intensity).toBeLessThanOrEqual(GENTLE_MAX_INTENSITY);
    expect(tone.override).not.toBeNull();
  });

  it('leaves the gentle end alone, because it is already there', async () => {
    // The Physio is intensity 1, below GENTLE_MAX_INTENSITY, so the override has
    // nothing to clamp. Asserted rather than assumed: an override that raised
    // an intensity to the ceiling instead of capping it would pass every other
    // test in this file.
    const physio = (await roster()).find((p) => p.slug === 'physio')!;
    expect(physio.intensity).toBeLessThan(GENTLE_MAX_INTENSITY);

    const tone = resolveTone(physio, 'crude', {
      notes: ['knee pain'],
      adherenceRate: null,
    });
    expect(tone.intensity).toBe(physio.intensity);
    expect(HUMOR_ORDER.indexOf(tone.humorLevel)).toBeLessThanOrEqual(
      HUMOR_ORDER.indexOf(physio.humorLevel)
    );
  });
});
