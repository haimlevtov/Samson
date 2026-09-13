import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadProgressionTrees, loadUnlockSets } from '@/src/db/progression';
import { unlockStates, type UnlockState } from '@/src/gamification/unlocks';
import { FieldHint } from '@/src/ui/FieldHint';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';
import { RUNG_ICON, RUNG_TONE, rungState, treeIcon } from '@/src/ui/trees';

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

  const [nodes, history] = await Promise.all([loadProgressionTrees(db), loadUnlockSets(db)]);
  const states = unlockStates(nodes, history.sets);

  /*
   * Grouped from the ROWS, with the literal used only for display order.
   *
   * FOUND IN REVIEW: this used to map over the literal and `return null` for a
   * tree with no rows, so a fifth tree added by migration would have rendered
   * nowhere at all — "nothing happens", which docs/specs/mobile-interface.md §4
   * exists to prevent. A tree the order does not name now sorts last and still
   * appears.
   */
  const TREE_ORDER = ['push', 'pull', 'legs', 'core'];
  const rank = (tree: string) => {
    const at = TREE_ORDER.indexOf(tree);
    return at === -1 ? TREE_ORDER.length : at;
  };

  const byTree = new Map<string, UnlockState[]>();
  for (const state of states) {
    const group = byTree.get(state.node.tree);
    if (group) group.push(state);
    else byTree.set(state.node.tree, [state]);
  }

  const trees = [...byTree.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const unlockedCount = states.filter((s) => s.unlocked).length;

  return (
    <>
      <header className="top">
        <div>
          <span className="kicker">Skill trees</span>
          {/* "Progression trees", not the handoff's "Progression" — ADR 0020's
              Naming section keeps the two words together, because ADR 0014 owns
              "progression" for the e1RM chart. */}
          <h1>Progression trees</h1>
          <span className="muted small">
            {unlockedCount} of {states.length} rungs open
          </span>
        </div>
        <Link href="/profile" className="chip chip-icon">
          <Icon name="chevron-left" size={16} />
          Profile
        </Link>
      </header>

      {/*
       * One tile per tree, each a link to its ladder below — the Quest Log. The
       * handoff lit the tree with the most recent unlock; nothing here knows
       * WHEN a rung opened (unlocks are recomputed, never stored — ADR 0020),
       * so no tile claims to be the latest.
       */}
      <nav className="tree-tiles" aria-label="Trees">
        {trees.map((tree) => {
          const rungs = byTree.get(tree) ?? [];
          const open = rungs.filter((r) => r.unlocked).length;
          return (
            <a key={tree} href={`#tree-${tree}`} className="card tree-tile">
              <Hex size={40} tone="soft">
                <Icon name={treeIcon(tree)} size={20} />
              </Hex>
              <span className="tree-tile-name">{tree}</span>
              {/* "2 / 4" to the eye; "2 of 4 rungs open" to a screen reader. */}
              <span className="muted tree-tile-count" aria-hidden="true">
                {open} / {rungs.length}
              </span>
              <span className="sr-only">
                {open} of {rungs.length} rungs open
              </span>
            </a>
          );
        })}
      </nav>

      {/*
       * Said out loud rather than swallowed. A truncated read can only
       * UNDER-report unlocks, so the page is wrong in the safe direction —
       * but a rung that should be open and is not needs an explanation, and
       * "we did not read all of it" is a better one than silence.
       */}
      {history.truncated && (
        <p className="card muted small">
          You have logged more sets than this page reads at once, so a rung you have already earned
          may still show as locked here.
        </p>
      )}

      {trees.length === 0 ? (
        // mobile-interface.md §4: a state, not an empty row of tiles.
        <p className="card muted">No progression trees to show yet.</p>
      ) : null}

      {/* The explainer the page has always carried, now under the tiles. */}
      <p className="muted tree-explainer">
        Each rung opens when you have done the one below it. The requirement is{' '}
        <strong>sets in a single session</strong>, not a total — three sets of ten across three
        months does not say whether the next step is reachable.
      </p>

      {trees.map((tree) => {
        const rungs = byTree.get(tree) ?? [];

        return (
          <section key={tree} id={`tree-${tree}`} className="tree-section">
            <h2 className="section with-hint">
              <Icon name={treeIcon(tree)} size={14} />
              {tree}
              <FieldHint title={`The ${tree} tree`}>
                Unlocks are worked out from your logged sets, in code, every time this page loads —
                nothing is stored, so correcting a session corrects the tree. Warm-ups never count.
              </FieldHint>
            </h2>

            {/*
             * Top rung first, read as a climb — the handoff — so the order a screen
             * reader hears is the order drawn. No numbers are drawn or spoken; the
             * words on each rung carry its state. `role="list"` because WebKit
             * drops list semantics from a list with its markers removed.
             */}
            <ol className="tree" role="list">
              {[...rungs].reverse().map((state) => (
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
  const { node } = state;
  // Narrowed on the kind rather than on the presence of one: a node whose
  // jsonb did not parse falls back to { kind: 'never' }, which has a kind and
  // no requirement to print — src/db/progression.ts.
  const criteria =
    'kind' in node.criteria && node.criteria.kind === 'sets_at' ? node.criteria : null;
  const unparseable = 'kind' in node.criteria && node.criteria.kind === 'never';

  const drawn = rungState(state);

  return (
    <li className={`tree-rung is-${drawn}${state.next ? ' card' : ''}`}>
      <span className="tree-mark">
        <Hex size={36} tone={RUNG_TONE[drawn]}>
          <Icon name={RUNG_ICON[drawn]} size={18} />
        </Hex>
      </span>

      <div className="tree-body">
        <h3 className="display">{node.name}</h3>

        {criteria === null ? (
          <p className="muted small">
            {unparseable
              ? 'Requirement unavailable.'
              : node.parentSlug === null
                ? 'Where this tree starts.'
                : // A `{}` node that is NOT a root. Today that is only
                  // `core-leg-raise`, and ADR 0020 says why it exists: `sets`
                  // has no duration column, so "hold a plank for sixty
                  // seconds" cannot be written as a criterion and the rung
                  // above the plank has nothing to gate on. Telling the user
                  // it is where the tree starts, on the second rung, is just
                  // wrong — and it read that way on the seeded demo.
                  'No requirement of its own — opens with the rung below.'}
          </p>
        ) : (
          <p className="muted small">
            {criteria.sets} × {criteria.reps}
            {criteria.weight_kg ? ` at ${criteria.weight_kg} kg` : ''} of {criteria.exercise} in one
            session
          </p>
        )}

        {/*
         * The state in words — shown for the three a user acts on, and for
         * "locked" read by a screen reader only, where the glyph is the visible
         * signal (mobile-interface.md §3: a word or an icon). `cleared` is the
         * interesting case: the criteria are met but a rung below is not, so the
         * tree is telling the user to go back rather than refusing silently.
         */}
        <p className="tree-chips">
          {drawn === 'unlocked' && <span className="chip chip-on">unlocked</span>}
          {drawn === 'next' && <span className="chip chip-next">next</span>}
          {drawn === 'cleared' && (
            <span className="chip chip-warn">cleared — finish the rung below</span>
          )}
          {drawn === 'locked' && <span className="sr-only">locked</span>}
        </p>
      </div>
    </li>
  );
}
