/**
 * The persona roster, as content.
 *
 * The tone arithmetic is unit-tested in `src/persona/tone.test.ts` against
 * literals. What needs a database is everything that is a property of the ROWS,
 * and one of those properties is the reason this file exists at all: nothing in
 * the schema stops two personas of the same language taking the same device
 * voice, and when that happened all three coaches spoke identically under a
 * control labelled "Voice".
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, deleteTestUser, type TestUser } from './helpers';
import { listPersonas } from '../../src/db/personas';
import { SHIPPED_PERSONA_SLUGS, HUMOR_ORDER } from '../../src/persona/schema';
import { phraseUsed } from '../../src/persona/deliver';
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

  it('gives no two personas of one language the same voice variant', async () => {
    /*
     * INVARIANT: two personas sharing a tts_voice_id must not share a variant —
     * .claude/skills/add-persona/SKILL.md §2.
     *
     * Nothing in the schema enforces it: the column defaults to 0 and no
     * constraint can span rows. This is the enforcement, and the bug it stops
     * already happened once — before the variant was a column, voices were
     * picked by language alone, both en-GB personas resolved to the same voice
     * object, and on a device with no en-GB voice installed the en-US one fell
     * back to it too. All three coaches spoke identically.
     *
     * Read from the table rather than through listPersonas, because the reader
     * does not return the language and this assertion is about the pair.
     */
    const { data, error } = await user.client
      .from('personas')
      .select('slug, tts_voice_id, tts_voice_variant')
      .eq('is_active', true);

    expect(error).toBeNull();

    const pairs = (data ?? []).map((p) => `${p.tts_voice_id}:${p.tts_voice_variant}`);
    expect(pairs).toHaveLength(new Set(pairs).size);
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
