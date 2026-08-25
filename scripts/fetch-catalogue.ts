/**
 * Refreshes data/exercises.snapshot.json from the Free Exercise DB.
 *
 *   npx tsx scripts/fetch-catalogue.ts
 *
 * WHY a committed snapshot rather than fetching during the seed: `npm run seed`
 * has to finish in under a minute from an empty schema and has to work on stage.
 * A live fetch makes the demo depend on GitHub being reachable, which is a poor
 * trade for a dataset that changes a few times a year. This script is run by
 * hand when the catalogue should be refreshed, and its output is reviewed in the
 * diff like any other change.
 *
 * Licensing: the Free Exercise DB is released under the Unlicense — public
 * domain, no attribution required. wger, the other source PLAN.md names, is
 * CC-BY-SA 4.0 and needs per-exercise author attribution, so it is deferred to
 * phase 5 where that work can be paid for deliberately.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { EQUIPMENT_TAGS, isUnmappedEquipment } from '../src/catalogue/equipment';
import { normaliseAll, type SourceExercise } from '../src/catalogue/normalise';

const SOURCE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const OUTPUT = resolve(process.cwd(), 'data/exercises.snapshot.json');

/**
 * Deliberately lenient: `force`, `mechanic`, and `equipment` are documented as
 * incomplete upstream, so they are nullable here rather than being a reason to
 * reject an otherwise usable record.
 */
const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  force: z.string().nullish(),
  level: z.string().nullish(),
  mechanic: z.string().nullish(),
  equipment: z.string().nullish(),
  primaryMuscles: z.array(z.string()).default([]),
  secondaryMuscles: z.array(z.string()).default([]),
  instructions: z.array(z.string()).default([]),
  category: z.string().default('strength'),
});

async function main(): Promise<void> {
  console.log(`Fetching ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status}`);

  const raw: unknown = await response.json();
  const parsed = z.array(sourceSchema).parse(raw);
  console.log(`Received ${parsed.length} records`);

  // Report anything the equipment map does not know about. An unmapped value
  // means a real piece of equipment is invisible to the planner's SQL filter,
  // so it is surfaced rather than silently collapsed into 'other'.
  const unmapped = new Set(
    parsed.map((e) => e.equipment).filter((value) => isUnmappedEquipment(value))
  );
  if (unmapped.size > 0) {
    console.warn(`\nUnmapped equipment values (add to EQUIPMENT_ALIASES):`);
    for (const value of unmapped) console.warn(`  - ${String(value)}`);
    console.warn('');
  }

  const sources: SourceExercise[] = parsed.map((e) => ({
    id: e.id,
    name: e.name,
    force: e.force ?? null,
    level: e.level ?? null,
    mechanic: e.mechanic ?? null,
    equipment: e.equipment ?? null,
    primaryMuscles: e.primaryMuscles,
    secondaryMuscles: e.secondaryMuscles,
    instructions: e.instructions,
    category: e.category,
  }));

  const { exercises, dropped, duplicates } = normaliseAll(sources);

  const snapshot = {
    source: 'free-exercise-db',
    sourceUrl: SOURCE_URL,
    license: 'Unlicense (public domain)',
    fetchedAt: new Date().toISOString().slice(0, 10),
    count: exercises.length,
    equipmentTags: EQUIPMENT_TAGS,
    exercises,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  const patterns = new Map<string, number>();
  for (const e of exercises) {
    const key = e.movementPattern ?? '(none)';
    patterns.set(key, (patterns.get(key) ?? 0) + 1);
  }
  const equipment = new Map<string, number>();
  for (const e of exercises) equipment.set(e.equipment, (equipment.get(e.equipment) ?? 0) + 1);

  console.log(`Wrote ${exercises.length} exercises to ${OUTPUT}`);
  if (dropped.length > 0) console.log(`Dropped ${dropped.length}: ${dropped.join(', ')}`);
  if (duplicates.length > 0) console.log(`Merged ${duplicates.length} duplicate slug(s)`);
  console.log(
    `\nMovement patterns: ${[...patterns]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}`
  );
  console.log(
    `Equipment: ${[...equipment]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}`
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
