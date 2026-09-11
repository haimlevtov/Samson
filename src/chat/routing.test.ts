/**
 * Routing — the case class rework PR 8a added. ADR 0015 §6,
 * docs/specs/coach-chat.md §6.
 *
 * Its own file rather than more of `reply.test.ts`, which is already the
 * adversarial suite and long: that file asks "what can an attacker make the box
 * say", this one asks "when the model names a route, does the guard belonging to
 * that route run".
 *
 * EVERY CASE HERE ASSERTS A GUARD, NEVER A CLASSIFICATION. Whether the model
 * routes a question the way a person would is a judgement, recorded in ADR 0015
 * as a mitigation and not a control. What must hold is that some guard always
 * runs, and that it is the one the named route owns.
 *
 * No key, no network, no database: the model is a scripted function.
 */
import { describe, expect, it } from 'vitest';
import type { CallOptions, LlmResult } from '../llm/types';
import type { EvidenceRow } from '../db/evidence';
import type { DietFacts } from '../diet/energy';
import { NO_MATCH } from '../diet/schema';
import type { CoachFacts } from './facts';
import {
  MAX_CHAT_ATTEMPTS,
  NO_SUPPLEMENT_MATCH_REPLY,
  OFF_TOPIC_REPLIES,
  UNEXPLAINED_DIET_REPLY,
  UNVERIFIED_NUMBER_REPLY,
  askCoach,
} from './reply';
import type { CoachReply } from './schema';

const FACTS: CoachFacts = {
  as_of: '2026-09-09',
  sessions_last_7_days: 2,
  sessions_last_28_days: 3,
  adherence_28d_percent: 75,
  current_streak_days: 3,
  days_since_last_session: 0,
  tonnage_this_week_kg: 900,
  tonnage_last_week_kg: 475,
  acwr: 1.12,
  acwr_band: 'sweet-spot',
  level: 2,
  lifetime_xp: 400,
  xp_to_next_level: 275,
  top_lifts: [{ name: 'Barbell Full Squat', heaviest_kg: 100, on_date: '2026-09-08' }],
};

/** Categories, never figures — ADR 0024 §1. What the diet route answers from. */
const DIET: DietFacts = {
  goal: 'cut',
  activity_band: 'light',
  is_deficit: true,
  floor_reached: false,
};

/**
 * Two rows, so "a row that exists" and "the closest row" are different things.
 *
 * Cast because these tests need only the fields the allowlist and the assertions
 * read; the row's full shape is `EvidenceRow`'s and is exercised where it is
 * rendered.
 */
const EVIDENCE = [
  {
    slug: 'creatine',
    supplement: 'Creatine monohydrate',
    claim: 'Increases strength output over weeks of training.',
    grade: 'A',
    dose: '5 g daily',
    caution: null,
    citation_doi: '10.1000/creatine',
  },
  {
    slug: 'bcaa',
    supplement: 'BCAAs',
    claim: 'Does not add to a diet already adequate in protein.',
    grade: 'D',
    dose: null,
    caution: null,
    citation_doi: '10.1000/bcaa',
  },
] as unknown as EvidenceRow[];

interface Harness {
  call: <T>(o: CallOptions<T>) => Promise<LlmResult<T>>;
  captured: CallOptions<unknown>[];
}

/** A model that returns exactly what the test scripts, in order. */
function harness(script: CoachReply[]): Harness {
  const captured: CallOptions<unknown>[] = [];
  let next = 0;
  return {
    captured,
    call: async <T>(options: CallOptions<T>): Promise<LlmResult<T>> => {
      captured.push(options as CallOptions<unknown>);
      const response = script[next++];
      if (response === undefined) throw new Error(`script exhausted at call ${next}`);
      return {
        data: response as T,
        modelUsed: 'stub',
        attempts: 1,
        costCredits: 0.0001,
        ledger: [],
      };
    },
  };
}

const ask = (
  h: Harness,
  message: string,
  over: { diet?: DietFacts | null; evidence?: readonly EvidenceRow[] } = {}
) =>
  askCoach(
    'u1',
    {
      facts: FACTS,
      history: [],
      message,
      diet: over.diet === undefined ? DIET : over.diet,
      evidence: over.evidence ?? EVIDENCE,
    },
    { call: h.call }
  );

/*
 * Every route carries `supplement_slug`, because the schema requires it on all
 * four — a nullable field would give the model a second way to return nothing.
 */
const training = (reply: string): CoachReply => ({
  route: 'training',
  reply,
  supplement_slug: NO_MATCH,
});
const offTopic = (reply: string): CoachReply => ({
  route: 'off_topic',
  reply,
  supplement_slug: NO_MATCH,
});
const diet = (reply: string): CoachReply => ({ route: 'diet', reply, supplement_slug: NO_MATCH });
const supplement = (slug: string, reply = 'ignored on this route'): CoachReply => ({
  route: 'supplement',
  reply,
  supplement_slug: slug,
});

describe('each route returns its own shape', () => {
  it('answers a training question with prose checked against the facts', async () => {
    const answer = await ask(harness([training('900 kg this week. Solid.')]), 'how is my volume?');

    expect(answer.route).toBe('training');
    expect(answer.text).toContain('900');
    expect(answer.row).toBeNull();
    expect(answer.substituted).toBe(false);
  });

  it('answers a diet question with prose containing no numeral at all', async () => {
    const answer = await ask(
      harness([diet('You are a little under what you burn, which is the point of a cut.')]),
      'why is my target low?'
    );

    expect(answer.route).toBe('diet');
    expect(answer.text).not.toMatch(/\p{N}/u);
    expect(answer.substituted).toBe(false);
  });

  it('answers a supplement question with the ROW, never the model’s prose', async () => {
    const answer = await ask(
      harness([supplement('creatine', 'Creatine is great, take 10 g, trust me.')]),
      'does creatine work?'
    );

    expect(answer.route).toBe('supplement');
    /*
     * INVARIANT: the answer is the row — ADR 0023. The model wrote a dose and a
     *            recommendation, and neither reaches the caller: there is no
     *            paraphrase to soften a D-graded row, and no unguarded numeral.
     */
    expect(answer.text).toBeNull();
    expect(answer.row?.slug).toBe('creatine');
    // The object is the one from the array the allowlist was built from, never
    // one refetched by a model-supplied string.
    expect(answer.row).toBe(EVIDENCE[0]);
  });

  it('renders the code-owned miss for the sentinel, not a row', async () => {
    const answer = await ask(harness([supplement(NO_MATCH)]), 'what about tongkat ali?');

    expect(answer.route).toBe('supplement');
    expect(answer.row).toBeNull();
    expect(answer.text).toBe(NO_SUPPLEMENT_MATCH_REPLY);
    expect(answer.substituted).toBe(true);
  });

  it('substitutes a constant for an off-topic question, whatever the model wrote', async () => {
    const answer = await ask(harness([offTopic('Here are some stock picks:')]), 'which stocks?');

    expect(answer.route).toBe('off_topic');
    expect(OFF_TOPIC_REPLIES).toContain(answer.text);
    expect(answer.text).not.toContain('stock');
  });
});

describe('the diet route’s allowed set is empty', () => {
  it('rejects any numeral, retries, and falls to the code-owned reply', async () => {
    const answer = await ask(
      harness([diet('Aim for 1800 kcal.'), diet('Still around 1800.')]),
      'how much should I eat?'
    );

    expect(answer.text).toBe(UNEXPLAINED_DIET_REPLY);
    expect(answer.substituted).toBe(true);
    expect(answer.attempts).toBe(MAX_CHAT_ATTEMPTS);
    // The figure the app computed renders on the surface regardless, so the
    // constant loses the sentence rather than the answer.
    expect(answer.text).not.toContain('1800');
  });

  it('rejects a non-ASCII digit, which the training route’s guard cannot see', async () => {
    /*
     * The review that found this on the stage this replaced:
     * `findUnknownNumbers` matches `\d` — ASCII only, even under `u` — and
     * `Number('١٨٠٠')` is NaN, so a widened match would be discarded anyway.
     * `\p{N}` is why this route has its own check rather than an empty
     * membership set, and this case is why that distinction is load-bearing.
     */
    const answer = await ask(
      harness([diet('حوالي ١٨٠٠ سعرة.'), diet('١٨٠٠ مرة أخرى.')]),
      'كم سعرة؟'
    );

    expect(answer.text).toBe(UNEXPLAINED_DIET_REPLY);
    expect(answer.substituted).toBe(true);
  });

  it('accepts a diet answer written entirely in words', async () => {
    const answer = await ask(
      harness([diet('A modest deficit, a little under what you burn on a training week.')]),
      'why that number?'
    );

    expect(answer.substituted).toBe(false);
    expect(answer.text).toContain('modest deficit');
  });
});

describe('a retry that changes route is checked by the NEW route’s guard', () => {
  it('checks a diet→training retry against the facts, not against the empty set', async () => {
    /*
     * The first attempt is rejected for a numeral on the diet route; the second
     * comes back as training and quotes 900, which IS in the facts. Carrying the
     * first attempt's guard forward would reject it — and rejecting a training
     * answer for quoting the facts is the guard refusing what it exists to
     * permit.
     */
    const answer = await ask(
      harness([diet('Around 1800 kcal.'), training('900 kg this week, so eat for it.')]),
      'how much should I eat for this training?'
    );

    expect(answer.route).toBe('training');
    expect(answer.text).toContain('900');
    expect(answer.substituted).toBe(false);
    expect(answer.attempts).toBe(2);
  });

  it('checks a training→diet retry against the EMPTY set, so a fact figure is refused', async () => {
    /*
     * THE DANGEROUS DIRECTION, and the reason the guard is chosen per attempt
     * rather than once. 900 is in the facts, so the training guard admits it. If
     * the model changes its mind and answers as diet, that same figure must be
     * refused — otherwise "call it training first" is a way out of ADR 0024's
     * empty allowed set, which is the one guard in this stage with no members.
     */
    const answer = await ask(
      harness([training('Your 4242 is up.'), diet('You moved 900 kg, so eat above maintenance.')]),
      'should I eat more?'
    );

    expect(answer.route).toBe('diet');
    expect(answer.text).toBe(UNEXPLAINED_DIET_REPLY);
    expect(answer.substituted).toBe(true);
  });

  it('falls to the training constant when the LAST attempt was training', async () => {
    const answer = await ask(
      harness([diet('About 1800.'), training('Your 4242 is looking good.')]),
      'how am I doing?'
    );

    expect(answer.route).toBe('training');
    expect(answer.text).toBe(UNVERIFIED_NUMBER_REPLY);
  });
});

describe('the allowlist is the schema', () => {
  it('builds the enum from the rows supplied, and admits only those and the sentinel', async () => {
    const h = harness([supplement('bcaa')]);
    await ask(h, 'do BCAAs do anything?');

    // The schema is what refuses an invented slug, inside the gateway, before
    // any code in reply.ts runs — ADR 0023 kept through the merge into one box.
    const schema = h.captured[0]?.schema;
    const parse = (slug: string) =>
      schema?.safeParse({ route: 'supplement', reply: 'x', supplement_slug: slug }).success;

    expect(parse('bcaa')).toBe(true);
    expect(parse('creatine')).toBe(true);
    expect(parse(NO_MATCH)).toBe(true);
    expect(parse('tongkat-ali')).toBe(false);
  });

  it('treats the sentinel as the sentinel even when a ROW carries that slug', async () => {
    /*
     * FOUND BY MUTATION TESTING: removing the `slug === NO_MATCH` short-circuit
     * changed nothing the suite could see, because the lookup misses on a slug
     * no row carries and falls to the same constant. It stops being equivalent
     * the moment a row's slug IS the sentinel — then "the table does not cover
     * that" would silently render that row as the answer.
     *
     * Unlikely, and not impossible: the slugs come from a migration, nothing
     * forbids the string, and the failure would be a health claim shown in
     * answer to a question it does not answer.
     */
    const shadow = [{ ...EVIDENCE[0], slug: NO_MATCH }] as unknown as EvidenceRow[];
    const answer = await ask(harness([supplement(NO_MATCH)]), 'anything at all?', {
      evidence: shadow,
    });

    expect(answer.row).toBeNull();
    expect(answer.text).toBe(NO_SUPPLEMENT_MATCH_REPLY);
  });

  it('answers with the constant when the table has no rows at all', async () => {
    const answer = await ask(harness([supplement(NO_MATCH)]), 'creatine?', { evidence: [] });

    expect(answer.row).toBeNull();
    expect(answer.text).toBe(NO_SUPPLEMENT_MATCH_REPLY);
  });

  it('falls closed to the constant when the schema and the row array disagree', async () => {
    /*
     * Unreachable through the schema, which is the point: if a future change let
     * a slug through that no row carries, the answer is the constant rather than
     * a throw or a silently null row rendered as an answer.
     */
    const answer = await ask(harness([supplement('creatine')]), 'creatine?', {
      evidence: [EVIDENCE[1]!],
    });

    expect(answer.row).toBeNull();
    expect(answer.text).toBe(NO_SUPPLEMENT_MATCH_REPLY);
    expect(answer.substituted).toBe(true);
  });
});

describe('the payload carries every route’s context, every time', () => {
  it('sends the diet categories and the candidate rows with a training question', async () => {
    const h = harness([training('Legs today.')]);
    await ask(h, 'what should I train?');

    const rendered = (h.captured[0]?.messages ?? []).map((m) => m.content).join('\n');
    // Both are prepared before the call because a route is not known until the
    // answer comes back — ADR 0015 §6. This is what buys the single call.
    expect(rendered).toContain('floor_reached');
    expect(rendered).toContain('creatine');
  });

  it('omits the diet block when the engine could not produce a target', async () => {
    const h = harness([training('Legs today.')]);
    await ask(h, 'what should I train?', { diet: null });

    const rendered = (h.captured[0]?.messages ?? []).map((m) => m.content).join('\n');
    expect(rendered).not.toContain('floor_reached');
    // One missing context is not the other: the rows are still there.
    expect(rendered).toContain('creatine');
  });

  it('makes neither block quotable on the training route', async () => {
    /*
     * The candidate rows are catalogue text somebody else wrote, and a dose
     * inside a claim ("5 g daily") is not a figure about this user's training.
     * Admitting them to `allowed` would let the coach quote a supplement dose as
     * though the metrics engine had produced it — the same reasoning that keeps
     * exercise names out of the set.
     */
    const answer = await ask(
      harness([training('Take 5 g and your squat is fine.'), training('Your squat is fine.')]),
      'how is my squat?'
    );

    expect(answer.text).toBe('Your squat is fine.');
    expect(answer.attempts).toBe(2);
  });
});
