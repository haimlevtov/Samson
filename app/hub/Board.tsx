import type { LeaderboardRow } from '@/src/db/leaderboard';
import { LEADERBOARD_LIMIT } from '@/src/db/leaderboard';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';
import { initialOf } from '@/src/ui/quests';
import type { Metal } from '@/src/ui/tiers';

/**
 * The leaderboard as the Quest Log draws it — ADR 0016's rows, ADR 0033's podium.
 *
 * INVARIANT: this renders exactly the three fields ADR 0016 allows a row to
 *            carry — rank, display name, level — and `isYou`. No XP total, no
 *            id, no email. The podium is a way of drawing the first three ROWS,
 *            not a new ranking.
 *
 * WHY the markup stays in rank order and CSS moves the tiles into 2 · 1 · 3:
 * a screen reader follows the markup, and a list read as "second, first, third"
 * is a list read wrong. `order` changes where a tile sits, not what it is.
 *
 * WHY everything that CLAIMS a place follows RANK, not position: `rank()` ties,
 * so two lifters level on XP and name share first. Both get the crown, the gold
 * rim, the gold digits and "1st". Only the LAYOUT follows position — somebody
 * has to stand in the middle — and FOUND IN REVIEW, the first version crowned
 * whichever of two tied lifters Postgres happened to return first, which could
 * swap on a reload.
 */
const METAL_BY_PLACE: Record<number, Metal> = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const ORDINAL: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };
const PODIUM_HEX = [64, 52, 48];

/** Level as the eye reads it ("LV 8") and as a screen reader should ("Level 8"). */
function Level({ level }: { level: number }) {
  return (
    <span className="board-level">
      <small aria-hidden="true">LV</small>
      <span className="sr-only">Level </span>
      <strong>{level}</strong>
    </span>
  );
}

export function Board({
  rows,
  labelledBy,
}: {
  rows: readonly LeaderboardRow[];
  /** The id of the page's heading for this board, so the landmark has one name. */
  labelledBy: string;
}) {
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const readerListed = rows.some((row) => row.isYou);
  const count =
    rows.length >= LEADERBOARD_LIMIT
      ? `top ${LEADERBOARD_LIMIT}`
      : `${rows.length} ${rows.length === 1 ? 'lifter' : 'lifters'}`;

  return (
    <section className="board" aria-labelledby={labelledBy}>
      <div className="board-top">
        <span>
          <Icon name="trophy" size={14} />
          Leaderboard
        </span>
        <span>{count}</span>
      </div>

      <ol
        className={`podium${podium.length === 1 ? ' only-one' : podium.length === 2 ? ' only-two' : ''}`}
      >
        {podium.map((row, i) => {
          const metal = METAL_BY_PLACE[row.rank] ?? 'bronze';
          const first = row.rank === 1;
          return (
            /*
             * Keyed by rank AND position. Rank alone repeats on a tie — FOUND IN
             * REVIEW, where the table this replaced claimed rank was unique —
             * and a duplicate key lets React leave a stale row behind when the
             * board changes under a revalidation. A name is no better: nothing
             * makes it unique. The list is rebuilt whole from the server, so
             * position carries no identity worth preserving.
             */
            <li
              key={`${row.rank}:${i}`}
              className={`podium-tile podium-${i + 1}${first ? ' is-first' : ''}`}
              aria-current={row.isYou ? 'true' : undefined}
            >
              {first ? (
                <span className="place-gold">
                  <Icon name="crown" size={18} />
                </span>
              ) : null}
              <Hex size={PODIUM_HEX[i] ?? 48} rim={metal} tone="core">
                {initialOf(row.displayName)}
              </Hex>
              <span className="podium-name">{row.displayName}</span>
              <Level level={row.level} />
              <span className={`podium-place place-${metal}`}>
                {ORDINAL[row.rank] ?? `#${row.rank}`}
              </span>
              {row.isYou ? <span className="board-you">you</span> : null}
            </li>
          );
        })}
      </ol>

      {rest.length > 0 ? (
        <ol className="board-rows">
          {rest.map((row, i) => (
            <li
              key={`${row.rank}:${i + 3}`}
              className={row.isYou ? 'you' : undefined}
              aria-current={row.isYou ? 'true' : undefined}
            >
              <span className="board-rank">{row.rank}</span>
              <span className="lb-name">{row.displayName}</span>
              <span className="board-row-end">
                {/* Outside the name, which truncates: the chip is the signal a
                    long name must never be able to push off the row. */}
                {row.isYou ? <span className="board-you">you</span> : null}
                {/* Level, not XP — ADR 0016's amendment, and the reasoning is in
                    src/db/leaderboard.ts where the mapping lives. */}
                <Level level={row.level} />
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {/*
       * The privacy sentence only where it is true — FOUND IN REVIEW. "Anyone
       * signed in can see your row" said to somebody with no row (no display
       * name, opted out, or below the top 25) is a claim about a row that is
       * not there. ADR 0016's amendment lists this as one of its copy surfaces.
       */}
      <p className="board-foot">
        Ordered by XP total, shown as levels.
        {readerListed ? ' Anyone signed in can see your row; leave from Settings.' : ''}
      </p>
    </section>
  );
}
