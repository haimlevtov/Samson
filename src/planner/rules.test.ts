/**
 * Tests for `src/planner/rules.ts`, written from `docs/specs/planner-rules.md`
 * alone. The implementation was deliberately not read.
 *
 * WHY the separation: a test derived from the code agrees with the code whether
 * or not either is right. A rule that is confidently, self-consistently wrong
 * passes a suite written from its own source. Everything asserted below is the
 * spec's claim, so a disagreement between spec and implementation fails loudly
 * rather than going quiet. See ADR 0004.
 *
 * AI-NOTE: do not "fix" a failure here by reading rules.ts and matching it.
 *          Decide which of the two is wrong, change that one, and amend the
 *          spec if the answer turns out to be the spec.
 *
 * WHY every case goes through `checkRules` rather than calling the six rules
 * directly: the spec says each rule is "also exported under its own name" but
 * never states those identifiers. A wrong guess collapses the whole file into a
 * single import error instead of one failing assertion. Filtering `checkRules`
 * output by `code` asserts the same thing — a finding from that rule, or none —
 * without betting on a name the contract does not fix.
 */
import { describe, expect, it } from 'vitest';
import { ACWR_HIGH_RISK } from '../metrics/acwr';
import { DELOAD_REQUIRED_BY_WEEK, MAX_WEEKLY_TONNAGE_INCREASE, checkRules } from './rules';
import { trainingBlockSchema } from './schema';
import type { RuleCandidate, RuleCode, RuleContext, RuleFinding } from './rules';
import type { PlannedSession, PrescribedExercise, PrescribedSet, TrainingBlock } from './schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The `RuleCode` union in declaration order — the order `checkRules` returns. */
const RULE_ORDER = [
  'weekly_volume_increase',
  'acwr_band',
  'deload_cadence',
  'equipment_available',
  'load_ceiling',
  'injured_joint',
] as const satisfies readonly RuleCode[];

/**
 * WHY this slug carries every tonnage fixture: its only equipment has a null
 * ceiling, so a week built to weigh a given amount can never also trip
 * `load_ceiling`, and its muscle and pattern miss every joint the volume cases
 * use. A fixture aimed at one rule must not fire another by accident.
 */
const FILLER_SLUG = 'barbell-back-squat';

const CANDIDATES: RuleCandidate[] = [
  {
    slug: FILLER_SLUG,
    name: 'Barbell Back Squat',
    primaryMuscle: 'quadriceps',
    movementPattern: 'squat',
    equipment: [{ slug: 'barbell', maxLoadKg: null }],
  },
  {
    slug: 'dumbbell-bench-press',
    name: 'Dumbbell Bench Press',
    primaryMuscle: 'chest',
    movementPattern: 'push',
    equipment: [{ slug: 'dumbbell', maxLoadKg: 30 }],
  },
  {
    slug: 'goblet-squat',
    name: 'Goblet Squat',
    primaryMuscle: 'glutes',
    movementPattern: 'squat',
    equipment: [{ slug: 'dumbbell', maxLoadKg: 30 }],
  },
  {
    slug: 'barbell-curl',
    name: 'Barbell Curl',
    primaryMuscle: 'biceps',
    movementPattern: null,
    equipment: [
      { slug: 'barbell', maxLoadKg: null },
      { slug: 'ez-bar', maxLoadKg: null },
    ],
  },
  {
    // Two ceilings, deliberately far apart: the lower one has to bind.
    slug: 'landmine-press',
    name: 'Landmine Press',
    primaryMuscle: 'shoulders',
    movementPattern: 'push',
    equipment: [
      { slug: 'barbell', maxLoadKg: 200 },
      { slug: 'dumbbell', maxLoadKg: 30 },
    ],
  },
  {
    slug: 'farmers-carry',
    name: "Farmer's Carry",
    primaryMuscle: 'traps',
    movementPattern: 'carry',
    equipment: [{ slug: 'dumbbell', maxLoadKg: 30 }],
  },
];

const BASELINE_KG = 1000;

/** Tonnage for a week whose fixture does not care what it weighs. */
const NEUTRAL_WEEK_KG = BASELINE_KG;

function context(over: Partial<RuleContext> = {}): RuleContext {
  return {
    candidates: CANDIDATES,
    injuredJoints: [],
    baselineWeeklyTonnageKg: BASELINE_KG,
    // WHY null by default: the spec makes `acwr_band` silent on a null chronic
    // mean, which keeps it out of every fixture aimed at another rule.
    chronicWeeklyTonnageKg: null,
    ...over,
  };
}

function candidate(over: Partial<RuleCandidate> & Pick<RuleCandidate, 'slug'>): RuleCandidate {
  return {
    name: 'Test Movement',
    primaryMuscle: 'chest',
    movementPattern: null,
    // No equipment means no ceiling, keeping `load_ceiling` out of the way of
    // the joint table below.
    equipment: [],
    ...over,
  };
}

function set(weightKg: number | null, reps = 1): PrescribedSet {
  return { set_index: 0, weight_kg: weightKg, reps, rpe: null, rest_seconds: 120 };
}

function exercise(slug: string, sets: PrescribedSet[]): PrescribedExercise {
  return { exercise_slug: slug, sets: sets.map((s, i) => ({ ...s, set_index: i })) };
}

/**
 * Sets on `FILLER_SLUG` whose tonnage sums to exactly `tonnageKg`.
 *
 * WHY whole 500 kg sets plus a single remainder, rather than dividing a target
 * across reps: the schema caps weight at 500 kg and reps at 50, and the boundary
 * cases here (1100 against 1100.1) need the week to weigh the stated figure
 * exactly rather than a float a whisker either side of it. Every term is exact
 * and the remainder is a representable difference by construction.
 */
function fillerSets(tonnageKg: number): PrescribedSet[] {
  if (tonnageKg === 0) return [set(0, 1)];
  const sets: PrescribedSet[] = [];
  let remaining = tonnageKg;
  while (remaining > 500) {
    const reps = Math.min(10, Math.floor(remaining / 500));
    sets.push(set(500, reps));
    remaining -= 500 * reps;
  }
  if (remaining > 0) sets.push(set(remaining, 1));
  if (sets.length > 12) throw new Error(`fixture needs ${sets.length} sets, schema allows 12`);
  return sets;
}

interface WeekSpec {
  /** Defaults to array position + 1. */
  weekNumber?: number;
  isDeload?: boolean;
  /** Prescribed tonnage, delivered as filler sets in their own session. */
  tonnageKg?: number;
  /** Prescribed on top of the filler, in one additional session. */
  exercises?: PrescribedExercise[];
  /** One entry per further session, for cases needing the same slug twice. */
  sessions?: PrescribedExercise[][];
}

type WeekInput = number | WeekSpec;

function session(exercises: PrescribedExercise[], dayIndex: number): PlannedSession {
  return { day_index: dayIndex, focus: 'full body', exercises };
}

function block(weeks: readonly WeekInput[]): TrainingBlock {
  return {
    weeks: weeks.map((input, i) => {
      const spec: WeekSpec = typeof input === 'number' ? { tonnageKg: input } : input;
      const groups: PrescribedExercise[][] = [];
      const unspecified =
        spec.tonnageKg === undefined && spec.exercises === undefined && spec.sessions === undefined;
      if (spec.tonnageKg !== undefined || unspecified) {
        groups.push([exercise(FILLER_SLUG, fillerSets(spec.tonnageKg ?? NEUTRAL_WEEK_KG))]);
      }
      if (spec.exercises !== undefined) groups.push(spec.exercises);
      for (const extra of spec.sessions ?? []) groups.push(extra);
      return {
        week_number: spec.weekNumber ?? i + 1,
        is_deload: spec.isDeload ?? false,
        sessions: groups.map((g, day) => session(g, day)),
      };
    }),
    rationale: 'Fixture block.',
  };
}

/** A one-week block holding a single exercise, weighing next to nothing. */
function blockOf(slug: string, weightKg: number | null = 0, reps = 1): TrainingBlock {
  return block([{ exercises: [exercise(slug, [set(weightKg, reps)])] }]);
}

function findingsFor(
  code: RuleCode,
  plan: TrainingBlock,
  ctx: RuleContext = context()
): RuleFinding[] {
  return checkRules(plan, ctx).filter((f) => f.code === code);
}

function codesOf(findings: readonly RuleFinding[]): RuleCode[] {
  return findings.map((f) => f.code);
}

/**
 * WHY sorted: the spec fixes the order findings come back in *between* rules,
 * not within one. Asserting an intra-rule order would test something the
 * contract never promised.
 */
function weeksOf(findings: readonly RuleFinding[]): (number | null)[] {
  return findings.map((f) => f.weekNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
}

/** The spec fixes what `detail` means, not how it is worded. */
function expectOne(findings: readonly RuleFinding[], weekNumber: number | null): void {
  expect(findings).toHaveLength(1);
  expect(findings[0]!.weekNumber).toBe(weekNumber);
  expect(findings[0]!.detail.trim().length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// The plans the checkRules cases share
// ---------------------------------------------------------------------------

/** Three weeks inside every limit, and short enough to need no deload. */
function cleanPlan(): TrainingBlock {
  return block([1000, 1050, 1100]);
}

/** Volume, cadence and equipment breached; nothing else. */
function threeRuleBreachPlan(): TrainingBlock {
  return block([
    // The unknown slug carries no load, so week 1 still weighs exactly 2000 kg.
    { tonnageKg: 2000, exercises: [exercise('phantom-press', [set(0)])] },
    2000,
    2000,
    2000,
    2000,
  ]);
}

/** Exactly one breach of each of the six rules. */
function everyRuleBreachPlan(): TrainingBlock {
  return block([
    {
      tonnageKg: 2800,
      exercises: [
        // 40 kg over a 30 kg ceiling, on a chest movement, weighing 200 kg —
        // which is what brings week 1 to 3000 kg.
        exercise('dumbbell-bench-press', [set(40, 5)]),
        exercise('phantom-press', [set(0)]),
      ],
    },
    3000,
    3000,
    3000,
    3000,
    3000,
  ]);
}

describe('rule fixtures', () => {
  it('are blocks the planner could actually emit', () => {
    // WHY assert this at all: the danger this module exists to catch is a
    //      well-formed plan, not a malformed one. A fixture that failed schema
    //      validation would be testing an input the planner cannot produce.
    for (const plan of [cleanPlan(), threeRuleBreachPlan(), everyRuleBreachPlan()]) {
      expect(() => trainingBlockSchema.parse(plan)).not.toThrow();
    }
  });
});

describe('rule constants', () => {
  it('hold the values the contract publishes', () => {
    expect(MAX_WEEKLY_TONNAGE_INCREASE).toBe(0.1);
    expect(DELOAD_REQUIRED_BY_WEEK).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 1. weekly_volume_increase
// ---------------------------------------------------------------------------

describe('weekly_volume_increase', () => {
  const code = 'weekly_volume_increase';

  it('flags a week that outruns its baseline', () => {
    expectOne(findingsFor(code, block([1500])), 1);
  });

  it('says nothing about a plan that climbs within the cap', () => {
    expect(findingsFor(code, block([1050, 1100]))).toEqual([]);
  });

  it('passes at exactly the cap and fails just past it', () => {
    // Baseline 1000: 1100 kg is exactly +10%, 1100.1 kg is not. The comparison
    // is on the ratio, so a rounded percentage must not rescue the second.
    expect(BASELINE_KG * (1 + MAX_WEEKLY_TONNAGE_INCREASE)).toBe(1100);
    expect(findingsFor(code, block([1100]))).toEqual([]);
    expectOne(findingsFor(code, block([1100.1])), 1);
  });

  it('is exempt when the applicable baseline is zero', () => {
    // A first-ever block has no history to exceed, and no ratio against zero.
    const ctx = context({ baselineWeeklyTonnageKg: 0 });
    expect(findingsFor(code, block([5000]), ctx)).toEqual([]);
    // Week 2's baseline is week 1, itself zero — the exemption chains.
    expect(findingsFor(code, block([0, 5000]), ctx)).toEqual([]);
  });

  it('never flags a deload week, even one that rises', () => {
    // A deload is meant to drop, so the rule declines to judge it at all. This
    // week is given a rise it could not otherwise survive, to show the skip is
    // unconditional rather than a side effect of deloads being small.
    expect(findingsFor(code, block([1000, { tonnageKg: 3000, isDeload: true }]))).toEqual([]);
  });

  it('measures a post-deload week against the last non-deload week', () => {
    // WHY this is the load-bearing case: against week 2 (400 kg) a return to
    //      1050 kg reads as a 2.6x spike and the rule fires on correct
    //      programming. Against week 1 (1000 kg) it is +5%. Silence here is the
    //      only assertion that separates the two readings.
    const deload = { tonnageKg: 400, isDeload: true };
    expect(findingsFor(code, block([1000, deload, 1050]))).toEqual([]);
    expectOne(findingsFor(code, block([1000, deload, 1200])), 3);
  });

  it('uses the context baseline for the first non-deload week, not for week 1', () => {
    // The block opens on a deload, so week 2 is the first week the rule judges
    // and `baselineWeeklyTonnageKg` is what it judges against.
    const opening = { tonnageKg: 300, isDeload: true };
    expect(findingsFor(code, block([opening, 1100]))).toEqual([]);
    expectOne(findingsFor(code, block([opening, 1200])), 2);
  });

  it('has one direction: a decrease is never a finding', () => {
    expect(findingsFor(code, block([200, 100]))).toEqual([]);
  });

  it('emits at most one finding per offending week', () => {
    // Week 1 overshoots the context baseline and week 2 overshoots week 1. Each
    // is reported once, tagged with its own week.
    const findings = findingsFor(code, block([2000, 4000]));
    expect(findings).toHaveLength(2);
    expect(weeksOf(findings)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// 2. acwr_band
// ---------------------------------------------------------------------------

describe('acwr_band', () => {
  const code = 'acwr_band';
  const conditioned = context({ chronicWeeklyTonnageKg: 1000 });

  it('flags week 1 jumping past what the user is conditioned to', () => {
    expectOne(findingsFor(code, block([3000]), conditioned), 1);
  });

  it('says nothing when week 1 sits where the chronic mean already is', () => {
    expect(findingsFor(code, block([1000]), conditioned)).toEqual([]);
  });

  it('treats the threshold as inclusive, matching acwrBand in the metrics engine', () => {
    // 1499.9 / 1000 passes; 1500 / 1000 is exactly ACWR_HIGH_RISK and fails.
    // The two must not disagree: acwrBand already calls >= 1.5 "danger".
    expect(1000 * ACWR_HIGH_RISK).toBe(1500);
    expect(findingsFor(code, block([1499.9]), conditioned)).toEqual([]);
    expectOne(findingsFor(code, block([1500]), conditioned), 1);
  });

  it('stays silent on a null chronic mean rather than guessing', () => {
    // Mirrors acwr() returning null on history too thin to mean anything.
    const ctx = context({ chronicWeeklyTonnageKg: null });
    expect(findingsFor(code, block([10000]), ctx)).toEqual([]);
  });

  it('stays silent on a zero chronic mean', () => {
    const ctx = context({ chronicWeeklyTonnageKg: 0 });
    expect(findingsFor(code, block([10000]), ctx)).toEqual([]);
  });

  it('guards week 1 only', () => {
    // A later week climbing hard belongs to weekly_volume_increase; this rule
    // is about the entry into the block.
    expect(findingsFor(code, block([1000, 3000]), conditioned)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. deload_cadence
// ---------------------------------------------------------------------------

describe('deload_cadence', () => {
  const code = 'deload_cadence';

  const plain = (weeks: number): WeekInput[] => Array.from({ length: weeks }, (): WeekSpec => ({}));

  const withDeloadAt = (weeks: number, deloadWeek: number): TrainingBlock =>
    block(Array.from({ length: weeks }, (_, i): WeekSpec => ({ isDeload: i + 1 === deloadWeek })));

  it('flags a long block with no deload', () => {
    expectOne(findingsFor(code, block(plain(DELOAD_REQUIRED_BY_WEEK))), null);
  });

  it('is a property of the block, so weekNumber is null', () => {
    expect(findingsFor(code, block(plain(8)))[0]!.weekNumber).toBeNull();
  });

  it('exempts a block shorter than the requirement', () => {
    expect(findingsFor(code, block(plain(DELOAD_REQUIRED_BY_WEEK - 1)))).toEqual([]);
  });

  it('accepts a deload landing on week 5, the last week that counts', () => {
    expect(findingsFor(code, withDeloadAt(5, 5))).toEqual([]);
    expect(findingsFor(code, withDeloadAt(6, 5))).toEqual([]);
  });

  it('accepts a deload earlier than the deadline', () => {
    expect(findingsFor(code, withDeloadAt(6, 3))).toEqual([]);
  });

  it('rejects a deload that arrives only at week 6', () => {
    expectOne(findingsFor(code, withDeloadAt(6, 6)), null);
  });

  it('identifies weeks by week_number, not by array position', () => {
    // Weeks numbered 2..6 with the deload on week 6: it sits fifth in the array,
    // so position-based logic accepts it. By week_number, weeks 1 to 5 hold no
    // deload and the block fails.
    const plan = block(
      Array.from({ length: 5 }, (_, i): WeekSpec => ({ weekNumber: i + 2, isDeload: i + 2 === 6 }))
    );
    expectOne(findingsFor(code, plan), null);
  });

  it('emits at most one finding however long the block runs', () => {
    expect(findingsFor(code, block(plain(12)))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 4. equipment_available
// ---------------------------------------------------------------------------

describe('equipment_available', () => {
  const code = 'equipment_available';

  it('flags a slug the candidate list does not contain', () => {
    // INVARIANT: the planner selects only from the pre-filtered candidate list
    //            — CLAUDE.md #5. A slug outside it is an invented exercise.
    expectOne(findingsFor(code, blockOf('kettlebell-swing')), 1);
  });

  it('says nothing when every slug resolves', () => {
    const plan = block([
      { exercises: [exercise(FILLER_SLUG, [set(100)]), exercise('barbell-curl', [set(40)])] },
    ]);
    expect(findingsFor(code, plan)).toEqual([]);
  });

  it('reports one finding per distinct slug, however often it repeats', () => {
    // 'ghost-lift' appears three times across two weeks and two sessions;
    // 'phantom-press' once. Two unknown slugs, two findings.
    const ghost = exercise('ghost-lift', [set(0)]);
    const phantom = exercise('phantom-press', [set(0)]);
    const plan = block([
      { exercises: [ghost], sessions: [[ghost]] },
      { exercises: [ghost, phantom] },
    ]);
    const findings = findingsFor(code, plan);
    expect(findings).toHaveLength(2);
    // Each is dated to where its own slug first appears, which also shows the
    // two findings are about different slugs rather than the same one twice.
    expect(weeksOf(findings)).toEqual([1, 2]);
  });

  it('reports the first week the slug appears in', () => {
    const ghost = exercise('ghost-lift', [set(0)]);
    const plan = block([
      { exercises: [exercise(FILLER_SLUG, [set(100)])] },
      { exercises: [ghost] },
      { exercises: [ghost] },
    ]);
    expectOne(findingsFor(code, plan), 2);
  });

  it('matches case-sensitively', () => {
    // A slug differing only in case is one the model did not copy verbatim.
    expectOne(findingsFor(code, blockOf('Barbell-Back-Squat')), 1);
  });
});

// ---------------------------------------------------------------------------
// 5. load_ceiling
// ---------------------------------------------------------------------------

describe('load_ceiling', () => {
  const code = 'load_ceiling';

  it('flags a prescription above the ceiling of the equipment it needs', () => {
    expectOne(findingsFor(code, blockOf('dumbbell-bench-press', 40)), 1);
  });

  it('says nothing about a prescription under the ceiling', () => {
    expect(findingsFor(code, blockOf('dumbbell-bench-press', 20))).toEqual([]);
  });

  it('passes at exactly the ceiling and fails just past it', () => {
    // Exceeding means strictly greater: 30 kg on a 30 kg dumbbell is fine.
    expect(findingsFor(code, blockOf('dumbbell-bench-press', 30))).toEqual([]);
    expectOne(findingsFor(code, blockOf('dumbbell-bench-press', 30.01)), 1);
  });

  it('treats a single null ceiling as unlimited', () => {
    expect(findingsFor(code, blockOf(FILLER_SLUG, 300))).toEqual([]);
  });

  it('treats an all-null equipment set as unlimited', () => {
    expect(findingsFor(code, blockOf('barbell-curl', 400))).toEqual([]);
  });

  it('binds on the lowest ceiling among the equipment the movement needs', () => {
    // landmine-press needs a 200 kg barbell and a 30 kg dumbbell. The dumbbell
    // runs out first, so the dumbbell decides.
    expect(findingsFor(code, blockOf('landmine-press', 30))).toEqual([]);
    expectOne(findingsFor(code, blockOf('landmine-press', 40)), 1);
  });

  it('never flags a set with no weight', () => {
    // Bodyweight work has no external load to compare against a ceiling.
    expect(findingsFor(code, blockOf('dumbbell-bench-press', null, 10))).toEqual([]);
  });

  it('stays silent for a slug absent from the candidate list', () => {
    // WHY: equipment_available owns that failure, and reporting it twice
    //      conflates an invented exercise with an overloaded one.
    expect(findingsFor(code, blockOf('kettlebell-swing', 500))).toEqual([]);
  });

  it('reports one finding per exercise and week, not per offending set', () => {
    const heavy = exercise('dumbbell-bench-press', [set(40), set(45), set(50)]);
    const plan = block([{ exercises: [heavy], sessions: [[heavy]] }, { exercises: [heavy] }]);
    const findings = findingsFor(code, plan);
    expect(findings).toHaveLength(2);
    expect(weeksOf(findings)).toEqual([1, 2]);
  });

  it('reports each offending exercise separately within one week', () => {
    const plan = block([
      {
        exercises: [
          exercise('dumbbell-bench-press', [set(40)]),
          exercise('goblet-squat', [set(40)]),
        ],
      },
    ]);
    expect(findingsFor(code, plan)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 6. injured_joint
// ---------------------------------------------------------------------------

describe('injured_joint', () => {
  const code = 'injured_joint';

  /** Every (joint, muscle) pair the spec's table lists. */
  const JOINT_MUSCLES: ReadonlyArray<readonly [string, string]> = [
    ['knee', 'quadriceps'],
    ['knee', 'hamstrings'],
    ['knee', 'calves'],
    ['hip', 'glutes'],
    ['hip', 'hamstrings'],
    ['hip', 'adductors'],
    ['hip', 'abductors'],
    ['lower-back', 'lower back'],
    ['shoulder', 'shoulders'],
    ['shoulder', 'chest'],
    ['shoulder', 'lats'],
    ['shoulder', 'traps'],
    ['elbow', 'biceps'],
    ['elbow', 'triceps'],
    ['elbow', 'forearms'],
    ['wrist', 'forearms'],
    ['ankle', 'calves'],
  ];

  /** Every (joint, pattern) pair the spec's table lists. */
  const JOINT_PATTERNS: ReadonlyArray<readonly [string, string]> = [
    ['knee', 'squat'],
    ['hip', 'hinge'],
    ['hip', 'squat'],
    ['lower-back', 'hinge'],
    ['lower-back', 'carry'],
    ['wrist', 'carry'],
    ['ankle', 'squat'],
  ];

  const label = ([joint, trait]: readonly [string, string]): string => `${joint}:${trait}`;

  function flags(joint: string, primaryMuscle: string, movementPattern: string | null): boolean {
    const only = candidate({ slug: 'movement', primaryMuscle, movementPattern });
    const ctx = context({ candidates: [only], injuredJoints: [joint] });
    return findingsFor(code, blockOf('movement'), ctx).length > 0;
  }

  it('flags every muscle the table assigns to a joint', () => {
    // movementPattern is null throughout, so only the muscle half can match.
    const flagged = JOINT_MUSCLES.filter(([joint, muscle]) => flags(joint, muscle, null));
    expect(flagged.map(label)).toEqual(JOINT_MUSCLES.map(label));
  });

  it('flags every movement pattern the table assigns to a joint', () => {
    // 'chest' belongs to no joint that has patterns, so only the pattern half
    // can match.
    const flagged = JOINT_PATTERNS.filter(([joint, pattern]) => flags(joint, 'chest', pattern));
    expect(flagged.map(label)).toEqual(JOINT_PATTERNS.map(label));
  });

  it('says nothing about an exercise loading neither half of the joint', () => {
    const misses: ReadonlyArray<readonly [string, string, string | null]> = [
      ['knee', 'chest', 'push'],
      ['hip', 'biceps', 'pull'],
      ['lower-back', 'quadriceps', 'squat'],
      ['shoulder', 'quadriceps', 'squat'],
      ['elbow', 'chest', 'carry'],
      ['wrist', 'chest', 'push'],
      ['ankle', 'quadriceps', 'hinge'],
    ];
    const flagged = misses.filter(([joint, muscle, pattern]) => flags(joint, muscle, pattern));
    expect(flagged).toEqual([]);
  });

  it('flags a benching plan for an injured shoulder', () => {
    const ctx = context({ injuredJoints: ['shoulder'] });
    expectOne(findingsFor(code, blockOf('dumbbell-bench-press'), ctx), 1);
  });

  it('says nothing when no joint is flagged', () => {
    const ctx = context({ injuredJoints: [] });
    expect(findingsFor(code, blockOf(FILLER_SLUG, 100), ctx)).toEqual([]);
  });

  it('ignores a joint outside the table rather than erroring on it', () => {
    // Not an error and not a finding — the rule simply has nothing to say.
    const ctx = context({ injuredJoints: ['spleen'] });
    expect(findingsFor(code, blockOf(FILLER_SLUG, 100), ctx)).toEqual([]);
  });

  it('tolerates a null movement pattern', () => {
    // barbell-curl has no pattern, so only its muscle can implicate a joint.
    const knee = context({ injuredJoints: ['knee'] });
    const elbow = context({ injuredJoints: ['elbow'] });
    expect(findingsFor(code, blockOf('barbell-curl', 40), knee)).toEqual([]);
    expectOne(findingsFor(code, blockOf('barbell-curl', 40), elbow), 1);
  });

  it('stays silent for a slug absent from the candidate list', () => {
    // As in load_ceiling: equipment_available owns that failure.
    const ctx = context({ injuredJoints: ['knee'] });
    expect(findingsFor(code, blockOf('kettlebell-swing'), ctx)).toEqual([]);
  });

  it('reports one finding per exercise and week, not per session', () => {
    const bench = exercise('dumbbell-bench-press', [set(0)]);
    const plan = block([{ exercises: [bench], sessions: [[bench]] }, { exercises: [bench] }]);
    const findings = findingsFor(code, plan, context({ injuredJoints: ['shoulder'] }));
    expect(findings).toHaveLength(2);
    expect(weeksOf(findings)).toEqual([1, 2]);
  });

  it('collapses an exercise loading two injured joints into one finding', () => {
    // AMBIGUOUS IN THE SPEC, and this is the reading it states literally. A back
    // squat loads a knee (quadriceps, squat) and a hip (squat), but the rule
    // says "one finding per distinct (exercise, week) pair", which admits only
    // one. If the intent was one per joint, change this assertion and the spec
    // sentence together — not this assertion alone.
    const ctx = context({ injuredJoints: ['knee', 'hip'] });
    expectOne(findingsFor(code, blockOf(FILLER_SLUG, 100), ctx), 1);
  });
});

// ---------------------------------------------------------------------------
// checkRules
// ---------------------------------------------------------------------------

describe('checkRules', () => {
  it('returns an empty array for a plan that breaks nothing', () => {
    expect(checkRules(cleanPlan(), context({ chronicWeeklyTonnageKg: 1000 }))).toEqual([]);
  });

  it('reports every breach rather than stopping at the first', () => {
    // WHY: one round trip reporting three problems beats three reporting one.
    const codes = codesOf(checkRules(threeRuleBreachPlan(), context()));
    expect([...codes].sort()).toEqual(
      ['deload_cadence', 'equipment_available', 'weekly_volume_increase'].sort()
    );
  });

  it('returns findings in RuleCode declaration order', () => {
    const ctx = context({ chronicWeeklyTonnageKg: 1000, injuredJoints: ['shoulder'] });
    expect(codesOf(checkRules(everyRuleBreachPlan(), ctx))).toEqual([...RULE_ORDER]);
  });

  it('orders a partial set the same way', () => {
    const positions = codesOf(checkRules(threeRuleBreachPlan(), context())).map((c) =>
      RULE_ORDER.indexOf(c)
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('gives every finding a non-empty detail', () => {
    const ctx = context({ chronicWeeklyTonnageKg: 1000, injuredJoints: ['shoulder'] });
    for (const finding of checkRules(everyRuleBreachPlan(), ctx)) {
      expect(finding.detail.trim().length).toBeGreaterThan(0);
    }
  });
});
