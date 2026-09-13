/**
 * Tests for `src/ui/tiers.ts` — ADR 0033 §3.
 *
 * The one claim worth holding is coverage: a tier the database allows and this
 * map does not know renders on the wrong metal with nothing saying why. So the
 * list is read out of the migration that owns the CHECK, not typed again here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from './icons';
import { METAL_BY_TIER, SLUGS_WITH_ICONS, TIERS, badgeIcon, metalFor } from './tiers';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

describe('the tier map', () => {
  it('covers exactly the tiers the database allows', () => {
    /*
     * The LATEST definition of the CHECK, across every migration — FOUND IN
     * REVIEW. The first version read only the migration that created the
     * table, so a ninth tier added by a later migration (they are never edited)
     * would have passed. Filenames sort in the order they apply.
     */
    const checks = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .flatMap((f) => [
        ...readFileSync(join(MIGRATIONS, f), 'utf8').matchAll(/check \(tier in \(([^)]*)\)\)/g),
      ]);
    const latest = checks.at(-1);
    expect(latest, 'no tier CHECK found in any migration').toBeDefined();
    const allowed = [...latest![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

    expect([...TIERS].sort()).toEqual(allowed);
    expect(Object.keys(METAL_BY_TIER).sort()).toEqual(allowed);
  });

  it('draws each tier in the metal ADR 0033 §3 decided', () => {
    expect(METAL_BY_TIER).toEqual({
      pr: 'gold',
      volume: 'gold',
      consistency: 'silver',
      comeback: 'silver',
      recovery: 'bronze',
      variety: 'bronze',
      calendar: 'bronze',
      hidden: 'obsidian',
    });
  });

  it('draws a hidden badge in obsidian and nothing else in it', () => {
    expect(metalFor('hidden')).toBe('obsidian');
    expect(TIERS.filter((t) => METAL_BY_TIER[t] === 'obsidian')).toEqual(['hidden']);
  });

  it('reads an unknown tier as the least prominent metal, never gold', () => {
    expect(metalFor('legendary')).toBe('bronze');
  });
});

describe('the icon map', () => {
  it('gives every named badge an icon that exists', () => {
    for (const slug of SLUGS_WITH_ICONS) expect(ICON_NAMES).toContain(badgeIcon(slug));
  });

  it('names only slugs a migration actually inserted', () => {
    // A typo here is a badge that silently keeps the default medal forever.
    const sql = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
      .join('\n');
    for (const slug of SLUGS_WITH_ICONS) expect(sql, slug).toContain(`'${slug}'`);
  });

  it('falls back to a medal for a badge nobody has drawn yet', () => {
    expect(badgeIcon('a-badge-added-next-year')).toBe('medal');
  });
});
