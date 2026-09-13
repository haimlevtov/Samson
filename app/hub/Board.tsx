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
 * WHY a place's metal follows its RANK, not its position: `rank()` ties, so two
 * lifters level on XP and name share first — and both are gold. Labelling the
 * second tile "2ND" would state a difference the view did not find.
 */
const METAL_BY_PLACE: Record<number, Metal> = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const ORDINAL: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };
const PODIUM_HEX = [64, 52, 48];

export function Board({ rows }: { rows: readonly LeaderboardRow[] }) {
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const count =
    rows.length >= LEADERBOARD_LIMIT
      ? `top ${LEADERBOARD_LIMIT}`
      : `${rows.length} ${rows.length === 1 ? 'lifter' : 'lifters'}`;

  return (
    <section className="board" aria-label="Leaderboard">
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
          return (
            /*
             * Keyed by rank, not by name: two lifters may share a display name —
             * nothing makes it unique — and a duplicate React key drops a row
             * silently. Kept from the table this replaced.
             */
            <li
              key={row.rank}
              className={`podium-tile podium-${i + 1}`}
              aria-current={row.isYou ? 'true' : undefined}
            >
              {i === 0 ? (
                <span className="place-gold">
                  <Icon name="crown" size={18} />
                </span>
              ) : null}
              <Hex size={PODIUM_HEX[i] ?? 48} rim={metal} tone="core">
                {initialOf(row.displayName)}
              </Hex>
              <span className="podium-name">{row.displayName}</span>
              <span className="board-level">
                <small>LV</small>
                <strong>{row.level}</strong>
              </span>
              <span className={`podium-place place-${metal}`}>
                {(ORDINAL[row.rank] ?? `#${row.rank}`).toUpperCase()}
              </span>
              {row.isYou ? <span className="board-you">YOU</span> : null}
            </li>
          );
        })}
      </ol>

      {rest.length > 0 ? (
        <ol className="board-rows">
          {rest.map((row) => (
            <li
              key={row.rank}
              className={row.isYou ? 'you' : undefined}
              aria-current={row.isYou ? 'true' : undefined}
            >
              <span className="board-rank">{row.rank}</span>
              <span className="lb-name">{row.displayName}</span>
              {/* Level, not XP — ADR 0016's amendment, and the reasoning is in
                  src/db/leaderboard.ts where the mapping lives. */}
              <span className="board-level">
                {/* Outside the name, which truncates: the chip is the signal a
                    long name must never be able to push off the row. */}
                {row.isYou ? <span className="board-you">YOU</span> : null}
                <small>LV</small>
                <strong>{row.level}</strong>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="board-foot">
        Ordered by XP total, shown as levels. Anyone signed in can see this row; leave from
        Settings.
      </p>
    </section>
  );
}
