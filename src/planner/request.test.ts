/**
 * What a plan request may be — ADR 0027, rework PR 8b.
 *
 * The four questions are the only user input on the path to a planner run, so
 * this is the file that has to be strict. Pure: no key, no network, no database.
 */
import { describe, expect, it } from 'vitest';
import { WEB_PLAN_MAX_BLOCK_WEEKS } from '../llm/config';
import {
  GOAL_LABEL,
  JOINT_LABEL,
  PLAN_DAYS_PER_WEEK,
  REPORTABLE_JOINTS,
  planRequestFrom,
  planRequestSchema,
} from './request';
import { JOINT_LOADING } from './rules';
import { trainingGoalSchema } from './schema';

const valid = {
  goal: 'strength',
  days_per_week: 3,
  block_weeks: 4,
  injured_joints: [],
};

/** A FormData-shaped stand-in, so the reader is testable without a request. */
const form = (entries: [string, string][]) => ({
  get: (name: string) => entries.find(([k]) => k === name)?.[1],
  getAll: (name: string) => entries.filter(([k]) => k === name).map(([, v]) => v),
});

describe('the joint vocabulary', () => {
  it('offers exactly the joints the rules can act on', () => {
    /*
     * INVARIANT: derived from `JOINT_LOADING`, never listed twice. `loadsJoint`
     *            returns false for a joint it does not recognise — deliberately,
     *            so a stray profile value cannot fail every plan a user gets —
     *            which means an extra entry here would silently protect nothing,
     *            and a missing one would hide a real injury from the rules.
     */
    expect([...REPORTABLE_JOINTS].sort()).toEqual(Object.keys(JOINT_LOADING).sort());
  });

  it('has a label for every joint, so no control renders a raw slug', () => {
    for (const joint of REPORTABLE_JOINTS) {
      expect(JOINT_LABEL[joint], joint).toBeTruthy();
    }
    // And no label for a joint that does not exist, which would be a control
    // offering something the rules ignore.
    expect(Object.keys(JOINT_LABEL).sort()).toEqual([...REPORTABLE_JOINTS].sort());
  });

  it('offers exactly the days the schema accepts', () => {
    /*
     * The fourth derivation test. FOUND IN REVIEW: the form listed its day
     * options by hand while the goals, the weeks and the joints were all derived,
     * so the control and the schema could drift apart silently.
     */
    for (const days of PLAN_DAYS_PER_WEEK) {
      expect(
        planRequestSchema.safeParse({ ...valid, days_per_week: days }).success,
        String(days)
      ).toBe(true);
    }

    const days = [...PLAN_DAYS_PER_WEEK];
    const below = Math.min(...days) - 1;
    const above = Math.max(...days) + 1;
    expect(planRequestSchema.safeParse({ ...valid, days_per_week: below }).success).toBe(false);
    expect(planRequestSchema.safeParse({ ...valid, days_per_week: above }).success).toBe(false);
  });

  it('has a label for every goal the schema admits', () => {
    for (const goal of trainingGoalSchema.options) {
      expect(GOAL_LABEL[goal], goal).toBeTruthy();
    }
    expect(Object.keys(GOAL_LABEL).sort()).toEqual([...trainingGoalSchema.options].sort());
  });
});

describe('planRequestSchema', () => {
  it('accepts a well-formed request', () => {
    expect(planRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a block longer than the web maximum', () => {
    /*
     * The bound that matters — ADR 0027 §3. The planner input schema admits 12
     * and the block schema admits 8; this surface must not ask for either,
     * because generation time is what the deadline is spent on.
     */
    expect(planRequestSchema.safeParse({ ...valid, block_weeks: 8 }).success).toBe(false);
    expect(planRequestSchema.safeParse({ ...valid, block_weeks: 12 }).success).toBe(false);
    expect(
      planRequestSchema.safeParse({ ...valid, block_weeks: WEB_PLAN_MAX_BLOCK_WEEKS }).success
    ).toBe(true);
  });

  it('refuses one day a week and seven days a week', () => {
    // One day is not a block; seven leaves no rest day, which the rules reject
    // anyway. Both are inside the planner schema's own 1–7.
    expect(planRequestSchema.safeParse({ ...valid, days_per_week: 1 }).success).toBe(false);
    expect(planRequestSchema.safeParse({ ...valid, days_per_week: 7 }).success).toBe(false);
  });

  it('refuses a goal outside the enum', () => {
    expect(planRequestSchema.safeParse({ ...valid, goal: 'powerlifting' }).success).toBe(false);
  });

  it('refuses a joint the rules would ignore', () => {
    // The important negative: a free-text joint passes `loadsJoint` as false, so
    // accepting one here would produce a plan that loads an injury while looking
    // like it honoured the answer.
    expect(planRequestSchema.safeParse({ ...valid, injured_joints: ['neck'] }).success).toBe(false);
  });

  it('refuses a field the form did not have', () => {
    /*
     * strictObject, for a DIRECT caller. FOUND IN REVIEW: this said "a crafted
     * POST cannot smuggle a fifth answer past it", and a POST never reaches this
     * schema with a fifth key — `planRequestFrom` reads exactly four named
     * fields, and that allowlist is what stops the POST. Both are worth having;
     * they stop different things.
     */
    expect(planRequestSchema.safeParse({ ...valid, candidate_limit: 900 }).success).toBe(false);
  });

  it('deduplicates joints, because a form can send one twice', () => {
    const parsed = planRequestSchema.safeParse({
      ...valid,
      injured_joints: ['knee', 'knee', 'hip'],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.injured_joints).toEqual(['knee', 'hip']);
  });
});

describe('planRequestFrom', () => {
  it('reads the four answers out of form entries', () => {
    const parsed = planRequestFrom(
      form([
        ['goal', 'hypertrophy'],
        ['days_per_week', '4'],
        ['block_weeks', '3'],
        ['injured_joints', 'knee'],
        ['injured_joints', 'shoulder'],
      ])
    );

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      goal: 'hypertrophy',
      days_per_week: 4,
      block_weeks: 3,
      injured_joints: ['knee', 'shoulder'],
    });
  });

  it('reads the numbers from strings, because that is what a select sends', () => {
    const parsed = planRequestFrom(
      form([
        ['goal', 'strength'],
        ['days_per_week', '2'],
        ['block_weeks', '1'],
      ])
    );
    expect(parsed.data?.days_per_week).toBe(2);
    expect(parsed.data?.block_weeks).toBe(1);
  });

  it('treats no checkboxes as no injuries rather than as one empty joint', () => {
    const parsed = planRequestFrom(
      form([
        ['goal', 'strength'],
        ['days_per_week', '3'],
        ['block_weeks', '4'],
        ['injured_joints', ''],
      ])
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data?.injured_joints).toEqual([]);
  });

  it('fails rather than defaulting when an answer is missing', () => {
    // A default here would silently plan something nobody asked for.
    expect(planRequestFrom(form([['goal', 'strength']])).success).toBe(false);
  });

  it('fails on a non-numeric day count rather than coercing it to NaN', () => {
    const parsed = planRequestFrom(
      form([
        ['goal', 'strength'],
        ['days_per_week', 'lots'],
        ['block_weeks', '4'],
      ])
    );
    expect(parsed.success).toBe(false);
  });
});
