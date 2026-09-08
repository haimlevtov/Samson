import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadProgressionTrees, loadUnlockSets } from '@/src/db/progression';
import { unlockStates, type UnlockState } from '@/src/gamification/unlocks';
import { FieldHint } from '@/src/ui/FieldHint';

export const dynamic = 'force-dynamic';

/**
 * The progression trees — ADR 0020.
 *
 * INVARIANT: every unlock on this page is decided by `unlockStates`, a pure
 *            function over logged sets — CLAUDE.md #1. The page formats; it does
 *            not judge.
 *
 * WHY `/progression-trees` and not `/progression`: ADR 0014 already owns
 * "progression" for e1RM history at `/history/exercise/[id]`, which is a
 * different idea entirely — how heavy a lift has become, rather than which
 * skill opens next. ADR 0018 noted the word was becoming overloaded.
 *
 * AI-NOTE: a sub-route reached from Profile, deliberately not a sixth tab. Five
 *          is the budget ADR 0012 set and `/settings` is the precedent for a
 *          route Profile owns. The link on Profile is the only way in, so
 *          deleting it strands the page.
 */
export default async function ProgressionTreesPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const [nodes, sets] = await Promise.all([loadProgressionTrees(db), loadUnlockSets(db)]);
  const states = unlockStates(nodes, sets);

  const trees = ['push', 'pull', 'legs', 'core'] as const;
  const unlockedCount = states.filter((s) => s.unlocked).length;

  return (
    <>
      <header className="top">
        <div>
          <h1>Progression trees</h1>
          <span className="muted small">
            {unlockedCount} of {states.length} unlocked
          </span>
        </div>
        <Link href="/profile" className="chip">
          Profile
        </Link>
      </header>

      <p className="card muted small">
        Each rung opens when you have done the one below it. The requirement is{' '}
        <strong>sets in a single session</strong>, not a total — three sets of ten across three
        months does not say whether the next step is reachable.
      </p>

      {trees.map((tree) => {
        const rungs = states.filter((s) => s.node.tree === tree);
        if (rungs.length === 0) return null;

        return (
          <section key={tree}>
            <h2 className="section with-hint">
              {tree}
              <FieldHint title={`The ${tree} tree`}>
                Unlocks are worked out from your logged sets, in code, every time this page loads —
                nothing is stored, so correcting a session corrects the tree. Warm-ups never count.
              </FieldHint>
            </h2>

            <ol className="tree">
              {rungs.map((state) => (
                <Rung key={state.node.slug} state={state} />
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}

function Rung({ state }: { state: UnlockState }) {
  const { node, unlocked, met } = state;
  const criteria = 'kind' in node.criteria ? node.criteria : null;

  return (
    <li className={`tree-rung${unlocked ? ' is-unlocked' : ''}${state.next ? ' is-next' : ''}`}>
      <span className="tree-mark" aria-hidden="true">
        {unlocked ? '●' : '○'}
      </span>

      <div className="tree-body">
        <h3>{node.name}</h3>

        {criteria === null ? (
          <p className="muted small">Where this tree starts.</p>
        ) : (
          <p className="muted small">
            {criteria.sets} × {criteria.reps}
            {criteria.weight_kg ? ` at ${criteria.weight_kg} kg` : ''} of {criteria.exercise} in one
            session
          </p>
        )}

        <p className="muted small">
          {unlocked && <span className="chip chip-on">unlocked</span>}
          {state.next && <span className="chip">next</span>}
          {/*
           * `met` without `unlocked` is the interesting case and worth saying
           * out loud: the criteria are cleared but a rung below is not, so the
           * tree is telling the user to go back rather than refusing silently.
           */}
          {met && !unlocked && <span className="chip">cleared — finish the rung below</span>}
        </p>
      </div>
    </li>
  );
}
