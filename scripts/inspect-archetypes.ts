/** Throwaway inspection helper: prints each archetype's squat progression. */
import { ARCHETYPES, generateHistory } from '../src/seed/archetypes';
import { mulberry32 } from '../src/seed/rng';
import { startOfWeek } from '../src/metrics/dates';

for (const a of ARCHETYPES) {
  const history = generateHistory(a, '2026-08-24', mulberry32(42));
  const lift = a.key === 'home-gym' ? 'dumbbell-squat' : 'barbell-full-squat';
  const byWeek = new Map<string, number>();
  for (const w of history) {
    for (const s of w.sets) {
      if (s.exerciseSlug !== lift || s.isWarmup || !s.weightKg) continue;
      const week = startOfWeek(w.localDate);
      byWeek.set(week, Math.max(byWeek.get(week) ?? 0, s.weightKg));
    }
  }
  const done = history.filter((w) => w.status === 'completed').length;
  const skipped = history.filter((w) => w.status === 'skipped').length;
  console.log(`\n${a.key}  (${done} done / ${skipped} skipped)  ${lift}`);
  console.log('  ' + [...byWeek.values()].map((k) => `${k}`).join(' → '));
}
