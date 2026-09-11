/**
 * The progression trees, as content.
 *
 * The evaluator is unit-tested in `src/gamification/unlocks.test.ts` against
 * literals. What needs a database is the shape of the ROWS: `level` agrees with
 * `parent_id`, no cycles, a chain never changes tree, and every criterion names
 * an exercise the catalogue actually has.
 *
 * That last one is not hypothetical — the catalogue has no `push-up`, no
 * `pistol-squat` and no `hollow-hold`, all obvious guesses, all wrong, and a
 * criterion naming one is a rung nobody can ever open.
 *
 * The skill also asks for "every `exercise_id` resolves". That property is now
 * inverted, and the two cases below say why: a migration cannot depend on the
 * exercise catalogue, because the catalogue is seeded and the seed runs after
 * migrations. CI found it; hosted could not have.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUser,
  deleteTestUsers,
  signInAsArchetype,
  type TestUser,
} from './helpers';
import { loadProgressionTrees, loadUnlockSets } from '../../src/db/progression';
import { availableExercises } from '../../src/db/exercises';
import { unlockStates } from '../../src/gamification/unlocks';

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser('tree');
}, 60_000);

afterAll(async () => {
  await deleteTestUser(user);
});

/** The shipped reader, through a user-scoped client. */
const trees = () => loadProgressionTrees(user.client);

const TREES = ['push', 'pull', 'legs', 'core'] as const;

describe('the shipped trees', () => {
  it('covers all four the brief names', async () => {
    const present = new Set((await trees()).map((n) => n.tree));
    expect([...TREES].filter((t) => !present.has(t))).toEqual([]);
  });

  it('references no catalogue row, in any environment', async () => {
    /*
     * THIS TEST USED TO ASSERT THE OPPOSITE, and CI is what corrected it.
     *
     * The migration looked each node's `exercise_id` up by slug. That passed
     * against hosted, where the catalogue had been seeded weeks earlier, and
     * failed on CI's fresh stack — because the catalogue is loaded by
     * `scripts/seed.ts`, and `npm run migrate` runs BEFORE `npm run seed`. The
     * same migration produced different content in different environments.
     *
     * It also broke the seeder: `exercise_id` references
     * `exercises (id) ON DELETE RESTRICT`, and the seed begins by deleting every
     * shared catalogue row to reload the snapshot.
     *
     * `exercise_id` is null everywhere now — migration 20260908120200 — and this
     * asserts it stays that way, because the failure mode of reintroducing the
     * lookup is a green suite locally and a red one on CI.
     */
    const referencing = (await trees()).filter((n) => n.exerciseSlug !== null);
    expect(referencing.map((n) => n.slug)).toEqual([]);
  });

  it('lets the seeder delete and reload the catalogue', async () => {
    // The consequence that made the above more than a tidiness question. A
    // shared exercise must remain deletable, or `npm run seed` cannot run.
    const { data } = await user.client.from('exercises').select('id').is('user_id', null).limit(1);
    expect(data?.length, 'the catalogue is seeded before this suite runs').toBe(1);

    const { count } = await adminClient()
      .from('progression_nodes')
      .select('id', { count: 'exact', head: true })
      .not('exercise_id', 'is', null);

    expect(count, 'no node holds a catalogue row hostage').toBe(0);
  });

  it('gives every tree exactly one root', async () => {
    for (const tree of TREES) {
      const roots = (await trees()).filter((n) => n.tree === tree && n.parentSlug === null);
      expect(
        roots.map((n) => n.slug),
        tree
      ).toHaveLength(1);
      expect(roots[0]?.level, `${tree} root is level 0`).toBe(0);
    }
  });

  it('keeps level in step with parent_id', async () => {
    // The skill: level is denormalised on purpose, and if the two ever disagree
    // `parent_id` is the truth and `level` is the bug.
    const nodes = await trees();
    const bySlug = new Map(nodes.map((n) => [n.slug, n]));

    for (const node of nodes) {
      if (node.parentSlug === null) {
        expect(node.level, node.slug).toBe(0);
        continue;
      }
      const parent = bySlug.get(node.parentSlug);
      expect(parent, `${node.slug} has a parent that exists`).toBeDefined();
      expect(node.level, `${node.slug} is one below ${node.parentSlug}`).toBe(parent!.level + 1);
    }
  });

  it('never changes tree down a chain', async () => {
    const nodes = await trees();
    const bySlug = new Map(nodes.map((n) => [n.slug, n]));

    for (const node of nodes) {
      if (node.parentSlug === null) continue;
      expect(bySlug.get(node.parentSlug)?.tree, node.slug).toBe(node.tree);
    }
  });

  it('has no cycles', async () => {
    const nodes = await trees();
    const bySlug = new Map(nodes.map((n) => [n.slug, n]));

    for (const node of nodes) {
      const seen = new Set<string>([node.slug]);
      let cursor = node.parentSlug;
      // Bounded by the node count, so a cycle fails the assertion rather than
      // hanging the suite.
      while (cursor !== null && seen.size <= nodes.length) {
        expect(seen.has(cursor), `cycle through ${cursor}`).toBe(false);
        seen.add(cursor);
        cursor = bySlug.get(cursor)?.parentSlug ?? null;
      }
    }
  });

  it('names an exercise in every criterion that has one', async () => {
    // A criterion pointing at a slug the catalogue does not have can never be
    // met, which is a locked node nobody can open and nothing to say why.
    const nodes = await trees();
    const known = new Set(nodes.map((n) => n.exerciseSlug).filter((s): s is string => s !== null));

    const { data } = await user.client.from('exercises').select('slug').is('user_id', null);
    for (const row of data ?? []) known.add(row.slug);

    for (const node of nodes) {
      if (!('kind' in node.criteria) || node.criteria.kind !== 'sets_at') continue;
      expect(
        known.has(node.criteria.exercise),
        `${node.slug} wants ${node.criteria.exercise}`
      ).toBe(true);
    }
  });

  it('shows a signed-out caller nothing', async () => {
    // INVARIANT: RLS and grants are two independent gates — ADR 0003.
    const { data } = await anonClient().from('progression_nodes').select('slug');
    expect(data ?? []).toEqual([]);
  });
});

describe('a brand new account', () => {
  it('has each tree open at its root and closed above it', async () => {
    /*
     * The end-to-end shape, run through the same reader and evaluator the page
     * uses. A user with no history should see four things they can start and
     * nothing they have finished — if a root ever came back locked, the whole
     * feature would render as a wall.
     */
    const nodes = await trees();
    const states = unlockStates(nodes, []);
    const bySlug = new Map(states.map((s) => [s.node.slug, s]));

    // Every root is open, or the feature renders as a wall.
    for (const state of states) {
      if (state.node.parentSlug === null) expect(state.unlocked, state.node.slug).toBe(true);
    }

    // And nothing is open whose parent is not.
    for (const state of states) {
      if (!state.unlocked || state.node.parentSlug === null) continue;
      expect(bySlug.get(state.node.parentSlug)?.unlocked, state.node.slug).toBe(true);
    }

    // Exactly one next step per tree, so the page always has something to point
    // at whatever the user has done.
    const next = states.filter((s) => s.next);
    expect(new Set(next.map((s) => s.node.tree)).size).toBe(TREES.length);
  });

  it('opens two rungs of the core tree, because a hold has no criteria', async () => {
    /*
     * Asserted rather than treated as a surprise, and it is the visible edge of
     * the gap ADR 0020 records: `public.sets` has no DURATION column, so "hold
     * a plank for sixty seconds" cannot be written as a criterion.
     *
     * The consequence is that the plank root has `{}` and so does the node
     * below it — nothing can gate on a hold — so the core tree starts with two
     * rungs open where the others start with one. That is content following
     * from a schema limit, not the evaluator misbehaving.
     *
     * AI-NOTE: when a duration column exists, give `core-leg-raise` a real
     *          criterion against the plank and this test becomes the one that
     *          tells you to update it.
     */
    const states = unlockStates(await trees(), []);
    const openCore = states.filter((s) => s.node.tree === 'core' && s.unlocked);
    expect(openCore.map((s) => s.node.slug)).toEqual(['core-plank', 'core-leg-raise']);

    // The other three open exactly one, which is what a criterion buys you.
    for (const tree of ['push', 'pull', 'legs'] as const) {
      const open = states.filter((s) => s.node.tree === tree && s.unlocked);
      expect(open, tree).toHaveLength(1);
    }
  });
});

describe('a user cannot author a node', () => {
  /*
   * The two cases `docs/adr/0002-catalogue-user-id.md`'s 2026-09-08 amendment
   * names, written here because progression_nodes is the table that made the
   * amendment necessary a second time.
   *
   * The write half of the catalogue policy pair is justified in that ADR by a
   * NAMED future feature. There is no node-authoring feature, nothing under
   * src/ or app/ writes one, and the reader deliberately returns only shared
   * rows — so the pair granted INSERT to every authenticated session for
   * nothing. Dropped in migration 20260908120100.
   *
   * WHY it was not merely untidy: progression_nodes_slug_unique is
   * `unique nulls not distinct (user_id, slug)`, so a user row could REUSE a
   * system slug — and `unlockStates` keys its map by slug. A user row carrying
   * `{}` at the right level would have marked an ancestor unlocked and cascaded
   * down the tree.
   */
  it('refuses a node of their own', async () => {
    const { error } = await user.client.from('progression_nodes').insert({
      user_id: user.id,
      tree: 'push',
      slug: `mine-${Date.now()}`,
      name: 'A node I made up',
      level: 0,
    });

    expect(error).not.toBeNull();
  });

  it('refuses a node that would be shared with everyone', async () => {
    // The escalation: a null user_id is what makes a row visible to every user
    // in the project, so it is the insert that must never succeed.
    const { error } = await user.client.from('progression_nodes').insert({
      user_id: null,
      tree: 'push',
      slug: `shared-${Date.now()}`,
      name: 'A node everyone gets',
      level: 0,
    });

    expect(error).not.toBeNull();
  });

  it('refuses to rewrite a shipped node', async () => {
    const before = await trees();
    const target = before[0]!;

    const { error } = await user.client
      .from('progression_nodes')
      .update({ unlock_criteria: {} })
      .eq('slug', target.slug);

    expect(error).not.toBeNull();
  });
});

describe('every rung opens with a lift the app will offer', () => {
  /*
   * ADR 0020, amended 2026-09-11. A criterion is matched against logged sets,
   * so one naming a lift the picker never offers is a rung nobody can open —
   * and it looks exactly like a rung nobody has opened yet. The legs tree had
   * two: its root's lift was a Smith-machine squat, and `split-squats` is filed
   * under stretching, which the picker hides from everyone. 20260908120000
   * checked that each slug EXISTED, and every one did.
   *
   * Asked of `availableExercises` itself, for real users with real grants,
   * rather than re-derived from the category list and the equipment tags: the
   * question is what the app will offer, and that function is what answers it.
   */
  let everything: TestUser;
  let floorOnly: TestUser;

  const grant = async (who: TestUser, slugs: string[] | 'all'): Promise<void> => {
    let query = adminClient().from('equipment_tags').select('id').is('user_id', null);
    if (slugs !== 'all') query = query.in('slug', slugs);
    const { data: tags, error } = await query;
    if (error || !tags || tags.length === 0) {
      throw new Error(`reading equipment tags: ${error?.message ?? 'none found'}`);
    }
    const granted = await who.client
      .from('user_equipment')
      .insert(tags.map((tag) => ({ user_id: who.id, equipment_tag_id: tag.id })));
    if (granted.error) throw new Error(`granting equipment: ${granted.error.message}`);
  };

  beforeAll(async () => {
    [everything, floorOnly] = await Promise.all([
      createTestUser('tree-everything'),
      createTestUser('tree-floor'),
    ]);
    await Promise.all([grant(everything, 'all'), grant(floorOnly, ['bodyweight'])]);
  }, 60_000);

  afterAll(async () => {
    await deleteTestUsers(everything, floorOnly);
  });

  /** Every `sets_at` criterion, as the rung it opens and the lift it asks for. */
  const asks = async (): Promise<{ rung: string; level: number; lift: string }[]> =>
    (await trees()).flatMap((node) =>
      'kind' in node.criteria && node.criteria.kind === 'sets_at'
        ? [{ rung: node.slug, level: node.level, lift: node.criteria.exercise }]
        : []
    );

  const offered = async (who: TestUser): Promise<Set<string>> => {
    const slugs = new Set((await availableExercises(who.client, who.id)).map((e) => e.slug));
    // PostgREST stops at max_rows (1000, supabase/config.toml) without saying
    // so, and a truncated list would read as lifts the app does not offer.
    expect(slugs.size, 'the candidate list hit the row cap').toBeLessThan(1000);
    return slugs;
  };

  it('asks only for lifts the app offers somebody', async () => {
    const all = await offered(everything);
    expect(all.size, 'is the catalogue seeded?').toBeGreaterThan(0);

    const closed = (await asks())
      .filter((ask) => !all.has(ask.lift))
      .map((ask) => `${ask.rung} -> ${ask.lift}`);

    expect(closed, 'a rung no user can ever open').toEqual([]);
  });

  it('opens the first rung of every tree with bodyweight alone', async () => {
    const floor = await offered(floorOnly);

    const shut = (await asks())
      .filter((ask) => ask.level === 1 && !floor.has(ask.lift))
      .map((ask) => `${ask.rung} -> ${ask.lift}`);

    expect(shut, 'a tree a bodyweight user cannot start climbing').toEqual([]);
  });

  it('names the rungs a bodyweight-only user cannot open, so a new one fails', async () => {
    /*
     * Pinned rather than tolerated. All three sit above the first rung and ask
     * for gear the catalogue tags `other` — bars to dip on, a band, a weight
     * belt — so they are content decisions of their own, tracked in
     * docs/plans/README.md, not bugs of the legs tree's kind. Changing one
     * changes this list on purpose; a new one fails here.
     */
    const floor = await offered(floorOnly);

    const needGear = (await asks())
      .filter((ask) => !floor.has(ask.lift))
      .map((ask) => `${ask.rung} -> ${ask.lift}`)
      .sort();

    expect(needGear).toEqual([
      'pull-chin -> band-assisted-pull-up',
      'pull-muscle-up -> weighted-pull-ups',
      'push-handstand -> parallel-bar-dip',
    ]);
  });
});

describe('the seeded home-gym lifter climbs what his equipment allows', () => {
  it('opens the legs tree to the lunge, and no further', async () => {
    /*
     * ADR 0020's 2026-09-11 amendment changed the programme with the tree.
     * Home-gym logged `chair-squat`, a machine lift he does not own; he now logs
     * bodyweight squats at 3 × 21, one over the lunge rung's 3 × 20, because a
     * later set drops a rep a quarter of the time. This is where that margin is
     * held: the shipped reader and evaluator, over the seeded history, as the
     * tree page would show it.
     *
     * He logs walking lunges at 3 × 12, short of the step-up's 3 × 16, so the
     * climb stops at the lunge. Stated here so a change to either number is a
     * decision rather than a drift.
     *
     * AI-NOTE: this reads the SEEDED demo user, so it holds on a stack seeded
     *          since the amendment — CI seeds every run. Against hosted it fails
     *          until hosted is reseeded, which is the point: the demo would show
     *          the old climb.
     */
    const homeGym = await signInAsArchetype('homegym@samson.test');
    const [nodes, unlock] = await Promise.all([
      loadProgressionTrees(homeGym.client),
      loadUnlockSets(homeGym.client),
    ]);

    expect(unlock.truncated, 'his history hit the reader cap').toBe(false);
    const open = unlockStates(nodes, unlock.sets)
      .filter((state) => state.node.tree === 'legs' && state.unlocked)
      .map((state) => state.node.slug);

    expect(open.sort()).toEqual(['legs-lunge', 'legs-squat']);
  });
});
