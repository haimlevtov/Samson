/**
 * The progression trees, as content.
 *
 * The evaluator is unit-tested in `src/gamification/unlocks.test.ts` against
 * literals. What needs a database is the shape of the ROWS, and the skill names
 * the properties worth asserting — `.claude/skills/add-progression/SKILL.md`:
 * every `exercise_id` resolves, `level` agrees with `parent_id`, no cycles, and
 * a chain never changes tree.
 *
 * The first of those is the one that bites. A `select` with no match inserts a
 * NULL rather than failing, so a typo'd slug produces a node pointing at
 * nothing and no migration complains. It is not hypothetical: the catalogue has
 * no `push-up`, no `pistol-squat` and no `hollow-hold` — all obvious guesses,
 * and all wrong.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, createTestUser, deleteTestUser, type TestUser } from './helpers';
import { loadProgressionTrees } from '../../src/db/progression';
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

  it('resolved every exercise slug it looked up', async () => {
    /*
     * The lookup-missed case. `exercise_id` is nullable and the insert uses a
     * subquery, so a slug that matches nothing writes a null and the node
     * silently points at no exercise.
     */
    const orphans = (await trees()).filter((n) => n.exerciseSlug === null);
    expect(orphans.map((n) => n.slug)).toEqual([]);
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
